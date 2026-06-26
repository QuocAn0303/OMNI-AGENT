/**
 * modules/ai/db-agent.routes.js — Routes cho DB Agent
 * 
 * Tổng quan:
 * - Cung cấp endpoint chat để truy vấn database bằng ngôn ngữ tự nhiên
 * - Yêu cầu xác thực JWT (authenticate)
 * - Gọi db-agent.service để xử lý intent và thực thi Prisma query
 * 
 * Endpoints:
 * - POST /query: Nhận câu hỏi NL, trả về kết quả database + response text
 * - GET /tools: Danh sách tool handlers có sẵn
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { HANDLERS, processQuery, generateResponse } = require('./db-agent.service');
const { chat } = require('./llm-chat.service');

const router = express.Router();
router.use(authenticate);

router.post('/query', async (req, res, next) => {
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

router.get('/tools', (req, res) => {
  const tools = Object.keys(HANDLERS).map(name => ({
    name,
    description: getToolDescription(name),
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
  };
  return descs[name] || name;
}

module.exports = router;
