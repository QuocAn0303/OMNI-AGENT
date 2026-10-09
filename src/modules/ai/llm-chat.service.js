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
const { HANDLERS, resolveIntent, extractParams, isWriteTool } = require('./db-agent.service');
const logger = require('../../utils/logger');

/**
 * Endpoint này là READ-ONLY. Write tool bị chặn ở đây (service) chứ không chỉ ở
 * route, vì `chat()` là hàm được require ở nhiều nơi — chặn ở route là chặn hụt.
 *
 * LLM tự chọn tool, nên không thể tin prompt nói "chọn tool phù hợp": `create_po`
 * là một tool hợp lệ trong danh mục và LLM hoàn toàn có thể chọn nó khi người
 * dùng hỏi "tạo đơn nhập cho tôi". Đường hợp lệ cho hành động ghi là
 * `POST /api/agent/chat` (tool nhận diện chủ động + human-gate).
 */
const WRITE_TOOL_REFUSAL = (tool) => ({
  success: false,
  message: `Thao tác "${tool}" là hành động ghi dữ liệu và không được phép qua đường tra cứu ngôn ngữ tự nhiên. ` +
    `Vui lòng dùng POST /api/agent/chat — thao tác đó sẽ đi qua human-gate và cần người duyệt.`,
});

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

  // CRM/SRM tools (Mục 3-6 đặc tả — 17+ query tools)
  { name: 'search_churn_alerts', desc: 'Tra cứu cảnh báo churn', params: 'status (PENDING/TRIGGERED/RETAINED/LOST), riskLevel (LOW/MEDIUM/HIGH/CRITICAL), limit' },
  { name: 'search_customer_rfm', desc: 'Phân khúc RFM/CLV khách hàng', params: 'segment (Champions/Loyal/Potential/At-Risk/Hibernating), tier, hasDebt (true), limit' },
  { name: 'search_leads', desc: 'Tra cứu lead từ webhook/CRM', params: 'leadStatus (NEW/CONTACTED/QUALIFIED/CUSTOMER/DEAD), limit' },
  { name: 'search_grn', desc: 'Tra cứu phiếu nhập kho (GRN)', params: 'status (DRAFT/QC_PENDING/QC_DONE/POSTED), limit' },
  { name: 'search_purchase_invoices', desc: 'Tra cứu hóa đơn NCC + 3-way matching', params: 'matchStatus (PENDING/MATCHED/VARIANCE_HOLD/APPROVED_OVERRIDE), limit' },
  { name: 'search_vendor_performance', desc: 'Hiệu suất nhà cung cấp (Kraljic, OTIF, defect, grade)', params: 'limit' },

  // PRM tools — ĐỐI TÁC ĐẦU RA (giới thiệu khách, hoa hồng). KHÁC search_vendors và
  // search_vendor_performance ở trên, đó là nhà cung cấp đầu vào phía SRM.
  { name: 'search_partner_performance', desc: 'Xếp hạng đối tác theo lợi nhuận ròng (giá trị khách − hoa hồng)', params: 'sortBy (profit/revenue/conversion/referrals), metric (predicted/actual), limit' },
  { name: 'search_partner_referrals', desc: 'Chi tiết một đối tác: khách đã chuyển đổi, CLV từng khách, phễu giới thiệu', params: 'partnerId hoặc partnerCode (mã ĐT-YYYYMM-XXXX)' },
];
// Write tools (create_order / create_po / send_reminder) CỐ TÌNH không nằm trong
// danh mục này: endpoint này read-only, mọi write tool đều bị từ chối ở `chat()`.
// Quảng bá tool rồi từ chối nó chỉ tốn thêm một vòng LLM để trả lời "không".

/**
 * Dựng prompt liệt kê công cụ cho LLM chọn.
 *
 * ============================================================================
 * VÌ SAO PROMPT NÀY VIẾT CÓ DẤU
 * Bản đầu tiên viết không dấu ("Ban la tro ly ERP Aduu chuyen mon"). Lý do có
 * lẽ là e người đọc file gặp lỗi encoding — nhưng tệp này vốn đã chứa tiếng
 * Việt có dấu ở ngay các quy tắc phía dưới, nên không có lý do kỹ thuật nào cả.
 *
 * Mất dấu làm khó đọc với người, và làm mô hình khó phân biệt: "tra cuu hoa don"
 * (tra cứu hóa đơn) và "tra cuu hoa dan" (tra cứu hòa dan) trở thành hai chuỗi gần
 * như giống nhau. Các mô hình ngôn ngữ hiện đại đọc tiếng Việt có dấu không khó
 * hơn — có dấu còn giúp tách từ tốt hơn vì dấu là ranh giới âm vị.
 *
 * Lưu ý: câu hỏi của người dùng có dấu hay không đều chạy được. Phía `db-agent.js`
 * đã chuẩn hoá bỏ dấu CẢ HAI vế khi so khớp (xem `resolveIntent`), nên prompt
 * viết có dấu ở đây không ảnh hưởng gì tới việc người dùng gõ không dấu.
 * ============================================================================
 */
