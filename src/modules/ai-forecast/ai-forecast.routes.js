/**
 * modules/ai-forecast/ai-forecast.routes.js
 */

/**
 * @swagger
 * /api/ai-forecast/forecast:
 *   get:
 *     summary: Dự báo nhu cầu theo giờ cho F&B (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 7 }
 *     responses:
 *       200: { description: OK }
 *
 * /api/ai-forecast/menu-engineering:
 *   get:
 *     summary: 'Phân tích menu engineering (BCG matrix: star/plowhorse/puzzle/dog) (ADMIN, MANAGER)'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/ai-forecast/suggest-pricing:
 *   post:
 *     summary: Gợi ý giá bán động (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/ai-forecast/recommendations:
 *   get:
 *     summary: Danh sách khuyến nghị AI
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/ai-forecast/recommendations/{id}/{decision}:
 *   post:
 *     summary: Phê duyệt/từ chối khuyến nghị (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: decision
 *         required: true
 *         schema: { type: string, enum: [APPROVED, REJECTED, APPLIED] }
 *     responses:
 *       200: { description: OK }
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const service = require('./ai-forecast.service');

router.use(authenticate);

router.get('/forecast', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.forecastHourlyDemand(Number(req.query.days) || 7)); } catch (e) { next(e); }
});
router.get('/menu-engineering', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.menuEngineering()); } catch (e) { next(e); }
});
router.post('/suggest-pricing', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.suggestDynamicPricing(), null, 201); } catch (e) { next(e); }
});
router.get('/recommendations', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.listRecommendations()); } catch (e) { next(e); }
});
router.post('/recommendations/:id/:decision', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { id, decision } = req.params;
    if (!['APPROVED', 'REJECTED', 'APPLIED'].includes(decision)) throw { status: 400, message: 'Decision không hợp lệ' };
    sendSuccess(res, await service.decideRecommendation(id, decision, req.user.id));
  } catch (e) { next(e); }
});

module.exports = router;
