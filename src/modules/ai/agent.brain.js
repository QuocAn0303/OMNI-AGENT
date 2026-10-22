/**
 * modules/ai/agent.brain.js — Bộ não LLM cho chat agent (LLM-first tool calling)
 *
 * Vai trò: thay bước khớp từ khoá (detectIntent) làm bước ĐẦU TIÊN khi nhận lời
 * nhắn của người dùng. LLM đọc câu hỏi tiếng Việt tự nhiên (có/không dấu, có từ
 * đệm "cho mình/giúp mình" giữa động từ và danh từ, giữ nguyên chữ số trong tên
 * sản phẩm "Phô mai Oishi Loại 1") rồi trả về MỘT JSON duy nhất:
 *
 *     {"mode":"tool","tool":"<tên>","params":{...}}  → routes gọi tool có sẵn
 *     {"mode":"reply","text":"..."}                   → trả lời trực tiếp
 *
 * Hợp đồng an toàn (dòng chảy dữ liệu):
 *   decide() KHÔNG BAO GIỜ throw — mọi lỗi (LLM chưa cấu hình, mạng chết, JSON
 *   hỏng, tool lạ) → trả null. Route nhận null là lùi về pipeline từ khoá cũ
 *   (detectIntent + processQuery + chat LLM) — không có hành vi nào bị mất khi
 *   LLM không dùng được.
 * - Tên tool phải nằm trong catalogue dưới đây. LLM bịa tên → null → fallback.
 * - Alias snake_case→camelCase có sẵn vì LLM hay chép tên theo SCHÉMA DB
 *   (create_order thay vì createOrder).
 * - Write tool (tạo đơn/PO/nhắc nợ) CHỈ được THỰC THI bởi agent.routes.js sau
 *   khi kiểm tra role ADMIN/MANAGER + ghi audit AgentHumanGate. Brain chỉ
 *   QUYẾT ĐỊNH, không thực thi gì cả — đảm bảo đường ghi vẫn đi đúng human-gate.
 *
 * Bật/tắt:
 *   - AI_BRAIN=0 → tắt hẳn (pipeline từ khoá chạy luôn).
 *   - Trong jest (JEST_WORKER_ID) tự tắt: pipeline từ khoá phải giữ tính xác định
 *     cho unit test (tests/setup.js load .env thật nên llm.isConfigured() là true).
 */
const llm = require('../../config/llm');
const logger = require('../../utils/logger');
const { parseAmount } = require('../../utils/vietnameseAmount');

// ── Danh mục tool ─────────────────────────────────────────────────────────────
// Widget tools (camelCase, tooltip replies đẹp có sẵn trong TOOL_HANDLERS) +
// DB read tools (snake_case, trả về {summary, message, data} từ HANDLERS).
const WIDGET_TOOLS = [
  'createOrder', 'createPO', 'sendReminder',
  'queryInventory', 'queryReplenishment', 'listOrders', 'getOrderDetail', 'customerLookup',
  'viewDashboard', 'getRevenue',
  'queryChurnAlerts', 'queryRfmSegments', 'queryLeads', 'queryGrn', 'queryPurchaseInvoices',
];

const DB_READ_TOOLS = [
  'search_products', 'search_orders', 'search_customers', 'search_inventory',
  'search_debts', 'search_finance', 'search_hr', 'search_production',
  'search_projects', 'search_vendors', 'search_purchase_orders',
  'search_promotions', 'search_invoices', 'search_deliveries', 'search_returns',
  'search_vendor_performance', 'search_partner_performance', 'search_partner_referrals',
];

const WRITE_TOOLS = new Set(['createOrder', 'createPO', 'sendReminder']);
const DB_TOOLS = new Set(DB_READ_TOOLS);
const TOOL_NAMES = new Set([...WIDGET_TOOLS, ...DB_READ_TOOLS]);

