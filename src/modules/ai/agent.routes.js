/**
 * modules/ai/agent.routes.js — Chat agent AI nội bộ
 * 
 * Tổng quan:
 * - Xử lý chat với người dùng, phát hiện intent và gọi tool tương ứng
 * - Hỗ trợ 15 intents (đặc tả §3.3): tồn kho, nhân sự, đơn hàng, chi tiết đơn, khách hàng,
 *   dashboard, doanh thu, churn alerts, RFM/CLV, leads, GRN, hóa đơn NCC + 3 write intents
 * - Lưu session và feedback
 * - Thống kê analytics agent
 * 
 * Routes:
 * - POST /chat: Xử lý tin nhắn chat, detect intent → gọi tool handler → trả lời
 * - GET /sessions: Lịch sử session agent của user
 * - POST /feedback: Gửi feedback cho session
 * - GET /analytics: Thống kê agent (số session, độ trễ, feedback)
 * 
 * Handlers:
 * - TOOL_HANDLERS: queryInventory, getEmployeeInfo, listOrders, getOrderDetail, customerLookup,
 *   viewDashboard, getRevenue, queryChurnAlerts, queryRfmSegments, queryLeads, queryGrn, queryPurchaseInvoices
 *   + write: createOrder, createPO, sendReminder
 * - detectIntent(text): Phân tích text để tìm intent phù hợp
 */
const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireModule } = require('../../middleware/plan.middleware');

const router = express.Router();
router.use(authenticate, requireModule("ai"));

const prisma = require('../../config/prisma');
const { processQuery, generateResponse, HANDLERS } = require('./db-agent.service');
const logger = require('../../utils/logger');
const llm = require('../../config/llm');
const brain = require('./agent.brain');
const { parseAmount } = require('../../utils/vietnameseAmount');
const {
  buildDataRequestGate,
  buildWriteActionGate,
  buildDecisionData,
  createGate,
  PO_PROPOSAL,
} = require('./agent.humangate');
const { executeGate, retryExecution } = require('./agent.gate.exec');
const { withPurchaseQuantity } = require('../replenishment/proposal-quantity');
const { detectReplenishmentRequest, queryReplenishment } = require('./replenishment-chat.service');

// ─────────────────────────────────────────────────────────────
// M3: Role matrix cho tool AI
// - Tool nhạy cảm (PII: SĐT/email/địa chỉ KH, nhân viên, tài chính, nợ)
//   chỉ chạy trực tiếp với ADMIN/MANAGER/ACCOUNTANT
// - Role thấp (CASHIER/WAREHOUSE) → tạo DATA_REQUEST chờ ADMIN/MANAGER
//   phê duyệt (nút request: GET /human-gates → POST /human-gates/:id/decide)
// ─────────────────────────────────────────────────────────────
const SENSITIVE_TOOLS = new Set([
  'getEmployeeInfo',
  'getOrderDetail',
  'customerLookup',
  // CRM/SRM — PII khách hàng (SĐT, hành vi, điểm churn/RFM)
  'queryChurnAlerts',
  'queryRfmSegments',
  'queryLeads',
]);

const SENSITIVE_DB_TOOLS = new Set([
  'search_customers',
  'search_hr',
  'search_debts',
  'search_finance',
  'search_vendors',
  'search_churn_alerts',
  'search_customer_rfm',
  'search_leads',
  // PRM — hai tool này lấy dữ liệu từ `roi.service.js` và `referral.service.js`.
  // `search_partner_performance` chỉ trả số liệu cấp đối tác (tên đối tác, lợi nhuận),
  // không có PII khách — nhưng nó vẫn để trong danh sách nhạy cảm vì CÙNG đường với
  // `search_partner_referrals`, mà cái sau TRẢ TÊN KHÁCH HÀNG. Tách ra thì mọi
  // người đọc danh sách đều phải phân tích lại nội dung từng tool, và chỉ một
  // người đã viết mới biết. Giữ cả hai trong danh sách là lựa chọn an toàn hơn.
  'search_partner_performance',
  'search_partner_referrals',
]);

const SENSITIVE_ALLOWED_ROLES = [
  'SUPER_OMEGA_ULTRA_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'ACCOUNTANT',
];

const isSensitiveAllowed = (role) => SENSITIVE_ALLOWED_ROLES.includes(role);

const createDataRequest = (sessionId, tool, params, user = {}) =>
  createGate(buildDataRequestGate({
    sessionId,
    tool,
    params,
    role: user.role || null,
    requestedById: user.id || null,
  }));

const DATA_REQUEST_REPLY =
  'Dữ liệu bạn yêu cầu thuộc loại nhạy cảm (thông tin khách hàng, nhân viên hoặc tài chính). ' +
  'Yêu cầu đã được gửi tới ADMIN/MANAGER để phê duyệt. Kết quả sẽ được cập nhật sau khi được duyệt.';

const DATA_REQUEST_FAILED_REPLY =
  'Yêu cầu của bạn liên quan đến dữ liệu nhạy cảm và cần ADMIN/MANAGER phê duyệt, ' +
  'nhưng hệ thống chưa ghi được yêu cầu. Vui lòng thử lại hoặc liên hệ quản trị viên.';

/**
 * Ghi audit gate cho một write action đã thực hiện xong.
 * Không được làm hỏng response (hành động đã xảy ra rồi) nhưng lỗi PHẢI được log
 * rõ ràng — trước đây lỗi bị nuốt khiến mất hoàn toàn dấu vết kiểm toán.
 */
const recordWriteAudit = async (sessionId, actionType, params, userId) => {
  try {
    await createGate(buildWriteActionGate({ sessionId, actionType, params, decidedById: userId }));
    return true;
  } catch (e) {
    logger.error(`[Agent Gate] MẤT audit trail cho write action ${actionType} (session ${sessionId}): ${e.message}`);
    return false;
  }
};