function buildToolPrompt(query) {
  return `Bạn là trợ lý ERP Aduu chuyên môn. Nhiệm vụ: chọn công cụ (tool) phù hợp nhất và trích xuất tham số từ câu hỏi.

Các công cụ:
- search_products: Tìm kiếm sản phẩm. Tham số: search (tên/SKU), categoryId, minPrice, maxPrice, limit, sortBy (price/name/createdAt), sortOrder (asc/desc)
- search_orders: Tìm kiếm đơn hàng. Tham số: status (PENDING/CONFIRMED/SHIPPING/COMPLETED/CANCELLED), paymentStatus (UNPAID/PAID/PARTIAL), period (today/this_month/last_month/this_year), customerId, minTotal, maxTotal, limit
- search_customers: Tìm kiếm khách hàng. Tham số: search (tên/SĐT/email), tier, hasDebt (true), minSpent, sortBy (totalSpent/createdAt), limit
- search_inventory: Tra cứu tồn kho. Tham số: search (tên sản phẩm), warehouseId, lowStock (true: chỉ lấy hàng sắp hết), productId, limit
- get_revenue: Thống kê doanh thu. Tham số: period (today/this_month/last_month/this_year), status
- search_finance: Tra cứu tài chính. Tham số: type (expenses/journal/accounts), period, limit
- search_hr: Tra cứu nhân sự. Tham số: type (payroll/attendance), search, period, limit
- search_production: Tra cứu sản xuất. Tham số: type (work_orders/bom/lots), status, expiringSoon (true), limit
- search_debts: Tra cứu công nợ. Tham số: customerId, status, type (RECEIVABLE/PAYABLE), limit
- search_vendors: Tra cứu nhà cung cấp. Tham số: search (tên/MST), limit
- search_purchase_orders: Tra cứu đơn nhập hàng (PO). Tham số: status, vendorId, period, limit
- search_promotions: Tra cứu khuyến mãi. Tham số: status, type, limit
- search_invoices: Tra cứu hóa đơn BÁN RA. Tham số: period, limit
- search_churn_alerts: Tra cứu cảnh báo churn / khách sắp mất. Tham số: status (PENDING/TRIGGERED/RETAINED/LOST), riskLevel (LOW/MEDIUM/HIGH/CRITICAL), limit
- search_customer_rfm: Phân khúc RFM/CLV khách hàng. Tham số: segment (Champions/Loyal/Potential/At-Risk/Hibernating), tier, hasDebt, limit
- search_leads: Tra cứu lead CRM/webhook. Tham số: leadStatus (NEW/CONTACTED/QUALIFIED/DEAD), limit
- search_grn: Tra cứu phiếu nhận kho GRN. Tham số: status (DRAFT/QC_PENDING/QC_DONE/POSTED), limit
- search_purchase_invoices: Tra cứu hóa đơn NCC / đối soát 3-way. Tham số: matchStatus (PENDING/MATCHED/VARIANCE_HOLD), limit
- search_vendor_performance: Hiệu suất nhà cung cấp ĐẦU VÀO (Kraljic/OTIF/grade). Tham số: limit
- search_partner_performance: Xếp hạng đối tác ĐẦU RA theo lợi nhuận ròng (giá trị khách − hoa hồng). Dùng khi hỏi về đối tác, affiliate, người giới thiệu, hoa hồng. Tham số: sortBy (profit/revenue/conversion/referrals), metric (predicted/actual), limit
- search_partner_referrals: Chi tiết MỘT đối tác (khách đã chuyển đổi, CLV từng khách, phễu giới thiệu). Dùng khi câu hỏi có mã ĐT-YYYYMM-XXXX. Tham số: partnerCode hoặc partnerId
- get_dashboard: Dashboard tổng quan kinh doanh. (không cần tham số)

Quy tắc:
1. Chọn công cụ phù hợp nhất với câu hỏi
2. Trích xuất tham số từ câu hỏi (tên, thời gian, trạng thái, số lượng...)
3. Nếu có "top N" hoặc "N mới nhất" → set limit = N
4. Nếu có "tháng này/tuần này/hôm nay" → set period tương ứng
5. Nếu có "kế toán", "sổ cái", "kết chuyển", "khấu hao", "thuế" → dùng search_finance
6. Nếu có "công thức", "cách tính" → cố gắng tìm công cụ liên quan
7. PHÂN BIỆT HAI PHÍA ĐẦU VÀO: nhà cung cấp (mua hàng, đầu vào) và đối tác (giới thiệu khách, đầu ra).
   "Nhà cung cấp/NCC/Kraljic/OTIF" → phía nhà cung cấp. "Đối tác/affiliate/giới thiệu/hoa hồng/ĐT-" → phía đối tác.
8. PHÂN BIỆT HAI LOẠI HÓA ĐƠN: hóa đơn bán ra (search_invoices) và hóa đơn mua của nhà cung cấp (search_purchase_invoices). Câu có "NCC" hoặc "mua" là hóa đơn mua.
9. Câu hỏi có dấu hay không dấu đều được, kể cả mã ĐT-202610-0001 hay dt-202610-0001.

CHỈ ĐƯỢC CHỌN CÔNG CỤ TRA CỨU Ở TRÊN. Endpoint này không tạo và không sửa
dữ liệu. Nếu câu hỏi yêu cầu tạo đơn / tạo đơn nhập / gửi nhắc nợ, hãy trả
{"tool":"unknown","params":{}} — thao tác đó đi qua kênh khác có human-gate.

Trả về JSON DUY NHẤT dạng: { "tool": "tên_tool", "params": { ... } }
KHONG them text nao khac ngoai JSON.

Câu hỏi: "${query}"`;
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
    logger.error('[LLM-Chat] inferTool error:', err.message);
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
    logger.error('[LLM-Chat] generateNLResponse error:', err.message);
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

  // Chặn write tool TRƯỚC khi log và trước khi execute.
  if (isWriteTool(intent.tool)) {
    logger.warn(`[LLM-Chat] Từ chối write tool "${intent.tool}" trên đường tra cứu NL`);
    return WRITE_TOOL_REFUSAL(intent.tool);
  }

  // Step 3: Execute tool
  logger.info(`[LLM-Chat] Executing: ${intent.tool}`, logger.truncateLog(intent.params));

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
