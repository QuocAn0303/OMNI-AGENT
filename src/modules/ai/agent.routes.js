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

const router = express.Router();
router.use(authenticate);

const prisma = require('../../config/prisma');
const { processQuery, generateResponse, HANDLERS } = require('./db-agent.service');
const logger = require('../../utils/logger');

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
]);

const SENSITIVE_ALLOWED_ROLES = [
  'SUPER_OMEGA_ULTRA_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'ACCOUNTANT',
];

const isSensitiveAllowed = (role) => SENSITIVE_ALLOWED_ROLES.includes(role);

const createDataRequest = (sessionId, tool, params) => {
  return prisma.agentHumanGate.create({
    data: {
      actionType: 'DATA_REQUEST',
      sessionId,
      actionPayload: { tool, params },
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  }).catch(() => {});
};

const DATA_REQUEST_REPLY =
  'Dữ liệu bạn yêu cầu thuộc loại nhạy cảm (thông tin khách hàng, nhân viên hoặc tài chính). ' +
  'Yêu cầu đã được gửi tới ADMIN/MANAGER để phê duyệt. Kết quả sẽ được cập nhật sau khi được duyệt.';

const TOOL_HANDLERS = {
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
    return `💰 Doanh thu ${label}:\n• Tổng: ${Number(agg._sum.total || 0).toLocaleString()}đ\n• Số đơn: ${agg._count.id}`;
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
    return result.summary || result.message || 'Đã tạo đơn hàng';
  },

  createPO: async ({ vendorName, productName, quantity, unitCost }, userId, sessionId) => {
    const result = await HANDLERS.create_po({
      vendorName: vendorName || '',
      productName: productName || '',
      quantity: parseInt(quantity) || 1,
      unitCost: parseFloat(unitCost) || 0,
    }, userId);
    return result.summary || result.message || 'Đã tạo đơn nhập hàng';
  },

  sendReminder: async ({ customerName }, userId, sessionId) => {
    const result = await HANDLERS.send_reminder({
      customerName: customerName || '',
    }, userId, sessionId);
    return result.summary || result.message || 'Đã gửi nhắc nợ';
  },
};