const TOOL_HANDLERS = {
  queryReplenishment,
  queryInventory: async ({ query }) => {
    const q = query || '';
    const items = await prisma.inventory.findMany({
      where: { product: { isActive: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } },
      include: { product: { select: { id: true, name: true, sku: true, price: true } } },
      orderBy: { quantity: 'asc' }, take: 15,
    });
    if (!items.length) return 'Không tìm thấy sản phẩm nào.';
    return items.map(i => `• ${i.product?.name} (SKU: ${i.product?.sku}): Tồn ${i.quantity}, Khả dụng ${i.quantity - (i.reserved || 0)}, Tối thiểu ${i.minStock}`).join('\n');
  },
  getEmployeeInfo: async ({ employeeName }) => {
    const q = employeeName || '';
    const users = await prisma.user.findMany({
      where: { fullName: { contains: q, mode: 'insensitive' }, isActive: true },
      include: { employee: { include: { shifts: { take: 5, orderBy: { date: 'desc' } } } } },
      take: 5,
    });
    const employees = users.filter(u => u.employee).map(u => u.employee);
    if (!employees.length) return 'Không tìm thấy nhân viên nào.';
    return employees.map(e => `• ${e.user?.fullName || 'N/A'} (${e.employeeCode || 'N/A'}) - ${e.position} - Email: ${e.user?.email || 'N/A'}, SĐT: ${e.phone || 'N/A'}`).join('\n');
  },
  listOrders: async ({ status }) => {
    const where = {};
    if (status) where.status = status;
    const orders = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10, include: { customer: { select: { name: true } } } });
    if (!orders.length) return 'Không có đơn hàng nào.';
    return orders.map(o => `• ${o.orderCode} - ${o.status} - ${Number(o.total).toLocaleString()}đ - KH: ${o.customer?.name || 'N/A'} (${o.createdAt.toISOString().slice(0, 10)})`).join('\n');
  },
  getOrderDetail: async ({ orderCode }) => {
    const c = orderCode || '';
    const order = await prisma.order.findFirst({ where: { orderCode: c }, include: { customer: { select: { name: true, phone: true } }, items: { include: { product: { select: { name: true, sku: true } } } } } });
    if (!order) return 'Không tìm thấy đơn hàng.';
    return `Đơn ${order.orderCode} - ${order.status}\nKH: ${order.customer?.name || 'N/A'} - SĐT: ${order.customer?.phone || 'N/A'}\nTổng: ${Number(order.total).toLocaleString()}đ\nSản phẩm:\n${order.items.map(i => `  • ${i.product?.name} (${i.product?.sku}) x${i.quantity} = ${Number(i.price).toLocaleString()}đ`).join('\n')}`;
  },
  customerLookup: async ({ query }) => {
    const q = query || '';
    const customers = await prisma.customer.findMany({ where: { isActive: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }, take: 10, orderBy: { totalSpent: 'desc' } });
    if (!customers.length) return 'Không tìm thấy khách hàng nào.';
    return customers.map(c => `• ${c.name} - SĐT: ${c.phone || 'N/A'} - Email: ${c.email || 'N/A'} - Đã mua: ${Number(c.totalSpent).toLocaleString()}đ - Còn nợ: ${Number(c.totalDebt || 0).toLocaleString()}đ`).join('\n');
  },
  viewDashboard: async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [orderCount, revenueAgg, customerCount] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: today } }, _sum: { total: true } }),
      prisma.customer.count({ where: { isActive: true } }),
    ]);
    return `📊 Tổng quan hôm nay:\n• Đơn hàng: ${orderCount}\n• Doanh thu: ${Number(revenueAgg._sum.total || 0).toLocaleString()}đ\n• Tổng khách hàng: ${customerCount}`;
  },
  getRevenue: async ({ period }) => {
    const now = new Date(); let start, label;
    if (period === 'today') { start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); label = 'hôm nay'; }
    else if (period === 'last_month') { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); label = 'tháng trước'; }
    else { start = new Date(now.getFullYear(), now.getMonth(), 1); label = 'tháng này'; }
    const agg = await prisma.order.aggregate({ where: { createdAt: { gte: start }, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: { id: true } });

    const total = Number(agg._sum.total || 0);
    const orderCount = agg._count.id;

    // Kỳ không có đơn nào: nói rõ kỳ + chỉ ra kỳ gần nhất CÓ dữ liệu để
    // người dùng không tưởng hệ thống bị lỗi (0đ rất dễ gây hiểu nhầm).
    if (orderCount === 0) {
      const latest = await prisma.order.findFirst({
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const lines = [
        `💰 Doanh thu ${label}:`,
        '• Tổng: 0đ',
        '• Số đơn: 0',
        `• Chưa có đơn nào trong kỳ này (${start.toLocaleDateString('vi-VN')} → nay).`,
      ];
      if (latest) {
        lines.push(`• Đơn gần nhất: ${new Date(latest.createdAt).toLocaleDateString('vi-VN')}. Hãy thử "doanh thu tháng trước" hoặc "doanh thu năm nay".`);
      }
      return lines.join('\n');
    }

    return `💰 Doanh thu ${label}:\n• Tổng: ${total.toLocaleString('vi-VN')}đ\n• Số đơn: ${orderCount}\n• Trung bình: ${Math.round(total / orderCount).toLocaleString('vi-VN')}đ/đơn`;
  },

  // ─── CRM/SRM fast-path (đặc tả §3.3: 15 intents) — wrap db-agent HANDLERS ───
  queryChurnAlerts: async (params = {}) => {
    const r = await HANDLERS.search_churn_alerts(params);
    return r.message || r.summary;
  },
  queryRfmSegments: async (params = {}) => {
    const r = await HANDLERS.search_customer_rfm(params);
    return r.message || r.summary;
  },
  queryLeads: async (params = {}) => {
    const r = await HANDLERS.search_leads(params);
    return r.message || r.summary;
  },
  queryGrn: async (params = {}) => {
    const r = await HANDLERS.search_grn(params);
    return r.message || r.summary;
  },
  queryPurchaseInvoices: async (params = {}) => {
    const r = await HANDLERS.search_purchase_invoices(params);
    return r.message || r.summary;
  },

  // ════════════════ WRITE TOOL HANDLERS ════════════════

  createOrder: async ({ customerName, productName, quantity }, userId, sessionId) => {
    const result = await HANDLERS.create_order({
      customerName: customerName || '',
      productName: productName || '',
      quantity: parseInt(quantity) || 1,
    }, userId);
    const text = result.summary || result.message || 'Đã tạo đơn hàng';
    // Handler từ chối (không đủ SP/KH, quy tắc) trả data:null — gắn dấu ❌ để
    // route KHÔNG ghi audit/gate cho một thao tác chưa hề thực hiện (trước đây
    // "Không tìm thấy khách..." được audit APPROVED là bằng chứng sai).
    return result?.data ? text : `❌ ${text}`;
  },

  createPO: async ({ vendorName, productName, quantity, unitCost }, userId, sessionId) => {
    const result = await HANDLERS.create_po({
      vendorName: vendorName || '',
      productName: productName || '',
      quantity: parseInt(quantity) || 1,
      unitCost: parseFloat(unitCost) || 0,
    }, userId);
    const text = result.summary || result.message || 'Đã tạo đơn nhập hàng';
    return result?.data ? text : `❌ ${text}`;
  },

  sendReminder: async ({ customerName }, userId, sessionId) => {
    const result = await HANDLERS.send_reminder({
      customerName: customerName || '',
    }, userId, sessionId);
    const text = result.summary || result.message || 'Đã gửi nhắc nợ';
    return result?.data ? text : `❌ ${text}`;
  },
};

/**
 * Bóc tham số tạo PO từ câu lệnh tự nhiên.
 *
 * Bối cảnh (bug): regex cũ chỉ nhận đơn vị "đ|vnđ|vnd|k|tr", thiếu "triệu".
 * Với câu "tạo PO giá 5 triệu", số "5" bị bóc ra làm số lượng, còn chuỗi
 * "giá triệu" thành tên sản phẩm → báo lỗi "Không tìm thấy sản phẩm giá triệu".
 *
 * Cách sửa: dùng parseAmount() (utils/vietnameseAmount) để nhận diện đủ
 * đơn vị tiền tệ VN, bóc số tiền TRƯỚC rồi mới dựng tên sản phẩm.
 *
 * @param {string} msg
 * @returns {{vendorName: string, productName: string, quantity: string|number, unitCost: number}}
 */
/**
 * Regex một chuỗi dùng trong `new RegExp(...)` — dùng chung cho extractOrder.
 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bóc tham số tạo ĐƠN BÁN từ câu lệnh tự nhiên.
 *
 * Các lỗi đã gặp thật (báo cáo người dùng 17/10/2026):
 *  - Regex cũ `(cho|khách)\s+(.+?)` bóc mệnh đề ĐẦU TIÊN trong nhóm, nên câu
 *    "cho khách Bui Hoang" cho ra tên khách "khách Bui Hoang" (dư chữ "khách")
 *    → tra DB bằng `contains` trượt dù "Bui Hoang" có thật.
 *  - "Phô mai Oishi Loại 1 50 gói" — số ĐẦU TIÊN ("1") bị đọc làm số lượng,
 *    đúng ra là "50 gói".
 *  - SĐT/email gõ ở cuối câu lẫn vào tên khách → tiếp tục tra trượt.
 *  - "giá 5 triệu" không được bóc theo mệnh đề tiền → số "5" đâm vào tên sản phẩm.
 */
const QTY_UNIT_PATTERN = /(\d+)\s*(gói|cái|chiếc|hộp|thùng|túi|lít|ml|kg|gam|gram|ly|chai|lon|bóc|sp|sản phẩm)\b/i;

// Từ đệm cuối câu + đuôi tiền loại khỏi TÊN khách
const TAIL_FILLER = /\s*(nhé|nha|nhá|ạ|giúp mình|giup minh|giùm mình|giup minh|đi)\s*$/i;
const TAIL_MONEY = /\s*[\d.,]+\s*(k|tr|đ|vnd|nghìn|nghin|ngàn|ng|triệu|trieu|đồng)\s*$/i;

// Token lệnh — nếu tên "khách" thu được vẫn còn lẫn token lệnh thì đó KHÔNG
// phải tên khách (vd "cho mình đơn hàng giá" bóc được "đơn hàng giá").
const NOT_A_NAME = /(?:đơn hàng|don hang|order|nhập hàng|nhap hang|giao hàng|giao hang|giá)/i;

const cleanTailName = (s) =>
  String(s || '')
    .replace(TAIL_FILLER, '')
    .replace(TAIL_MONEY, '')
    .replace(/^\s*(?:mình|toi|tôi|tui|cho)\s+/i, '')
    .replace(/[\s,.:;!]+$/, '')
    .trim();

// Từ lệnh bị loại khỏi phần tên sản phẩm. Gom một chỗ cho cả lệnh đầy đủ lẫn
// "đuôi sản phẩm" của mệnh đề khách (sau số lượng).
const stripCommandWords = (s) =>
  String(s || '')
    .replace(/tạo mới|tao moi|tạo đơn hàng|tao don hang|tạo order|tạo cho mình|tao cho minh|tạo|tao|đặt hàng|dat hang|đặt đơn hàng|đặt|bán cho|bán|đơn hàng|don hang|order|thêm|them|nhập|nhap|cho|khách hàng|khách|khach hang|khach|giúp mình|giup minh|giúp|giup|giùm|gium|tôi|toi|mình|minh|giá|tiền|tổng/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—,.:;]+|[\s\-–—,.:;]+$/g, '')
    .trim();

