/**
 * modules/tables/table.routes.js — Routes cho quản lý bàn F&B
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const { createArea, updateArea, createTable, updateTable, openSession, mergeTables, transferTable, createReservation, updateReservation, seatReservation } = require('./table.validation');
const service = require('./table.service');

router.use(authenticate);

// AREAS
/**
 * @swagger
 * /api/tables/areas:
 *   get:
 *     tags: [Tables]
 *     summary: Danh sách khu vực
 *     security: [{bearerAuth: []}]
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/areas', async (req, res, next) => {
  try { sendSuccess(res, await service.listAreas()); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/areas:
 *   post:
 *     tags: [Tables]
 *     summary: Tạo khu vực mới
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
router.post('/areas', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createArea(createArea.parse(req.body), req.user.id), null, 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/areas/{id}:
 *   patch:
 *     tags: [Tables]
 *     summary: Cập nhật khu vực
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
router.patch('/areas/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateArea(req.params.id, updateArea.parse(req.body), req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/areas/{id}:
 *   delete:
 *     tags: [Tables]
 *     summary: Xóa khu vực
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
router.delete('/areas/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteArea(req.params.id, req.user.id)); } catch (e) { next(e); }
});

// TABLES
/**
 * @swagger
 * /api/tables:
 *   get:
 *     tags: [Tables]
 *     summary: Danh sách bàn
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: query
 *         name: areaId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', async (req, res, next) => {
  try { sendSuccess(res, await service.listTables(req.query.areaId)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables:
 *   post:
 *     tags: [Tables]
 *     summary: Tạo bàn mới
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               areaId: { type: string }
 *               capacity: { type: number }
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createTable(createTable.parse(req.body), req.user.id), null, 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/positions:
 *   patch:
 *     tags: [Tables]
 *     summary: Cập nhật vị trí bàn (drag & drop)
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               positions: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/positions', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateTablePositions(req.body.positions || req.body, req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/{id}:
 *   patch:
 *     tags: [Tables]
 *     summary: Cập nhật bàn
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
 *               capacity: { type: number }
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updateTable(req.params.id, updateTable.parse(req.body), req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/{id}:
 *   delete:
 *     tags: [Tables]
 *     summary: Xóa bàn
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
router.delete('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.deleteTable(req.params.id, req.user.id)); } catch (e) { next(e); }
});

// TABLE SESSIONS
/**
 * @swagger
 * /api/tables/{id}/open:
 *   post:
 *     tags: [Tables]
 *     summary: Mở bàn
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               guestCount: { type: number }
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/:id/open', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { const { guestCount } = openSession.parse(req.body); sendSuccess(res, await service.openSession(req.params.id, guestCount, req.user.id), 'Mở bàn thành công', 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/{id}/close:
 *   post:
 *     tags: [Tables]
 *     summary: Đóng bàn
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
router.post('/:id/close', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { sendSuccess(res, await service.closeSession(req.params.id, req.user.id), 'Đóng bàn — cần dọn'); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/{id}/clear:
 *   post:
 *     tags: [Tables]
 *     summary: Dọn bàn
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
router.post('/:id/clear', authorize('ADMIN', 'MANAGER', 'CASHIER', 'WAREHOUSE'), async (req, res, next) => {
  try { sendSuccess(res, await service.clearTable(req.params.id, req.user.id), 'Bàn đã dọn xong'); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/{id}/merge:
 *   post:
 *     tags: [Tables]
 *     summary: Ghép bàn
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
 *               toTableId: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/:id/merge', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { const { toTableId } = mergeTables.parse(req.body); sendSuccess(res, await service.mergeTables(req.params.id, toTableId, req.user.id), 'Ghép bàn thành công'); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/{id}/transfer:
 *   post:
 *     tags: [Tables]
 *     summary: Chuyển bàn
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
 *               toTableId: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/:id/transfer', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { const { toTableId } = transferTable.parse(req.body); sendSuccess(res, await service.transferTable(req.params.id, toTableId, req.user.id), 'Chuyển bàn thành công'); } catch (e) { next(e); }
});

// RESERVATIONS
/**
 * @swagger
 * /api/tables/reservations:
 *   get:
 *     tags: [Tables]
 *     summary: Danh sách đặt bàn trước
 *     security: [{bearerAuth: []}]
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/reservations', async (req, res, next) => {
  try { sendSuccess(res, await service.listReservations(req.query.date)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/reservations:
 *   post:
 *     tags: [Tables]
 *     summary: Tạo đặt bàn trước
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerName: { type: string }
 *               phone: { type: string }
 *               guestCount: { type: number }
 *               time: { type: string }
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/reservations', async (req, res, next) => {
  try { sendSuccess(res, await service.createReservation(createReservation.parse(req.body), req.user.id), null, 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/reservations/{id}:
 *   patch:
 *     tags: [Tables]
 *     summary: Cập nhật đặt bàn
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
 *               customerName: { type: string }
 *               guestCount: { type: number }
 *     responses:
 *       200:
 *         description: Success
 */
router.patch('/reservations/:id', async (req, res, next) => {
  try { sendSuccess(res, await service.updateReservation(req.params.id, updateReservation.parse(req.body), req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/tables/reservations/{id}/seat:
 *   post:
 *     tags: [Tables]
 *     summary: Sắp bàn cho khách đặt trước
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
 *               tableId: { type: string }
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/reservations/:id/seat', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try { const { tableId } = seatReservation.parse(req.body); sendSuccess(res, await service.seatReservation(req.params.id, tableId, req.user.id), 'Đã sắp bàn'); } catch (e) { next(e); }
});

module.exports = router;