const INTENTS = [
  // Write intents MUST come first — they conflict with read patterns (y hệt db-agent INTENT_MAP)
  { keywords: ['tạo đơn hàng', 'tạo order', 'đặt hàng', 'bán cho'], tool: 'createOrder', isWrite: true,
    extract: (msg) => {
      const customer = msg.match(/(cho|khách)\s+(.+?)(?:\s+\d+\s|$)/i);
      const qtyMatch = msg.match(/(\d+)\s*(cái|chiếc|hộp|kg|sản phẩm|sp)?/i);
      const product = msg.replace(/tạo đơn hàng|tạo order|đặt hàng|bán cho|cho|khách|nhập|thêm/gi, '').replace(/\d+\s*(cái|chiếc|hộp|kg|sp)?/gi, '').trim();
      return {
        customerName: customer ? customer[2].trim() : '',
        productName: product,
        quantity: qtyMatch ? qtyMatch[1] : 1,
      };
    }
  },
  { keywords: ['tạo đơn nhập', 'tạo po', 'đặt hàng nhập', 'nhập thêm', 'tạo purchase order'], tool: 'createPO', isWrite: true,
    extract: (msg) => {
      const vendor = msg.match(/(từ|ncc|nhà cung cấp)\s+(.+?)(?:\s+\d+\s|$)/i);
      const qtyMatch = msg.match(/(\d+)\s*(cái|chiếc|hộp|kg|sp)?/i);
      const product = msg.replace(/tạo đơn nhập|tạo po|đặt hàng nhập|nhập thêm|từ|ncc|nhà cung cấp/gi, '').replace(/\d+\s*(cái|chiếc|hộp|kg|sp)?/gi, '').trim();
      const costMatch = msg.match(/(\d+[\d,.]*)\s*(đ|vnđ|vnd|k|tr)/i);
      return {
        vendorName: vendor ? vendor[2].trim() : '',
        productName: product,
        quantity: qtyMatch ? qtyMatch[1] : 1,
        unitCost: costMatch ? parseFloat(costMatch[1].replace(/,/g, '')) : 0,
      };
    }
  },
  { keywords: ['nhắc nợ', 'gửi nhắc', 'nhắc khách', 'đòi nợ', 'remind'], tool: 'sendReminder', isWrite: true,
    extract: (msg) => {
      const customer = msg.match(/(nhắc|khách|cho)\s+(.+?)(?:\s|$)/i);
      return { customerName: customer ? customer[2].trim() : msg.replace(/nhắc nợ|gửi nhắc|nhắc khách|đòi nợ|remind/gi, '').trim() };
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
    const intent = detectIntent(userMsg);
    logger.info('[Agent Chat] Intent:', intent?.tool, 'Msg:', logger.truncateLog(userMsg));

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
    let reply, stepType = 'FAST_PATH', toolName = null;

    if (intent && TOOL_HANDLERS[intent.tool]) {
      toolName = intent.tool;

      if (intent.isWrite) {
        // Write operations: require ADMIN or MANAGER role
        if (!['ADMIN', 'MANAGER'].includes(req.user.role)) {
          reply = 'Xin lỗi, bạn không có quyền thực hiện thao tác này. Chỉ ADMIN và MANAGER mới có thể tạo đơn hàng, nhập hàng, hoặc gửi nhắc nợ.';
          stepType = 'TOOL_CALL';
        } else {
          reply = await TOOL_HANDLERS[intent.tool](intent.params, req.user.id, session.id);
          stepType = 'TOOL_CALL';

          await prisma.agentHumanGate.create({
            data: {
              actionType: toolName,
              sessionId: session.id,
              actionPayload: intent.params,
              status: 'APPROVED',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          }).catch(() => {});
        }
      } else if (SENSITIVE_TOOLS.has(intent.tool) && !isSensitiveAllowed(req.user.role)) {
        // M3: role thấp hỏi tool nhạy cảm → tạo request chờ phê duyệt
        stepType = 'TOOL_CALL';
        await createDataRequest(session.id, intent.tool, intent.params);
        reply = DATA_REQUEST_REPLY;
      } else {
        reply = await TOOL_HANDLERS[intent.tool](intent.params);
        reply = `📋 **${intent.tool}**\n\n${reply}`;
      }
    } else {
      try {
        const dbResult = await processQuery(userMsg);
        if (dbResult.success && dbResult.data?.length > 0) {
          if (SENSITIVE_DB_TOOLS.has(dbResult.tool) && !isSensitiveAllowed(req.user.role)) {
            // M3: fallback tool nhạy cảm → request chờ phê duyệt
            stepType = 'TOOL_CALL';
            await createDataRequest(session.id, dbResult.tool, dbResult.params);
            reply = DATA_REQUEST_REPLY;
          } else {
            stepType = 'LLM_CALL';
            reply = await generateResponse(userMsg, dbResult);
          }
        } else {
          reply = 'Xin chào! Tôi có thể giúp bạn:\n' +
            '• 📦 Tra cứu tồn kho (vd: "tồn kho sáp treo")\n' +
            '• 📋 Xem đơn hàng (vd: "đơn hàng hôm nay")\n' +
            '• 👤 Tra cứu khách hàng (vd: "khách hàng Nguyễn Văn A")\n' +
            '• 📊 Dashboard (vd: "tình hình kinh doanh")\n' +
            '• 💰 Doanh thu (vd: "doanh thu tháng này")\n' +
            '• 👥 Nhân sự (vd: "thông tin nhân sự")\n' +
            '• 🏭 Sản xuất (vd: "lệnh sản xuất tháng này")\n' +
            '• 💳 Công nợ (vd: "công nợ khách hàng")\n' +
            '• 📄 Đơn nhập hàng (vd: "PO chờ duyệt")\n' +
            '• 📊 Báo cáo tài chính (vd: "chi phí tháng này")';
        }
      } catch {
        reply = 'Xin chào! Tôi có thể giúp bạn tra cứu dữ liệu database. Hãy đặt câu hỏi về sản phẩm, đơn hàng, khách hàng, doanh thu...';
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
        path: intent?.tool ? 'fast_path' : 'fallback_llm',
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

router.post('/human-gates/:id/decide', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, note } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw { status: 400, message: 'decision must be APPROVED or REJECTED' };
    }

    const gate = await prisma.agentHumanGate.findUnique({ where: { id } });
    if (!gate) throw { status: 404, message: 'Human gate not found' };
    if (gate.status !== 'PENDING') throw { status: 400, message: `Gate is already ${gate.status}` };
    if (new Date(gate.expiresAt) < new Date()) throw { status: 400, message: 'Gate has expired' };

    const updated = await prisma.agentHumanGate.update({
      where: { id },
      data: {
        status: decision,
        resolvedAt: new Date(),
        resolvedBy: req.user.id,
        resolvedNote: note || null,
      },
    });

    if (decision === 'APPROVED') {
      await prisma.agentSession.update({
        where: { id: gate.sessionId },
        data: { status: 'COMPLETED', finalResult: { approved: true, actionType: gate.actionType, payload: gate.actionPayload } },
      }).catch(() => {});
    }

    res.json({ success: true, data: updated, message: decision === 'APPROVED' ? 'Đã phê duyệt' : 'Đã từ chối' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;