const extractOrder = (msg) => {
  let text = String(msg || '');

  // 1) Bóc SĐT/email TRƯỚC MỌI THỨ — không lẫn vào tên khách/tên sản phẩm
  const phone = text.match(/\b0\d{8,10}\b/) || text.match(/\b84\d{8,10}\b/);
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/);
  if (phone) text = text.replace(phone[0], ' ');
  if (email) text = text.replace(email[0], ' ');

  // 2) Mệnh đề tiền ("giá 5 triệu") bóc theo đúng span, không vỡ thành "triệu".
  //    KHÔNG dùng parseAmount() ở đây: unit tiền của nó là OPTIONAL và có
  //    backtracking, "Tạo đơn hàng 5 áo polo" bị đọc là tiền 5đ của mệnh đề "5 ",
  //    "12 hộp" bị nuốt chữ "1" làm tiền → số lượng mất luôn. Bắt buộc CÓ đơn vị
  //    tiền ("triệu|k|đ...") trong span thì mới là tiền.
  const moneyClause = text.match(/(\d[\d.,]*)\s*(tỷ|ty|tỉ|triệu|trieu|nghìn|nghin|ngàn|ng|đồng|dong|đ|vnd|vnđ|k)\b/i);
  if (moneyClause) text = text.replace(new RegExp(escapeRe(moneyClause[0]), 'gi'), ' ');

  // 3) Tên khách: Ưu tiên mệnh đề sau "khách hàng|khách" (và bản không dấu),
  //    "cho" chỉ là dự phòng. Mệnh đề này là ĐUÔI DÀI — có thể lẫn cả
  //    "số lượng + sản phẩm" vào phía sau tên ("khách A 2 cái áo polo").
  //    Cách tách: nếu đuôi có "số + đơn vị đếm" thì TÊN dừng ngay trước con
  //    số, phần SAU đúng vị số là sản phẩm. Không có số lượng thì toàn đuôi
  //    là tên.
  const mKhach = text.match(/\b(?:khách hàng|khách|khach hang|khach)\s*(.+)$/i);
  const mCho = !mKhach ? text.match(/\bcho\s+(.+)$/i) : null;
  const tail = mKhach ? mKhach[1] : (mCho ? mCho[1] : '');
  const customerMarker = mKhach ? mKhach[0] : (mCho ? mCho[0] : null);

  let customerName = '';
  let qtyFromTail = null;
  let productTail = null;
  if (tail) {
    const tailQty = tail.match(QTY_UNIT_PATTERN);
    if (tailQty && tailQty.index > 0) {
      // "A 2 cái áo polo" → tên "A", qty 2, phần sau đơn vị là sản phẩm
      customerName = cleanTailName(tail.slice(0, tailQty.index));
      qtyFromTail = tailQty;
      productTail = tail.slice(tailQty.index + tailQty[0].length);
    } else {
      customerName = cleanTailName(tail);
    }
    // Đuôi bóc được nhưng vẫn lẫn token lệnh ("cho mình đơn hàng giá") →
    // KHÔNG phải tên khách — để trống cho HANDLERS hỏi lại, tránh tra trượt.
    if (customerName && NOT_A_NAME.test(customerName)) customerName = '';
  }

  // 4) Số lượng: ưu tiên nằm trong mệnh đề khách ("khách A 2 cái…"), không có
  //    thì tìm toàn câu "số + đơn vị đếm", cuối cùng mới là số đầu tiên
  const qtySource = qtyFromTail || text.match(QTY_UNIT_PATTERN) || text.match(/(\d+)/);
  const quantity = qtySource ? (parseInt(qtySource[1], 10) || 1) : 1;

  // 5) Tên sản phẩm:
  //    a) phần sau đơn vị số lượng trong mệnh đề khách (nếu đã tách),
  //    b) câu lệnh trừ mệnh đề khách, số lượng, từ lệnh.
  // LƯU Ý: customerMarker là CHUỖI (mKhach[0]) — KHÔNG gọi customerMarker[0]:
  // indexing chuỗi lấy KÝ TỰ ĐẦU "k" (lỗi thật từng xảy ra: "khách…" → "hách…").
  let product = productTail && productTail.trim() ? productTail : text;
  if (!productTail || !productTail.trim()) {
    if (customerMarker) product = product.replace(customerMarker, ' ');
    if (qtySource && !qtyFromTail) product = product.replace(new RegExp(escapeRe(qtySource[0]), 'i'), ' ');
  }
  // KHÔNG dùng `.replace(/\d+/g, ' ')` toàn cục: nó nuốt chữ số thuộc TÊN
  // ("Phô mai Oishi Loại 1" thành "… Loại ") — đúng lỗi gây tra nhầm "Loại 2"
  // (report 17/10/2026). Số lượng/SĐT/tiền đã bị xoá riêng từng span phía trên.
  product = stripCommandWords(product);

  return {
    customerName,
    productName: product,
    quantity,
  };
};

