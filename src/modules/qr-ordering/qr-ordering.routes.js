/**
 * modules/qr-ordering/qr-ordering.routes.js — Public routes (KHÔNG auth) cho QR ordering
 *
 * Rate-limit qua apiLimiter (đã gắn global ở app.js).
 * Zod validation BẮT BUỘC vì route public — chặn injection/XSS.
 */

/**
 * @swagger
 * /api/qr/menu/{qrToken}:
 *   get:
 *     summary: Lấy menu cho QR ordering (public, không auth)
 *     parameters:
 *       - in: path
 *         name: qrToken
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404: { description: QR token không hợp lệ }
 *
 * /api/qr/order/{qrToken}:
 *   post:
 *     summary: Khách đặt món qua QR (public)
 *     parameters:
 *       - in: path
 *         name: qrToken
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 items: { type: object }
 *               customerName: { type: string }
 *               note: { type: string }
 *     responses:
 *       201: { description: Đặt món thành công }
 *       400: { description: Body không hợp lệ }
 *
 * /api/qr/order/{publicToken}:
 *   get:
 *     summary: Khách theo dõi trạng thái đơn (public)
 *     parameters:
 *       - in: path
 *         name: publicToken
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/qr/order/{publicToken}/call-waiter:
 *   post:
 *     summary: Khách gọi phục vụ (public)
 *     parameters:
 *       - in: path
 *         name: publicToken
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/qr/order/{publicToken}/pay:
 *   get:
 *     summary: Tạo VietQR thanh toán cho đơn QR (public)
 *     parameters:
 *       - in: path
 *         name: publicToken
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK, trả về qrString + bankInfo }
 *
 * /api/qr/feedback/{publicToken}:
 *   post:
 *     summary: Khách gửi feedback (public)
 *     parameters:
 *       - in: path
 *         name: publicToken
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string }
 *     responses:
 *       200: { description: OK }
 */
const router = require('express').Router();
const { sendSuccess } = require('../../utils/response');
const service = require('./qr-ordering.service');
const { placeOrderSchema, callWaiterSchema, feedbackSchema } = require('./qr-ordering.validation');

router.get('/menu/:qrToken', async (req, res, next) => {
  try { sendSuccess(res, await service.getMenu(req.params.qrToken)); }
  catch (e) { next(e); }
});

router.post('/order/:qrToken', async (req, res, next) => {
  try {
    const parsed = placeOrderSchema.parse(req.body);
    sendSuccess(res, await service.placeOrder(req.params.qrToken, parsed), 'Đặt món thành công — bếp đang chuẩn bị', 201);
  } catch (e) { next(e); }
});

router.get('/order/:publicToken', async (req, res, next) => {
  try { sendSuccess(res, await service.trackStatus(req.params.publicToken)); }
  catch (e) { next(e); }
});

router.post('/order/:publicToken/call-waiter', async (req, res, next) => {
  try {
    const parsed = callWaiterSchema.parse(req.body || {});
    sendSuccess(res, await service.callWaiter(req.params.publicToken, parsed));
  } catch (e) { next(e); }
});

router.get('/order/:publicToken/pay', async (req, res, next) => {
  try { sendSuccess(res, await service.getPaymentInfo(req.params.publicToken)); }
  catch (e) { next(e); }
});

router.post('/feedback/:publicToken', async (req, res, next) => {
  try {
    const parsed = feedbackSchema.parse(req.body);
    sendSuccess(res, await service.submitFeedback(req.params.publicToken, parsed));
  } catch (e) { next(e); }
});

module.exports = router;
