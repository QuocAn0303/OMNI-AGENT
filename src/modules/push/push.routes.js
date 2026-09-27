/**
 * modules/push/push.routes.js — Web Push notification routes
 *
 * Routes:
 * - GET    /config     → VAPID public key cho frontend subscribe
 * - POST   /subscribe  → Lưu PushSubscription của thiết bị
 * - DELETE /subscribe  → Hủy subscription theo endpoint
 * - POST   /test       → Gửi thử thông báo đến thiết bị của user hiện tại
 */

/**
 * @swagger
 * /api/push/config:
 *   get:
 *     summary: Lấy VAPID public key (để frontend đăng ký push)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/push/subscribe:
 *   post:
 *     summary: Đăng ký PushSubscription cho user hiện tại
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subscription:
 *                 type: object
 *                 properties:
 *                   endpoint: { type: string }
 *                   keys: { type: object }
 *     responses:
 *       200: { description: OK }
 *   delete:
 *     summary: Hủy đăng ký push theo endpoint
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/push/test:
 *   post:
 *     summary: Gửi thử thông báo push
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 */
const router = require('express').Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const pushService = require('./push.service');

router.use(authenticate);

router.get('/config', async (req, res, next) => {
  try {
    const publicKey = await pushService.getPublicKey();
    if (!publicKey) throw { status: 503, message: 'Push chưa sẵn sàng — thử lại sau' };
    sendSuccess(res, { publicKey });
  } catch (e) { next(e); }
});

router.post('/subscribe', async (req, res, next) => {
  try {
    const subscription = req.body?.subscription || req.body;
    const userAgent = req.body?.userAgent || req.get('user-agent') || null;
    sendSuccess(res, await pushService.subscribe(req.user.id, { ...subscription, userAgent }));
  } catch (e) { next(e); }
});

router.delete('/subscribe', async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint || req.query?.endpoint;
    if (!endpoint) throw { status: 400, message: 'Thiếu endpoint' };
    sendSuccess(res, await pushService.unsubscribe(req.user.id, endpoint));
  } catch (e) { next(e); }
});

router.post('/test', async (req, res, next) => {
  try {
    sendSuccess(res, await pushService.sendTest(req.user.id), 'Đã gửi thử — kiểm tra điện thoại');
  } catch (e) { next(e); }
});

module.exports = router;
