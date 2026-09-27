/**
 * Smart Guide Routes — Hướng dẫn nghiệp vụ thông minh
 */

const router = require('express').Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const service = require('./smart-guide.service');

router.use(authenticate);

// GET /api/smart-guide/pricing — Gợi ý giá bán
router.get('/pricing', async (req, res, next) => {
  try {
    const data = await service.getPricingInsights(req.tenantId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/smart-guide/reorder — Gợi ý nhập hàng
router.get('/reorder', async (req, res, next) => {
  try {
    const data = await service.getReorderSuggestions(req.tenantId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/smart-guide/health — Điểm sức khỏe doanh nghiệp
router.get('/health', async (req, res, next) => {
  try {
    const data = await service.getBusinessHealth(req.tenantId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/smart-guide/report — Báo cáo đơn giản
router.get('/report', async (req, res, next) => {
  try {
    const data = await service.getSimpleReport(req.tenantId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