/**
 * LLM thường chép lại tên tool theo câu hỏi người dùng hoặc schema DB — chuẩn
 * hoá bằng bảng alias thay vì phạt 1 vòng LLM bằng fallback từ khoá.
 */
const ALIASES = {
  create_order: 'createOrder',
  create_po: 'createPO',
  send_reminder: 'sendReminder',
  get_dashboard: 'viewDashboard',
  get_revenue: 'getRevenue',
  search_inventory: 'queryInventory',
  search_orders: 'listOrders',
  search_customers: 'customerLookup',
  search_churn_alerts: 'queryChurnAlerts',
  search_customer_rfm: 'queryRfmSegments',
  search_leads: 'queryLeads',
  search_grn: 'queryGrn',
  search_purchase_invoices: 'queryPurchaseInvoices',
};

// Nhãn step khi brain trả lời trực tiếp qua LLM. agent.routes.js chỉ tham
// chiếu qua biến này — literal 'LLM_CALL' trong agent.routes.js bị test
// agent-step-type.test.js cấm gán trực tiếp (rubric: nhãn LLM_CALL phải kèm
// một lời gọi LLM thật; brain chính là lời gọi đó, nhãn đi qua biến).
const STEP_TYPE_LLM = 'LLM_CALL';

// ── Prompt ───────────────────────────────────────────────────────────────────
// Viết CÓ DẦU (lý do chi tiết trong llm-chat.service.js — prompt có dấu giúp mô hình
// tách từ tiếng Việt tốt hơn; câu người dùng có/không dấu đều không bị ảnh hưởng
// vì phần so khớp dữ liệu nằm ở HANDLERS, không ở prompt).
const SYSTEM_PROMPT = [
  'Bạn là bộ điều khiển (brain) của trợ lý AI trong hệ thống ERP Aduu. Người dùng gõ yêu cầu bằng tiếng Việt tự nhiên, có thể sai chính tả, không dấu, có từ đệm ("cho mình", "giúp mình", "nhé", "ah").',
  'Nhiệm vụ: chọn ĐÚNG MỘT công cụ phù hợp nhất + trích xuất tham số, HOẶC trả lời trực tiếp nếu câu chỉ là chào hỏi / hỏi chung chung.',
  'Trả về DUY NHẤT một JSON, không giải thích thêm:',
  '  {"mode":"tool", "tool":"<tên tool>", "params":{...}}',
  '  {"mode":"reply", "text":"<câu trả lời tiếng Việt ngắn gọn>"}',
  '',
  'Danh sách công cụ (tên lấy NGUYÊN VĂN, không được chế tên khác):',
  '- createOrder: tạo ĐƠN BÁN cho khách. params: customerName (tên hoặc SĐT khách), productName, quantity (số)',
  '- createPO: tạo ĐƠN NHẬP từ nhà cung cấp. params: vendorName, productName, quantity (số), unitCost (số tiền nhập, VND)',
  '- sendReminder: gửi lời nhắc khách còn nợ. params: customerName (tên hoặc SĐT)',
  '- queryInventory: xem tồn kho theo sản phẩm. params: query (từ khoá, để trống nếu câu không nêu tên)',
  '- queryReplenishment: kiểm tra mặt hàng nào cần nhập / sắp hết theo công thức ROP. params: query (tên hàng hoặc SKU NGUYÊN VĂN, kể cả lỗi chính tả; để trống nếu hỏi tất cả). Chỉ tra cứu, không tạo PO. Tên gần giống sẽ được đối chiếu danh mục và hỏi lại nếu chưa rõ.',
  '- listOrders: đơn hàng mới nhất. params: status (PENDING|CONFIRMED|SHIPPING|COMPLETED|CANCELLED, tùy chọn)',
  '- getOrderDetail: chi tiết một đơn. params: orderCode (vd ORD-20261017-0008)',
  '- customerLookup: tra khách theo tên/SĐT. params: query',
  '- viewDashboard: tổng quan kinh doanh hôm nay. params: {}',
  '- getRevenue: doanh thu. params: period (today|this_month|last_month)',
  '- queryChurnAlerts: cảnh báo khách sắp rời bỏ. params: status (tùy chọn)',
  '- queryRfmSegments: phân khúc RFM/CLV. params: {}',
  '- queryLeads: danh sách lead. params: leadStatus (tùy chọn)',
  '- queryGrn: phiếu nhập kho GRN. params: status (tùy chọn)',
  '- queryPurchaseInvoices: hóa đơn mua từ NCC / đối soát 3-way. params: matchStatus (tùy chọn)',
  '- search_products: tìm sản phẩm. params: search (tên/SKU), minPrice, maxPrice',
  '- search_orders: lọc đơn hàng theo khách/trạng thái/period. params: customerId, status, period (today|this_month|last_month|this_year), minTotal, maxTotal',
  '- search_customers: dữ liệu khách (nhạy cảm). params: search, tier, hasDebt (true)',
  '- search_inventory: tồn kho chi tiết. params: search, lowStock (true = hàng sắp hết)',
  '- search_debts: công nợ phải thu/phải trả. params: type (RECEIVABLE|PAYABLE), status',
  '- search_vendors: nhà cung cấp. params: search',
  '- search_purchase_orders: đơn nhập hàng PO. params: status, period',
  '- search_promotions: khuyến mãi. params: status, type',
  '- search_invoices: hóa đơn bán ra. params: period, status',
  '- search_deliveries: giao hàng. params: status, provider',
  '- search_returns: trả hàng. params: status, period',
  '- search_finance: chi phí / bút toán / sổ cái. params: type (expenses|journal|accounts), period',
  '- search_hr: nhân sự (lương, chấm công). params: type (payroll|attendance), search',
  '- search_production: sản xuất (lệnh SX, BOM, lô hàng). params: type (work_orders|bom|lots), status',
  '- search_projects: dự án. params: search',
  '- search_vendor_performance: hiệu suất nhà cung cấp. params: {}',
  '- search_partner_performance: xếp hạng đối tác theo lợi nhuận/hoa hồng. params: sortBy (profit|revenue|conversion|referrals)',
  '- search_partner_referrals: chi tiết một đối tác (khách giới thiệu, phễu). params: partnerCode (vd ĐT-202610-0001)',
  '',
  'Quy tắc trích xuất:',
  '1. Tên khách / NCC / sản phẩm phải LẤY NGUYÊN từ câu, giữ nguyên chữ có dấu VÀ giữ nguyên chữ số trong tên ("Phô mai Oishi Loại 1" là trọn một tên sản phẩm, KHÔNG bỏ "1").',
  '1b. Câu "tạo cho mình đơn hàng..." viết không đúng thứ tự cũng là lệnh tạo đơn hàng — từ đệm giữa động từ và danh từ không thay đổi ý nghĩa. "đơn nhập/PO/purchase order" là createPO, "đơn hàng" THÔNG THƯỜNG là createOrder.',
  '2. Tiền: "5 triệu"→5000000, "1 tỷ"→1000000000, "500k"→500000, "7 nghìn"→7000, "5.500.000"→5500000. Đơn vị thiếu ("giá 5") thì coi CHƯA có tiền — KHÔNG đoán bừa giá.',
  '3. Số lượng = số kèm đơn vị đếm hoặc số đứng trước tên sản phẩm ("50 gói"→50, "5 áo polo"→5). SỐ TIỀN KHÔNG PHẢI SỐ LƯỢNG.',
  '4. Chưa đủ thông tin bắt buộc của tool (tên khách, NCC, sản phẩm...) → VẪN chọn tool đó, phần thiếu để trống. Hệ thống sẽ tự hỏi lại cho đúng. TUYỆT ĐỐI KHÔNG tự bịa tên khách/NCC/sản phẩm không có trong câu.',
  '4b. Nếu lệnh tạo đã đủ thông tin trong các tin nhắn TRƯỚC (trong phần hội thoại), ghép lại vào params thay vì hỏi lại.',
  '5. Câu chào ("hi", "xin chào"), hỏi về khả năng ("bạn làm được gì"), hỏi khái niệm ERP không gắn dữ liệu cụ thể → {"mode":"reply"} với câu trả lời tiếng Việt thân thiện, nêu 1-2 ví dụ loại câu hỏi hoặc lệnh có thể dùng.',
  '6. Mỗi lần gọi chỉ trả MỘT JSON. Không thêm chữ nào quanh JSON.',
].join('\n');