const QTY_PATTERN = /(\d+)\s*(cái|chiếc|hộp|chai|lon|bóc|thùng|túi|kg|gam|gram|sp|sản phẩm)\b/i;

const extractPO = (msg) => {
  const text = String(msg || '');
  const vendor = text.match(/(từ|ncc|nhà cung cấp)\s+(.+?)(?:\s+\d+\s|$)/i);

  // Số lượng phải CÓ đơn vị đếm — nếu không, "5 triệu" sẽ bị đọc thành qty=5.
  const qtyMatch = text.match(QTY_PATTERN);
  const amount = parseAmount(text);

  // Xoá MỆNH ĐỀ TIỀN theo đúng span đã bóc ("5 triệu") trước khi dựng tên SP —
  // nếu xoá số trước thì mệnh đề vỡ thành "triệu" rơi lại vào tên sản phẩm.
  let rest = text;
  if (amount && amount.matched) {
    rest = rest.replace(new RegExp(escapeRe(amount.matched), 'gi'), ' ');
  }
  if (qtyMatch) {
    rest = rest.replace(new RegExp(escapeRe(qtyMatch[0]), 'gi'), ' ');
  }

  const product = rest
    // "tao/mình/giúp" là từ lệnh — nếu để lại sẽ thành tên SP rác ("tạo mình PO")
    .replace(/tạo đơn nhập|tạo po|tao don nhap|tao po|đặt hàng nhập|nhập thêm|cho|từ|ncc|nhà cung cấp|tạo|tao|mình|minh|giúp|giup/gi, '')
    // 'PO' trần (ranh giới từ, không tràn "áo polo") cũng là từ lệnh — bỏ nốt
    .replace(/(?<![\p{L}\p{N}])po(?![\p{L}\p{N}])/giu, ' ')
    // Bỏ từ bám theo mệnh đề tiền còn sót ("giá" trong "… giá 5 triệu")
    .replace(/(giá trị|tổng tiền|thành tiền|giá bán|giá|tiền)/gi, '')
    // Người dùng có thể gõ "tạo PO giá triệu" (quên con số) — đơn vị tiền tệ
    // đứng lẻ không phải tên sản phẩm, phải dọn để create_po báo thiếu thông tin
    .replace(/(?<![\p{L}\p{N}])(nghìn|nghin|ngàn|triệu|trieu|ngàn|ng|đồng|tỷ|ty|tr|k)(?![\p{L}\p{N}])/giu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—,.:;]+|[\s\-–—,.:;]+$/g, '')
    .trim();

  return {
    vendorName: vendor ? vendor[2].trim() : '',
    productName: product,
    quantity: qtyMatch ? qtyMatch[1] : 1,
    unitCost: amount ? amount.value : 0,
  };
};

