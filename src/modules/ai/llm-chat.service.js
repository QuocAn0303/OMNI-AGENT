/**
 * modules/ai/llm-chat.service.js — Kết nối DB Agent với LLM (Qwen)
 * 
 * Tổng quan:
 * - Orchestrate: NL query → LLM tool call → execute Prisma tool → LLM response
 * - Fallback tự động khi LLM không available (dùng keyword matching + template)
 * - Gọi trực tiếp Python inference process qua queryModel()
 * 
 * Hàm:
 * - inferTool(query): Gọi LLM để xác định tool + params từ câu hỏi
 * - generateNLResponse(query, data, toolName): Gọi LLM để paraphrase kết quả
 * - chat(query): Pipeline đầy đủ: LLM → tool → LLM
 */

const { queryModel, startPythonProcess } = require('./agent.llm');
const { HANDLERS, resolveIntent, extractParams } = require('./db-agent.service');

const TOOL_DESCRIPTIONS = [
  { name: 'search_products', desc: 'Tra cứu sản phẩm', params: 'search (từ khóa), categoryId (danh mục), minPrice, maxPrice, limit, sortBy (price/name/createdAt), sortOrder (asc/desc)' },
  { name: 'search_orders', desc: 'Tra cứu đơn hàng', params: 'status (PENDING/CONFIRMED/SHIPPING/COMPLETED/CANCELLED), paymentStatus (UNPAID/PAID/PARTIAL), period (today/this_month/last_month), customerId, minTotal, maxTotal, limit' },
  { name: 'search_customers', desc: 'Tra cứu khách hàng', params: 'search (tên/SĐT), tier (hạng), hasDebt (true), minSpent, sortBy (totalSpent/createdAt), limit' },
  { name: 'search_inventory', desc: 'Tra cứu tồn kho', params: 'search (tên sản phẩm), warehouseId (kho), lowStock (true: chỉ lấy hàng sắp hết), productId, limit' },
  { name: 'get_revenue', desc: 'Thống kê doanh thu', params: 'period (today/this_month/last_month/this_year), status (lọc theo trạng thái đơn)' },
  { name: 'search_finance', desc: 'Tra cứu tài chính', params: 'type (expenses/journal/accounts), period, limit' },
  { name: 'search_hr', desc: 'Tra cứu nhân sự', params: 'type (payroll/attendance mặc định employee), search, period, limit' },
  { name: 'search_production', desc: 'Tra cứu sản xuất', params: 'type (work_orders/bom/lots), status, expiringSoon (true), limit' },
  { name: 'search_projects', desc: 'Tra cứu dự án', params: 'status, search, limit' },
  { name: 'search_debts', desc: 'Tra cứu công nợ', params: 'customerId, status, type, limit' },
  { name: 'search_vendors', desc: 'Tra cứu nhà cung cấp', params: 'search (tên/MST), limit' },
  { name: 'search_purchase_orders', desc: 'Tra cứu đơn nhập hàng', params: 'status, vendorId, period, limit' },
  { name: 'search_promotions', desc: 'Tra cứu khuyến mãi', params: 'status, type, limit' },
  { name: 'search_invoices', desc: 'Tra cứu hóa đơn', params: 'period, status, limit' },
  { name: 'search_deliveries', desc: 'Tra cứu giao hàng', params: 'status, provider, period, limit' },
  { name: 'search_returns', desc: 'Tra cứu trả hàng', params: 'period, status, limit' },
  { name: 'get_dashboard', desc: 'Dashboard tổng quan kinh doanh', params: '(không cần tham số)' },

  // Write tools — HÀNH ĐỘNG (cần xác nhận human-gate)
  { name: 'create_order', desc: 'Tạo đơn hàng mới', params: 'customerName (tên KH), customerPhone (SĐT KH), items (mảng [{productName, quantity, price}]), paymentMethod (CASH/BANK_TRANSFER/CARD), note (ghi chú)' },
  { name: 'create_po', desc: 'Tạo đơn nhập hàng mới', params: 'vendorName (tên NCC), items (mảng [{productName, quantity, unitCost}]), note (ghi chú), expectedAt (ngày dự kiến nhận)' },
  { name: 'send_reminder', desc: 'Gửi nhắc nợ cho khách hàng', params: 'customerName (tên KH), debtId (ID công nợ), message (nội dung nhắc)' },
];