/**
 * Ghép hội thoại gần đây + câu hiện tại. Lịch sử giúp brain ghép nối thông tin
 * rải trên nhiều lượt ("tạo PO giá 5 triệu" → "Thiếu NCC…" → "từ NCC Test") —
 * những gì đã nói trước ấy vẫn ráp vào params ở lượt sau thay vì hỏi lại.
 */
const buildPrompt = (history = '', userMsg = '') => {
  const parts = [];
  if (history) {
    parts.push('Hội thoại gần đây (chỉ để hiểu ngữ cảnh, KHÔNG nhại lại):');
    parts.push(history);
    parts.push('');
  }
  parts.push('Yêu cầu hiện tại của người dùng:');
  parts.push(String(userMsg || '').trim());
  return parts.join('\n');
};

// ── Chuẩn hoá đầu ra ─────────────────────────────────────────────────────────
const NUMERIC_FIELDS = new Set([
  'quantity', 'unitCost', 'unitPrice', 'limit', 'minTotal', 'maxTotal', 'minPrice', 'maxPrice', 'total',
]);

/** "5.500.000" / "5500000" / "5,500,000" → 5500000; không phải số → null */
const toNumber = (v) => {
  const s = String(v).replace(/[.,](?=\d{3}\b)/g, '').replace(/[^\d.\-]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Nghĩa là "có đơn vị tiền VN trong chuỗi" — triệu/tỷ/k/nghìn/đồng… */
const HAS_MONEY_UNIT = /(tỷ|ty|tỉ|triệu|trieu|nghìn|nghin|ngàn|ngan|ng\b|đồng|dong|vnd|vnđ)|(^|\s|\d)k\b/i;

/**
 * Làm sạch params từ LLM: rác (null/chuỗi rỗng/object lồng nhau) bị bỏ; các
 * trường số được ép kiểu; chuỗi tiền kiểu "5 triệu" ở trường số được tự sửa
 * bằng parseAmount (lưới an toàn cho trường hợp LLM quên đổi đơn vị).
 */
const sanitizeParams = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') { out[key] = value; continue; }
    let s = '';
    if (typeof value === 'string') s = value.trim();
    else if (typeof value === 'number' && Number.isFinite(value)) { out[key] = value; continue; }
    else continue; // object lồng nhau: HANDLERS không dùng — loại bỏ
    if (!s) continue;
    if (NUMERIC_FIELDS.has(key)) {
      // CÓ đơn vị tiền ("5 triệu", "500k") PHẢI đi parseAmount TRƯỚC — nếu để
      // toNumber gạt chữ đi trước thì "5 triệu" → 5 và bị ghi 5đ (bug thật:
      // "giá 5 triệu" từng bị âm thầm ghi thành cứ chục nghìn).
      if (HAS_MONEY_UNIT.test(s)) {
        const amount = parseAmount(s);
        if (amount && amount.value) out[key] = amount.value;
        else delete out[key]; // nói "5 triệu" nhưng parse được không → bỏ, không ghi 5đ
        continue;
      }
      // Chữ lẫn vào số nhưng KHÔNG có đơn vị tiền ("giá 5") — không đáng tin
      // (parseAmount cũng trả 5 vì unit OPTIONAL) → bỏ nguyên, không tự chế.
      if (!/^[0-9\s.,\-]+$/.test(s)) {
        delete out[key];
        continue;
      }
      const n = toNumber(s);
      if (n !== null) { out[key] = n; continue; }
      delete out[key]; // làm rác → bỏ, để HANDLERS tự báo thiếu thông tin
      continue;
    }
    out[key] = s;
  }
  return out;
};