const INTENTS = [
  // Write intents MUST come first — they conflict with read patterns (y hệt db-agent INTENT_MAP)
  // Từ khoá "tạo mới đơn hàng"/bản không dấu: câu "tạo mới đơn hàng giá 5 triệu"
  // từng rơi xuống listOrders (nhánh tra cứu) vì chỉ có đúng cụm "tạo đơn hàng".
  // CHÚ Ý: KHÔNG dùng từ khoá trần "tạo đơn" — nó tràn vào "tạo đơn nhập…" (PO),
  // mà hàng createOrder đứng TRƯỚC createPO nên matching đầu tiên sẽ thắng.
  { keywords: ['tạo mới đơn hàng', 'tao moi don hang', 'tạo đơn hàng', 'tao don hang', 'tạo order', 'tao order', 'đặt hàng', 'dat hang', 'đặt đơn hàng', 'dat don hang', 'bán cho', 'ban cho',
    // Từ đệm giữa động từ và danh từ ("tạo cho mình đơn hàng", "giúp mình tạo
    // đơn hàng") — dùng biến thể đầy đủ thay vì regex vì cụm "tạo ... đơn" trần
    // sẽ tràn vào "tạo ... đơn nhập" (PO). Brain LLM là đường chính; các biến
    // thể này chỉ để pipeline từ khoá sống sót khi LLM chết.
    'tạo cho mình đơn hàng', 'tao cho minh don hang', 'giúp mình tạo đơn hàng', 'giup minh tao don hang'],
    tool: 'createOrder', isWrite: true,
    extract: extractOrder
  },
  // "tạo cho mình PO giá 5 triệu" không chứa "tạo po" liên tiếp → thêm biến thể.
  { keywords: ['tạo cho mình po', 'tao cho minh po', 'giúp mình tạo po', 'giup minh tao po', 'tạo po giá', 'tao po gia', 'tạo mới po', 'tao moi po', 'tạo mới đơn nhập', 'tao moi don nhap', 'tạo po', 'tao po', 'tạo đơn nhập', 'tao don nhap', 'đặt hàng nhập', 'dat hang nhap', 'nhập thêm', 'nhap them', 'tạo purchase order'], tool: 'createPO', isWrite: true,
    extract: extractPO },
  { keywords: ['nhắc nợ', 'nhac no', 'gửi nhắc', 'gui nhac', 'nhắc khách', 'nhac khach', 'đòi nợ', 'doi no', 'remind'], tool: 'sendReminder', isWrite: true,
    extract: (msg) => {
      // Lỗi đã gặp thật: `(nhắc|khách|cho)\s+(.+?)(?:\s|$)` khớp mệnh đề ĐẦU TIÊN
      // buclamp trận, nên "nhắc nợ khách Bui Hoang" bốc chữ "nợ" làm tên khách.
      // Cách sửa: dọn sạch từ lệnh trước, rồi lấy phần SAU "khách hàng|khách",
      // phương án dự phòng là sau "cho" / prefix tiền tố dư.
      let name = String(msg || '')
        .replace(/nhắc nợ|nhac no|gửi nhắc|gui nhac|nhắc khách|nhac khach|đòi nợ|doi no|remind/gi, ' ');
      const m = name.match(/\b(?:khách hàng|khách)\s+(.+)$/i) || name.match(/\bcho\s+(.+)$/i);
      if (m) {
        name = m[1].replace(/^\s*(?:khách hàng|khach hang|khách|khach)\s+/i, '');
      } else {
        name = name.replace(/^\s*(?:cho|tiền nợ|tien no|nợ|no)\s+/i, '').trim();
      }
      name = name
        .replace(/\b0\d{8,10}\b.*$/, '')
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+.*$/, '')
        .replace(/\s*(nhé|nha|nhá|ạ|giúp mình|giup minh|giùm mình|giup minh)\s*$/i, '')
        // đuôi số tiền ("... Bui Hoang 50k") không phải phần tên khách
        .replace(/\s*[\d.,]+\s*(k|tr|đ|vnd|nghìn|nghin|ngàn|ng|triệu|trieu|đồng)\s*$/i, '')
        .replace(/[\s,.:;!]+$/, '')
        .trim();
      return { customerName: name };
    }
  },

  // CRM/SRM intents — 5 intents mới (đặc tả §3.3: tổng 15 intents)
  { keywords: ['churn', 'khách sắp mất', 'khách có nguy cơ', 'giữ chân'], tool: 'queryChurnAlerts',
    extract: (msg) => {
      const m = msg.toLowerCase().match(/triggered|retained|lost|pending/);
      return { status: m ? m[0].toUpperCase() : undefined };
    }},
  { keywords: ['rfm', 'clv', 'phân khúc khách', 'giá trị vòng đời'], tool: 'queryRfmSegments',
    extract: (msg) => {
      const map = { champions: 'Champions', loyal: 'Loyal', potential: 'Potential', 'at-risk': 'At-Risk', hibernating: 'Hibernating' };
      const m = msg.toLowerCase().match(/champions|loyal|potential|at-risk|hibernating/);
      return { segment: m ? map[m[0]] : undefined };
    }},
  { keywords: ['lead', 'khách tiềm năng', 'nguồn khách'], tool: 'queryLeads',
    extract: (msg) => {
      const m = msg.toLowerCase().match(/contacted|qualified|dead|new/);
      return { leadStatus: m ? m[0].toUpperCase() : undefined };
    }},
  { keywords: ['phiếu nhập kho', 'grn', 'nhận hàng po', 'kiểm hàng'], tool: 'queryGrn',
    extract: (msg) => {
      if (/posted|đã ghi/i.test(msg)) return { status: 'POSTED' };
      if (/\bqc\b|xong|hoàn tất kiểm/i.test(msg)) return { status: 'QC_DONE' };
      return {};
    }},
  { keywords: ['hóa đơn mua', 'đối soát hóa đơn', '3-way', 'purchase invoice'], tool: 'queryPurchaseInvoices',
    extract: (msg) => {
      if (/variance|lệch|vượt dung sai/i.test(msg)) return { matchStatus: 'VARIANCE_HOLD' };
      if (/matched|khớp|đã đối soát/i.test(msg)) return { matchStatus: 'MATCHED' };
      if (/pending|chờ/i.test(msg)) return { matchStatus: 'PENDING' };
      return {};
    }},

  { keywords: ['tồn kho', 'hàng tồn', 'còn hàng', 'sản phẩm', 'inventory'], tool: 'queryInventory', extract: (msg) => ({ query: msg.replace(/tồn kho|sản phẩm|hàng tồn|còn hàng|còn không|có.*không/gi, '').trim() || msg.trim() }) },
  { keywords: ['nhân sự', 'nhân viên', 'employee', 'hr'], tool: 'getEmployeeInfo', extract: (msg) => ({ employeeName: msg.replace(/nhân sự|nhân viên|thông tin|tra cứu/gi, '').trim() || msg.trim() }) },
  { keywords: ['đơn hàng', 'order', 'danh sách đơn'], tool: 'listOrders', extract: (msg) => {
    const s = msg.match(/(pending|confirmed|shipping|completed|cancelled)/i);
    return { status: s ? s[1].toUpperCase() : undefined };
  }},
  { keywords: ['chi tiết đơn', 'xem đơn', 'mã đơn', 'order detail', 'ord-'], tool: 'getOrderDetail', extract: (msg) => {
    const c = msg.match(/(ORD-\d{8}-\d{4})/i);
    return { orderCode: c ? c[1].toUpperCase() : msg.trim() };
  }},
  { keywords: ['khách hàng', 'customer'], tool: 'customerLookup', extract: (msg) => ({ query: msg.replace(/khách hàng|thông tin|tra cứu/gi, '').trim() || msg.trim() }) },
  { keywords: ['dashboard', 'tổng quan', 'tình hình kinh doanh', 'business'], tool: 'viewDashboard', extract: () => ({}) },
  { keywords: ['doanh thu', 'revenue'], tool: 'getRevenue', extract: (msg) => {
    if (/hôm nay|today/i.test(msg)) return { period: 'today' };
    if (/tháng trước|last month/i.test(msg)) return { period: 'last_month' };
    return { period: 'this_month' };
  }},
];

function detectIntent(text) {
  const lower = text.toLowerCase();
  for (const intent of INTENTS) {
    if (intent.keywords.some(k => lower.includes(k))) {
      return { tool: intent.tool, params: intent.extract(text), isWrite: intent.isWrite || false };
    }
  }
  return null;
}