function buildToolPrompt(query) {
  return `Ban la tro ly ERP Aduu chuyen mon. Nhiem vu: chon cong cu (tool) phu hop nhat va trich xuat tham so tu cau hoi.

Cac cong cu:
- search_products: Tim kiem san pham. Tham so: search (ten/SKU), categoryId, minPrice, maxPrice, limit, sortBy (price/name/createdAt), sortOrder (asc/desc)
- search_orders: Tim kiem don hang. Tham so: status (PENDING/CONFIRMED/SHIPPING/COMPLETED/CANCELLED), paymentStatus (UNPAID/PAID/PARTIAL), period (today/this_month/last_month/this_year), customerId, minTotal, maxTotal, limit
- search_customers: Tim kiem khach hang. Tham so: search (ten/SDT/email), tier, hasDebt (true), minSpent, sortBy (totalSpent/createdAt), limit
- search_inventory: Tra cuu ton kho. Tham so: search (ten san pham), warehouseId, lowStock (true: chi lay hang sap het), productId, limit
- get_revenue: Thong ke doanh thu. Tham so: period (today/this_month/last_month/this_year), status
- search_finance: Tra cuu tai chinh. Tham so: type (expenses/journal/accounts), period, limit
- search_hr: Tra cuu nhan su. Tham so: type (payroll/attendance), search, period, limit
- search_production: Tra cuu san xuat. Tham so: type (work_orders/bom/lots), status, expiringSoon(true), limit
- search_debts: Tra cuu cong no. Tham so: customerId, status, type (RECEIVABLE/PAYABLE), limit
- search_vendors: Tra cuu nha cung cap. Tham so: search (ten/MST), limit
- search_purchase_orders: Tra cuu don nhap hang (PO). Tham so: status, vendorId, period, limit
- search_promotions: Tra cuu khuyen mai. Tham so: status, type, limit
- search_invoices: Tra cuu hoa don. Tham so: period, limit
- get_dashboard: Dashboard tong quan kinh doanh. (khong can tham so)

- create_order: TAO don hang moi (can ADMIN/MANAGER). Tham so: customerName, customerPhone, items (mang [{productName, quantity, price}]), paymentMethod (CASH/BANK_TRANSFER/CARD), note
- create_po: TAO don nhap hang moi (can ADMIN/MANAGER). Tham so: vendorName, items (mang [{productName, quantity, unitCost}]), note, expectedAt
- send_reminder: GUI nhac no cho khach (can ADMIN/MANAGER). Tham so: customerName, debtId, message

Quy tac:
1. Chon cong cu phu hop nhat voi cau hoi
2. Trich xuat tham so tu cau hoi (ten, thoi gian, trang thai, so luong...)
3. Neu co "top N" hoac "N moi nhat" → set limit = N
4. Neu co "thang nay/tuan nay/hom nay" → set period tuong ung
5. Neu co "ke toan", "so cai", "ket chuyen", "khau hao", "thue" → dung search_finance
6. Neu co "cong thuc", "cach tinh" → co gang tim tool lien quan

Tra ve JSON DUY NHAT dang: { "tool": "ten_tool", "params": { ... } }
KHONG them text nao khac ngoai JSON.

Cau hoi: "${query}"`;
}

async function inferTool(query) {
  try {
    startPythonProcess();
    const toolPrompt = buildToolPrompt(query);
    // Step 1: Call LLM to get tool call
    const toolResult = await queryModel({ query: toolPrompt, entities: {} });

    if (toolResult && toolResult.toolCall && toolResult.toolCall.tool) {
      let toolName = toolResult.toolCall.tool;
      let params = toolResult.toolCall.params || {};

      // Validate tool exists
      if (!HANDLERS[toolName]) {
        // Try fuzzy matching
        const found = Object.keys(HANDLERS).find(k => k.includes(toolName) || toolName.includes(k));
        if (found) toolName = found;
        else return null; // LLM returned invalid tool
      }

      return { tool: toolName, params };
    }
    return null;
  } catch (err) {
    console.error('[LLM-Chat] inferTool error:', err.message);
    return null;
  }
}

async function generateNLResponse(query, result, toolName) {
  try {
    startPythonProcess();

    const dataPreview = Array.isArray(result.data)
      ? result.data.slice(0, 5).map(d => JSON.stringify(d)).join('\n')
      : JSON.stringify(result.data);

    const prompt =
      `Bạn là trợ lý ERP thông minh. Trả lời bằng tiếng Việt, ngắn gọn, chính xác.
Dựa trên dữ liệu bên dưới để trả lời. Chỉ nói những gì có trong dữ liệu.

Người dùng hỏi: ${query}
Tool đã dùng: ${toolName}
Tổng số bản ghi tìm thấy: ${result.total}
Dữ liệu:
${dataPreview}

${result.summary ? `Tóm tắt: ${result.summary}` : ''}

Trả lời:`;

    const response = await queryModel({ prompt, mode: 'response' });
    if (response && response.response) return response.response.trim();
    return null;
  } catch (err) {
    console.error('[LLM-Chat] generateNLResponse error:', err.message);
    return null;
  }
}

async function chat(query) {
  // Step 1: Try LLM for tool inference
  let intent = await inferTool(query);

  // Step 2: Fallback to keyword matching if LLM failed
  if (!intent) {
    const tool = resolveIntent(query);
    if (!tool) {
      return {
        success: false,
        message: 'Xin chào! Tôi có thể giúp bạn tra cứu dữ liệu. Hãy hỏi về sản phẩm, đơn hàng, khách hàng, doanh thu, nhân sự, sản xuất...',
      };
    }
    intent = { tool, params: extractParams(query, tool) };
  }

  // Step 3: Execute tool
  console.log(`[LLM-Chat] Executing: ${intent.tool}`, JSON.stringify(intent.params));

  let result;
  try {
    result = await HANDLERS[intent.tool](intent.params);
  } catch (err) {
    return { success: false, message: `Lỗi khi truy vấn: ${err.message}` };
  }

  if (!result.data || (Array.isArray(result.data) && result.data.length === 0)) {
    return { success: true, message: `Không tìm thấy dữ liệu phù hợp cho "${query}".` };
  }

  // Step 4: Try LLM for natural language response
  let llmReply = await generateNLResponse(query, result, intent.tool);

  if (llmReply) {
    return { success: true, message: llmReply, data: result.data, total: result.total };
  }

  // Step 5: Fallback to template response
  let reply = result.summary ? `${result.summary}\n\n` : '';
  reply += result.message || '';

  return {
    success: true,
    message: reply.trim() || 'Đã tìm thấy dữ liệu.',
    data: result.data,
    total: result.total,
  };
}

module.exports = { chat, inferTool, generateNLResponse };