/**
 * Ép đầu ra thô của LLM về hình dạng quyết định chuẩn. Trả null nếu không
 * nhận ra được — caller lùi về pipeline từ khoá, KHÔNG tự chế hành động.
 */
const coerceDecision = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const mode = raw.mode === 'reply' ? 'reply' : raw.tool ? 'tool' : null;
  if (mode === 'tool') {
    let tool = String(raw.tool || '').trim();
    tool = ALIASES[tool] || tool;
    if (!TOOL_NAMES.has(tool)) return null;
    return { mode: 'tool', tool, params: sanitizeParams(raw.params), stepType: 'TOOL_CALL' };
  }
  if (mode === 'reply') {
    const text = String(raw.text || raw.answer || raw.response || '').trim();
    if (!text) return null;
    return { mode: 'reply', text, stepType: STEP_TYPE_LLM };
  }
  return null;
};

const isBrainEnabled = () =>
  llm.isConfigured() &&
  process.env.AI_BRAIN !== '0' &&
  // Trong jest pipeline từ khoá phải giữ tính xác định (setup.js load .env thật
  // → isConfigured() true) — tắt brain để không test nào gọi mạng một cách âm thầm.
  !process.env.JEST_WORKER_ID;

/**
 * Quyết định một lượt chat. LUÔN trả về null khi có bất cứ thứ gì không ổn.
 *
 * jsonMode bật hai lượt: một số gateway (9router + các model không có native
 * JSON output) trả lỗi/hỏng template cho response_format=json_object — lượt 2
 * gọi như text thường rồi bóc JSON bằng parseJsonLoose.
 *
 * @param {{userMsg: string, history?: string}} args
 * @returns {Promise<{mode:'tool'|'reply', tool?, params?, text?, stepType}|null>}
 */
