/**
 * modules/food-delivery/food-delivery.routes.js — Food delivery order inbox
 */

/**
 * @swagger
 * /api/food-delivery:
 *   get:
 *     summary: Danh sách đơn giao đồ ăn từ GrabFood/ShopeeFood/BeFood
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/food-delivery/webhook/{provider}:
 *   post:
 *     summary: Webhook nhận đơn từ aggregator (public, verify signature ở adapter)
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Đã nhận đơn }
 *
 * /api/food-delivery/{id}/accept:
 *   post:
 *     summary: Nhận đơn giao đồ ăn (ADMIN, MANAGER, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã nhận đơn }
 *
 * /api/food-delivery/{id}/reject:
 *   post:
 *     summary: Từ chối đơn giao đồ ăn (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: OK }
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess, created } = require('../../utils/response');
const service = require('./food-delivery.service');
const { receiveOrder } = require('./food-delivery.validation');

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try { sendSuccess(res, await service.listInbox(req.query)); }
  catch (e) { next(e); }
});

// Webhook nhận đơn từ aggregator (verify signature ở adapter thực tế)
router.post('/webhook/:provider', async (req, res, next) => {
  try {
    const parsed = receiveOrder.parse({ ...req.body, provider: req.params.provider.toUpperCase() });
    const result = await service.receiveOrder(parsed);
    created(res, result, 'Đã nhận đơn từ aggregator');
  } catch (e) { next(e); }
});

router.post('/:id/accept', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { sendSuccess(res, await service.acceptOrder(req.params.id, req.user.id), 'Đã nhận đơn — gửi bếp'); }
  catch (e) { next(e); }
});

router.post('/:id/reject', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.rejectOrder(req.params.id, req.user.id)); }
  catch (e) { next(e); }
});

module.exports = router;