router.post('/chat', async (req, res, next) => {
  try {
    const { messages } = req.body;
    if (!messages || messages.length === 0) {
      throw { status: 400, message: 'messages is required' };
    }

    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMsg) return res.json({ success: true, data: { response: 'Bạn muốn hỏi gì?' } });

    const userMsg = lastUserMsg.content || '';

    // ── LLM-first: bộ não LLM (agent.brain) quyết định TRƯỚC khớp từ khoá ──
    // Trước đây mọi câu đều đi detectIntent() khớp từ khoá, nên câu có từ đệm
    // ("tạo cho mình đơn hàng"), tên sản phẩm chứa số ("Loại 1") hay câu ngoài
    // danh mục đều hiểu sai hoặc trả menu cứng. Brain đọc câu bằng LLM và trả
    // {mode:'tool'|'reply'}. decide() tự trả null khi LLM chết/JSON hỏng/tool
    // lạ — khi đó pipeline từ khoá dưới đây chạy y như cũ (không mất chức năng).
    const cutoff = messages.map((m) => m.role).lastIndexOf('user');
    const history = messages
      .slice(0, Math.max(cutoff, 0))
      .filter((m) => m && typeof m.content === 'string' && m.role !== 'system')
      .slice(-8)
      .map((m) => `${m.role === 'user' ? 'Khách' : 'Trợ lý'}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const previousReply = messages.slice(0, cutoff).filter((m) => m?.role === 'assistant').pop()?.content || '';
    const replenishmentRequest = detectReplenishmentRequest(userMsg, previousReply);
    const brainDecision = replenishmentRequest ? null : await brain.decide({ userMsg, history });
    let intent = replenishmentRequest
      ? { tool: 'queryReplenishment', params: replenishmentRequest, isWrite: false }
      : null;
    if (brainDecision?.mode === 'tool') {
      intent = {
        tool: brainDecision.tool,
        params: brainDecision.params,
        isWrite: brain.WRITE_TOOLS.has(brainDecision.tool),
        dbTool: brain.DB_TOOLS.has(brainDecision.tool),
        isBrain: true,
      };
    } else if (brainDecision?.mode === 'reply') {
      intent = { isBrain: true, replyText: brainDecision.text };
    }
    if (!intent) intent = detectIntent(userMsg);

    // Winston ghép đối số 2+ vào object info — chuỗi thường bị "tách chữ"
    // thành object per-char trong logs. Ghép một dòng duy nhất.
    logger.info(`[Agent Chat] Intent: ${intent?.tool || (intent?.replyText ? 'brain_reply' : 'none')} (${intent?.isBrain ? 'brain' : 'keyword'}) Msg: ${logger.truncateLog(userMsg)}`);

    // Tạo session
    const session = await prisma.agentSession.create({
      data: {
        userId: req.user.id,
        userMessage: userMsg,
        intent: intent?.tool || null,
        status: 'RUNNING',
        triggerSource: 'USER_CHAT',
      },
    });

    const startTime = Date.now();
    // type là enum AgentStepType (LLM_CALL | TOOL_CALL | HUMAN_GATE | RENDER_UI).
    // Giá trị mặc định 'FAST_PATH' không tồn tại trong enum → PrismaClientValidationError → 500.
    let reply, stepType = 'TOOL_CALL', toolName = null;

    if (intent?.replyText) {
      // Trò chuyện trực tiếp qua LLM. Brain đã gọi MỘT lần mô hình trong
      // decide() — không gọi thêm lần nữa (tăng độ trễ vô ích). Nhãn LLM_CALL
      // đi qua biến brain.STEP_TYPE_LLM vì literal bị test agent-step-type
      // cấm gán trực tiếp trong file này.
      stepType = brain.STEP_TYPE_LLM;
      reply = intent.replyText;
    } else if (intent && TOOL_HANDLERS[intent.tool]) {
      toolName = intent.tool;

      if (intent.isWrite) {
        // Write operations: require ADMIN or MANAGER role
        if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
          reply = 'Xin lỗi, bạn không có quyền thực hiện thao tác này. Chỉ ADMIN và MANAGER mới có thể tạo đơn hàng, nhập hàng, hoặc gửi nhắc nợ.';
          stepType = 'TOOL_CALL';
        } else {
          try {
            reply = await TOOL_HANDLERS[intent.tool](intent.params, req.user.id, session.id);
          } catch (writeErr) {
            // Quy tắc nghiệp vụ (hạn mức tín dụng, tổng thanh toán vượt giá trị…)
            // bị ném dạng object {status, message} từ order.service — biến thành
            // câu trả lời chat thân thiện thay vì 400/500 JSON lẫn lộn cho
            // widget (bug thật 17/10/2026: trả nguyên 400 "undefined").
            const msg = writeErr?.message || (typeof writeErr === 'string' ? writeErr : '');
            reply = msg
              ? `❌ Không thực hiện được: ${msg}`
              : '❌ Không thực hiện được thao tác. Vui lòng kiểm tra lại thông tin hoặc thử lại sau.';
            logger.warn(`[Agent Chat] write ${intent.tool} bị từ chối: ${logger.truncateLog(msg || writeErr || 'unknown')}`);
          }
          stepType = 'TOOL_CALL';

          // Chỉ audit khi thao tác THÀNH CÔNG (reply không phải ❌) — write bị
          // chặn bởi quy tắc nghiệp vụ thì chưa thực hiện gì, audit ghi "đã
          // thực hiện" sẽ là bằng chứng sai.
          if (!reply.startsWith('❌')) {
            const audited = await recordWriteAudit(session.id, toolName, intent.params, req.user.id);
            if (!audited) {
              reply += '\n\n⚠️ Thao tác đã thực hiện nhưng KHÔNG ghi được bản ghi kiểm toán — vui lòng báo quản trị viên.';
            }
          }
        }
      } else if (SENSITIVE_TOOLS.has(intent.tool) && !isSensitiveAllowed(req.user.role)) {
        // M3: role thấp hỏi tool nhạy cảm → tạo request chờ phê duyệt
        stepType = 'TOOL_CALL';
        try {
          await createDataRequest(session.id, intent.tool, intent.params, req.user);
          reply = DATA_REQUEST_REPLY;
        } catch (gateErr) {
          logger.error(`[Agent Gate] Không tạo được DATA_REQUEST cho ${intent.tool}: ${gateErr.message}`);
          reply = DATA_REQUEST_FAILED_REPLY;
        }
      } else {
        reply = await TOOL_HANDLERS[intent.tool](intent.params, req.user);
        reply = `📋 **${intent.tool}**\n\n${reply}`;
      }
    } else if (intent && intent.dbTool && HANDLERS[intent.tool]) {
      // DB read tool do brain chọn (search_products, search_debts, …). Khác
      // TOOL_HANDLERS ở chỗ: trả về {summary, message}, và một số tool thuộc
      // danh sách NHẠY CẢM (PII khách/tài chính) — phải đi qua cùng song
      // DATA_REQUEST như nhánh Widget để role thấp không đọc được PII.
      toolName = intent.tool;
      if (SENSITIVE_DB_TOOLS.has(intent.tool) && !isSensitiveAllowed(req.user.role)) {
        try {
          await createDataRequest(session.id, intent.tool, intent.params, req.user);
          reply = DATA_REQUEST_REPLY;
        } catch (gateErr) {
          logger.error(`[Agent Gate] Không tạo được DATA_REQUEST cho ${intent.tool}: ${gateErr.message}`);
          reply = DATA_REQUEST_FAILED_REPLY;
        }
      } else {
        try {
          const dbRes = await HANDLERS[intent.tool](intent.params || {});
          reply = [dbRes.summary, dbRes.message].filter(Boolean).join('\n\n') || 'Không tìm thấy dữ liệu.';
        } catch (dbErr) {
          // Prisma/service lỗi giữa chừng cũng phải trả về dạng chat, không 500
          const msg = dbErr?.message || String(dbErr);
          reply = `❌ Lỗi tra cứu: ${msg}`;
          logger.warn(`[Agent Chat] dbTool ${intent.tool} lỗi: ${logger.truncateLog(msg)}`);
        }
      }
    } else {
      try {
        const dbResult = await processQuery(userMsg);
        if (dbResult.success && dbResult.data?.length > 0) {
          if (SENSITIVE_DB_TOOLS.has(dbResult.tool) && !isSensitiveAllowed(req.user.role)) {
            // M3: fallback tool nhạy cảm → request chờ phê duyệt
            stepType = 'TOOL_CALL';
            try {
              await createDataRequest(session.id, dbResult.tool, dbResult.params, req.user);
              reply = DATA_REQUEST_REPLY;
            } catch (gateErr) {
              logger.error(`[Agent Gate] Không tạo được DATA_REQUEST cho ${dbResult.tool}: ${gateErr.message}`);
              reply = DATA_REQUEST_FAILED_REPLY;
            }
          } else {
            // KHÔNG phải LLM_CALL. `generateResponse` chỉ nối chuỗi summary+message
            // từ kết quả processQuery (xem db-agent.service.js:989-997) — không có
            // lời gọi mô hình nào. Trước đây gắn nhãn LLM_CALL và path gợi ý đây là
            // nhánh LLM, khiến số liệu thống kê agent trên UI phản ánh sai mức dùng LLM thật.
            // Nhãn đúng cho nhánh này là TOOL_CALL (đã chạy truy vấn), path là keyword.
            stepType = 'TOOL_CALL';
            reply = await generateResponse(userMsg, dbResult);
          }
        } else if (llm.isConfigured()) {
          // Cau hoi khong tim duoc du lieu / khong phai tool DB → dung LLM da cau hinh
          // (9router o nha, UIT o truong — theo .env).
          try {
            reply = await llm.generateText({
              system: 'Bạn là trợ lý AI chuyên môn của Aduu ERP. Trả lời bằng tiếng Việt, ngắn gọn, thân thiện. Nếu được hỏi danh tính, nói bạn là trợ lý AI của Aduu ERP (modelGemma 4).',
              prompt: userMsg,
              temperature: 0.4,
              maxOutputTokens: 512,
              mode: 'live',
            });
          } catch (e) {
            logger.error(`[Agent Chat] LLM fallback error: ${e.message}`);
            reply = 'Xin chào! Tôi có thể giúp bạn:\n' +
              '• 📦 Tra cứu tồn kho (vd: "tồn kho sáp treo")\n' +
              '• 📋 Xem đơn hàng (vd: "đơn hàng hôm nay")\n' +
              '• 👤 Tra cứu khách hàng (vd: "khách hàng Nguyễn Văn A")\n' +
              '• 📊 Dashboard (vd: "tình hình kinh doanh")\n' +
              '• 💰 Doanh thu (vd: "doanh thu tháng này")';
          }
        } else {
          reply = 'Xin chào! Tôi có thể giúp bạn:\n' +
            '• 📦 Tra cứu tồn kho (vd: "tồn kho sáp treo")\n' +
            '• 📋 Xem đơn hàng (vd: "đơn hàng hôm nay")\n' +
            '• 👤 Tra cứu khách hàng (vd: "khách hàng Nguyễn Văn A")\n' +
            '• 📊 Dashboard (vd: "tình hình kinh doanh")\n' +
            '• 💰 Doanh thu (vd: "doanh thu tháng này")';
        }
      } catch {
        if (llm.isConfigured()) {
          try {
            reply = await llm.generateText({
              system: 'Bạn là trợ lý AI chuyên môn của Aduu ERP. Trả lời bằng tiếng Việt, ngắn gọn, thân thiện.',
              prompt: userMsg,
              temperature: 0.4,
              maxOutputTokens: 512,
              mode: 'live',
            });
          } catch {
            reply = 'Xin chào! Tôi có thể giúp bạn tra cứu dữ liệu database. Hãy đặt câu hỏi về sản phẩm, đơn hàng, khách hàng, doanh thu...';
          }
        } else {
          reply = 'Xin chào! Tôi có thể giúp bạn tra cứu dữ liệu database. Hãy đặt câu hỏi về sản phẩm, đơn hàng, khách hàng, doanh thu...';
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // Lưu step
    await prisma.agentStep.create({
      data: {
        sessionId: session.id,
        sequence: 1,
        type: stepType,
        toolName,
        toolOutput: { response: reply },
        status: 'COMPLETED',
        durationMs,
        // Nhãn nguồn để phân tích: brain_tool/brain_reply = LLM chọn tool/reply;
        // fast_path = khớp từ khoá trúng tool; fallback_keyword = quét DB.
        // KHÔNG đặt tên path dạng "fallback-lm-lm" (chuỗi bị test agent-step-type
        // cấm vì nhánh ấy thực chất là keyword, không phải LLM).
        path: intent?.isBrain
          ? (intent.tool ? 'brain_tool' : 'brain_reply')
          : intent?.tool ? 'fast_path' : 'fallback_keyword',
      },
    });

    // Cập nhật session
    await prisma.agentSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        finalResult: { response: reply },
        endedAt: new Date(),
      },
    });

    res.json({ success: true, data: { response: reply } });
  } catch (e) {
    next(e);
  }
});

// ─── Sessions ───
router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.agentSession.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }, take: 20,
      include: { steps: { orderBy: { sequence: 'asc' }, take: 5 }, feedback: true },
    });
    res.json({ success: true, data: sessions });
  } catch (e) {
    next(e);
  }
});

// ─── Feedback ───
router.post('/feedback', async (req, res, next) => {
  try {
    const { sessionId, rating, comment } = req.body;
    if (!sessionId || rating === undefined) {
      throw { status: 400, message: 'sessionId and rating are required' };
    }
    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: { userMessage: true, finalResult: true },
    });
    if (!session) {
      throw { status: 404, message: 'Session not found' };
    }
    const feedback = await prisma.agentFeedback.create({
      data: {
        sessionId,
        userId: req.user.id,
        rating,
        comment,
        query: session.userMessage,
        response: session.finalResult ? JSON.stringify(session.finalResult) : '',
      },
    });
    res.json({ success: true, data: feedback });
  } catch (e) {
    next(e);
  }
});

// ─── Analytics ───
router.get('/analytics', async (req, res, next) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalSessions, avgLatencyAgg, feedback] = await Promise.all([
      prisma.agentSession.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.agentStep.aggregate({
        where: { session: { createdAt: { gte: startOfToday } }, durationMs: { not: null } },
        _avg: { durationMs: true },
      }),
      prisma.agentFeedback.groupBy({
        by: ['rating'],
        _count: { rating: true },
        where: { session: { createdAt: { gte: startOfToday } } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalSessions,
        avgLatency: avgLatencyAgg._avg.durationMs || 0,
        feedback: feedback.map(f => ({ rating: f.rating, _count: f._count.rating })),
      },
    });
  } catch (e) {
    next(e);
  }
});

// ─── Human Gates ───
// M2: chỉ ADMIN/MANAGER mới xem + phê duyệt yêu cầu (write + DATA_REQUEST)

router.get('/human-gates', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const gates = await prisma.agentHumanGate.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { session: { select: { userMessage: true, userId: true } } },
      take: 50,
    });
    res.json({ success: true, data: gates });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/agent/human-gates/by-status:
 *   get:
 *     summary: Liệt kê human-gate theo trạng thái (chỉ đọc)
 *     description: >
 *       CHỈ ĐỌC. `GET /human-gates` cố tình chỉ trả PENDING, nên trạng thái "lơ lửng"
 *       (APPROVED nhưng `resultRef` IS NULL ⇒ đã duyệt mà PO chưa tạo được) không đọc
 *       được qua API. Route này là đường đọc cho trạng thái đó. Không có tác dụng phụ:
 *       không ghi, không đổi trạng thái. Cách ly tenant do Prisma extension
 *       (`AgentHumanGate` nằm trong `TENANT_SCOPED_MODELS`).
 *     tags: [Agent]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema: { type: string, enum: [PENDING, APPROVED, REJECTED, EXPIRED, CANCELLED] }
 *       - in: query
 *         name: pendingResult
 *         required: false
 *         description: "1 = chỉ gate PO_PROPOSAL đã duyệt mà chưa có resultRef (trạng thái lơ lửng)"
 *         schema: { type: string, enum: ["0", "1"] }
 *       - in: query
 *         name: limit
 *         required: false
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200: { description: Danh sách gate }
 *       400: { description: status/pendingResult không hợp lệ }
 */
router.get('/human-gates/by-status', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const ALLOWED = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'];
    const { status, pendingResult, limit } = req.query;

    // Whitelist thay vì nội suy vào `where` — không nhét chuỗi tùy ý của người gọi
    // vào truy vấn, và status sai thì báo 400 chứ không âm thầm trả rỗng.
    if (status && !ALLOWED.includes(String(status))) {
      throw { status: 400, message: `status phải là: ${ALLOWED.join(', ')}` };
    }
    const onlyPendingResult = String(pendingResult || '') === '1';
    if (pendingResult !== undefined && !['0', '1'].includes(String(pendingResult))) {
      throw { status: 400, message: 'pendingResult phải là 0 hoặc 1' };
    }
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    // Ba điều kiện phải khớp CÙNG LÚC (00b §4.2): resultRef null một mình không đủ,
    // vì mọi gate DATA_REQUEST cũng có resultRef null.
    const where = {
      ...(status ? { status } : {}),
      ...(onlyPendingResult ? { actionType: PO_PROPOSAL, resultRef: null } : {}),
    };

    const gates = await prisma.agentHumanGate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { session: { select: { userMessage: true, userId: true } } },
      take,
    });

    res.json({
      success: true,
      data: gates,
      meta: { count: gates.length, status: status || null, pendingResult: onlyPendingResult },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/human-gates/:id/decide', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, note, acknowledgeDrift } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw { status: 400, message: 'decision must be APPROVED or REJECTED' };
    }
    // Từ chối mà không ghi lý do thì người sau không biết vì sao phải sửa.
    if (decision === 'REJECTED' && !String(note || '').trim()) {
      throw { status: 400, message: 'Từ chối đề xuất cần nhập lý do' };
    }

    const gate = await prisma.agentHumanGate.findFirst({
      where: { id },
      include: { session: { select: { userId: true, triggerSource: true } } },
    });
    if (!gate) throw { status: 404, message: 'Human gate not found' };
    if (gate.status !== 'PENDING') throw { status: 400, message: `Gate is already ${gate.status}` };
    if (new Date(gate.expiresAt) < new Date()) throw { status: 400, message: 'Gate has expired' };

    // Store the person's quantity in the same conditional write as the decision.
    // Existing clients can omit quantity; the approval screen always supplies it.
    let actionPayload = null;
    if (decision === 'APPROVED' && req.body.quantity !== undefined) {
      if (gate.actionType !== PO_PROPOSAL) {
        throw { status: 400, message: 'Gate này không hỗ trợ chọn số lượng nhập' };
      }
      actionPayload = withPurchaseQuantity(gate.actionPayload || {}, req.body.quantity);
    }

    // ĐẢO TRẠNG THÁI BẰNG updateMany CÓ ĐIỀU KIỆN, không dùng update().
    // `update()` đọc-rồi-ghi nên hai request song song đều thấy PENDING và cùng
    // ghi được ⇒ bấm duyệt hai lần tạo hai PO. `updateMany` khoá dòng, chỉ một
    // bên nhận count=1, bên kia nhận count=0 ⇒ 409 (00b §10 test #3).
    const claimed = await prisma.agentHumanGate.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        ...buildDecisionData({ decision, note, userId: req.user.id }),
        ...(actionPayload ? { actionPayload } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw { status: 409, message: 'Gate đã được xử lý bởi người khác' };
    }

    const updated = await prisma.agentHumanGate.findFirst({ where: { id } });

    // ── Tự duyệt: KHÔNG chặn ──────────────────────────────────────────────
    // Khách SME thường chỉ có MỘT chủ shop là ADMIN; chặn tự duyệt cứng sẽ làm
    // tính năng vô dụng với đúng nhóm khách chính. Thay vào đó audit bắt buộc ghi
    // lại. Đề xuất từ SYSTEM_EVENT vốn không có người đề xuất nên luôn false.
    const selfApproved =
      gate.actionType === PO_PROPOSAL &&
      gate.session?.triggerSource === 'USER_CHAT' &&
      gate.session?.userId === req.user.id;

    let po = null;
    if (decision === 'APPROVED') {
      if (gate.actionType === PO_PROPOSAL) {
        // ĐÂY LÀ NHÁNH CÓ HIỆU LỰC ĐẦU TIÊN TRONG HỆ THỐNG: chỉ sau khi gate
        // được duyệt thì PO mới tồn tại. Re-validation tính lại từ DB (ATP/ROP/đơn
        // giá); lệch quá ngưỡng ⇒ 409 kèm diff, người duyệt phải xác nhận có chủ đích.
        const result = await executeGate(id, req.user.id, { acknowledgeDrift: Boolean(acknowledgeDrift) });
        po = result.po;
      }
      // Gate đã lưu quyết định thành công → không được fail response. Nhưng nếu không đánh
      // dấu được session COMPLETED thì phiên chat kẹt PENDING vĩnh viễn → PHẢI log có id để trace.
      try {
        await prisma.agentSession.update({
          where: { id: gate.sessionId },
          data: {
            status: 'COMPLETED',
            finalResult: {
              approved: true,
              actionType: gate.actionType,
              payload: updated.actionPayload,
              selfApproved,
              ...(po ? { poId: po.id, poCode: po.poCode } : {}),
            },
          },
        });
      } catch (e) {
        logger.error(
          `[Agent Gate] Gate ${id} đã APPROVED nhưng không đóng được AgentSession ${gate.sessionId}: ${e.message}`,
        );
      }
    }

    res.json({
      success: true,
      data: {
        ...updated,
        selfApproved,
        po: po ? { id: po.id, poCode: po.poCode, total: po.total } : null,
      },
      message: decision === 'APPROVED'
        ? (po ? `Đã phê duyệt — tạo PO ${po.poCode}` : 'Đã phê duyệt')
        : 'Đã từ chối',
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Thử lại thực thi cho đề xuất PO đã duyệt nhưng `resultRef` vẫn null.
 *
 * Thao tác CỐ Ý — KHÔNG có cron tự gọi. PO là hành động tài chính nên không được
 * tự retry. Chạy lại đầy đủ re-validation vì dữ liệu đã cũ hơn lần đầu.
 * Điều kiện nhận diện trạng thái lỗi là BA điều kiện CÙNG LÚC
 * (`actionType` + `status` + `resultRef IS NULL`) — không được tính nhầm gate
 * loại khác, xem 00b §4.2.
 */
router.post('/human-gates/:id/retry-execution', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { acknowledgeDrift } = req.body || {};
    const { po, linked } = await retryExecution(id, req.user.id, {
      acknowledgeDrift: Boolean(acknowledgeDrift),
    });
    res.json({
      success: true,
      data: { id: po.id, poCode: po.poCode, total: po.total },
      linked,
      message: linked
        ? `PO ${po.poCode} đã được tạo từ đề xuất này — đã liên kết, không tạo mới`
        : `Đã tạo PO ${po.poCode}`,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
// Export phụ để test được parser (INTENTS/extract không nằm trên router).
module.exports.extractPO = extractPO;
module.exports.extractOrder = extractOrder;
module.exports.INTENTS = INTENTS;
module.exports.TOOL_HANDLERS = TOOL_HANDLERS;