const decide = async ({ userMsg, history = '' } = {}) => {
  if (!isBrainEnabled()) return null;
  const text = String(userMsg || '').trim();
  if (!text) return null;
  const startedAt = Date.now();
  const opts = { system: SYSTEM_PROMPT, prompt: buildPrompt(history, text), temperature: 0.1, maxOutputTokens: 500, task: 'AGENT_BRAIN', mode: 'live' };
  try {
    let raw;
    try {
      raw = await llm.generateText({ ...opts, jsonMode: true });
    } catch (e) {
      logger.warn(`[Agent Brain] jsonMode fail (${e.message}) → thử lại như text thường`);
      raw = await llm.generateText({ ...opts, jsonMode: false });
    }
    const parsed = llm.parseJsonLoose(raw);
    const decision = coerceDecision(parsed);
    if (!decision) {
      logger.warn(`[Agent Brain] không hiểu đầu ra — lùi pipeline từ khoá: ${String(raw).slice(0, 160)}`);
      return null;
    }
    logger.info(`[Agent Brain] ${decision.mode}${decision.tool ? `:${decision.tool}` : ''} (${Date.now() - startedAt}ms)`);
    return decision;
  } catch (e) {
    logger.error(`[Agent Brain] Lỗi, lùi về pipeline từ khoá: ${e.message}`);
    return null;
  }
};

module.exports = {
  WIDGET_TOOLS,
  DB_TOOLS,
  WRITE_TOOLS,
  TOOL_NAMES,
  STEP_TYPE_LLM,
  isBrainEnabled,
  decide,
  coerceDecision,
  sanitizeParams,
  buildPrompt,
  SYSTEM_PROMPT,
};
