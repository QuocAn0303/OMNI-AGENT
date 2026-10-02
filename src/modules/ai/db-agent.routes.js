/**
 * modules/ai/db-agent.routes.js — Routes cho DB Agent
 * 
 * Tổng quan:
 * - Cung cấp endpoint chat để truy vấn database bằng ngôn ngữ tự nhiên
 * - Yêu cầu xác thực JWT (authenticate) + phân quyền (authorize)
 * - READ-ONLY: write tool bị từ chối ở service `chat()` (xem WRITE_TOOL_REFUSAL)
 * 
 * Endpoints:
 * - POST /query: Nhận câu hỏi NL, trả về kết quả database + response text
 * - GET /tools: Danh sách tool handlers có sẵn
 */

const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { HANDLERS, processQuery, generateResponse, isWriteTool } = require('./db-agent.service');
const { chat } = require('./llm-chat.service');

/**
 * Endpoint này trả về dữ liệu nhạy cảm (công nợ, sổ cái, hồ sơ KH) cho bất kỳ
 * câu hỏi NL nào. Trước đây nó chỉ có `authenticate` — role CASHIER/WAREHOUSE
 * đăng nhập là tra được. Danh sách role khớp với SENSITIVE_ALLOWED_ROLES ở
 * agent.routes.js để hai đường chat không lệch nhau.
 */
const READ_ROLES = [
  'SUPER_OMEGA_ULTRA_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'ACCOUNTANT',
];

const router = express.Router();
router.use(authenticate);

router.post('/query', authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const { query, useLlm = true } = req.body;
    if (!query || !query.trim()) {
      throw { status: 400, message: 'Vui lòng nhập câu hỏi.' };
    }

    let result;
    if (useLlm) {
      result = await chat(query.trim());
    } else {
      const dbResult = await processQuery(query.trim());
      const response = await generateResponse(query.trim(), dbResult);
      result = {
        success: dbResult.success,
        message: response,
        data: dbResult.data,
        total: dbResult.total,
      };
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/tools', authorize(...READ_ROLES), (req, res) => {
  const tools = Object.keys(HANDLERS).map(name => ({
    name,
    description: getToolDescription(name),
    // Endpoint này read-only: đánh dấu tool ghi để client không hiển thị
    // chúng như thể gọi được ở đây.
    executableHere: !isWriteTool(name),
  }));
  res.json({ success: true, data: tools });
});

function getToolDescription(name) {
  const descs = {
    search_products: 'Tra cứu sản phẩm (tên, SKU, danh mục, giá)',
    search_orders: 'Tra cứu đơn hàng (trạng thái, thời gian, doanh thu)',
    search_customers: 'Tra cứu khách hàng (tên, SĐT, chi tiêu, nợ)',
    search_inventory: 'Tra cứu tồn kho (sản phẩm, kho, hàng sắp hết)',
    get_revenue: 'Thống kê doanh thu (theo kỳ, trạng thái)',
    search_finance: 'Tra cứu tài chính (chi phí, bút toán, tài khoản)',
    search_hr: 'Tra cứu nhân sự (nhân viên, lương, chấm công)',
    search_production: 'Tra cứu sản xuất (lệnh SX, BOM, lô hàng)',
    search_projects: 'Tra cứu dự án',
    search_debts: 'Tra cứu công nợ khách hàng',
    search_vendors: 'Tra cứu nhà cung cấp',
    search_purchase_orders: 'Tra cứu đơn nhập hàng (PO)',
    search_promotions: 'Tra cứu chương trình khuyến mãi',
    search_invoices: 'Tra cứu hóa đơn',
    search_deliveries: 'Tra cứu giao hàng',
    search_returns: 'Tra cứu trả hàng',
    get_dashboard: 'Xem dashboard tổng quan kinh doanh',
    // CRM/SRM (Mục 3-6 đặc tả)
    search_churn_alerts: 'Tra cứu cảnh báo churn (khách sắp rời bỏ)',
    search_customer_rfm: 'Phân khúc RFM/CLV khách hàng',
    search_leads: 'Tra cứu lead từ webhook/CRM',
    search_grn: 'Tra cứu phiếu nhập kho (GRN)',
    search_purchase_invoices: 'Tra cứu hóa đơn NCC (3-way matching)',
    search_vendor_performance: 'Hiệu suất nhà cung cấp (Kraljic, OTIF, scorecard)',
  };
  return descs[name] || name;
}

module.exports = router;
