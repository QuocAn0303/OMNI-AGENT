/**
 * modules/kds/kds.routes.js — Routes cho Kitchen Display System
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const { createStation, updateStation } = require('./kds.validation');
const service = require('./kds.service');

router.use(authenticate);

// STATIONS
/**
 * @swagger
 * /api/kds/stations:
 *   get:
 *     tags: [KDS]
 *     summary: Danh sách stations (khu bếp)
 *     security: [{bearerAuth: []}]
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/stations', async (req, res, next) => {
  try { sendSuccess(res, await service.listStations()); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/stations:
 *   post:
 *     tags: [KDS]
 *     summary: Tạo station mới
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/stations', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createStation(createStation.parse(req.body), req.user.id), null, 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/stations/{id}:
 *   patch:
 *     tags: [KDS]
 *     summary: Cập nhật station
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/stations/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateStation(req.params.id, updateStation.parse(req.body), req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/stations/{id}:
 *   delete:
 *     tags: [KDS]
 *     summary: Xóa station
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.delete('/stations/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteStation(req.params.id, req.user.id)); } catch (e) { next(e); }
});

// TICKETS
/**
 * @swagger
 * /api/kds/stations/{id}/tickets:
 *   get:
 *     tags: [KDS]
 *     summary: Tickets theo station
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/stations/:id/tickets', async (req, res, next) => {
  try { sendSuccess(res, await service.getTicketsByStation(req.params.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/tickets:
 *   get:
 *     tags: [KDS]
 *     summary: Tất cả tickets đang active
 *     security: [{bearerAuth: []}]
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/tickets', async (req, res, next) => {
  try { sendSuccess(res, await service.getAllActiveTickets()); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/orders/{orderId}/generate:
 *   post:
 *     tags: [KDS]
 *     summary: Gửi món ra bếp
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/orders/:orderId/generate', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { sendSuccess(res, await service.generateTicketsForOrder(req.params.orderId, req.user.id), 'Đã gửi món ra bếp', 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/tickets/{id}/bump:
 *   post:
 *     tags: [KDS]
 *     summary: Bump ticket (báo món xong)
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/tickets/:id/bump', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { sendSuccess(res, await service.bumpTicket(req.params.id, req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/kds/tickets/{id}/recall:
 *   post:
 *     tags: [KDS]
 *     summary: Recall ticket (gọi lại món)
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/tickets/:id/recall', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { sendSuccess(res, await service.recallTicket(req.params.id, req.user.id)); } catch (e) { next(e); }
});

module.exports = router;
