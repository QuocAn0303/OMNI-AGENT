/**
 * modules/printers/printer.routes.js — Routes cho cấu hình máy in
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const { createPrinter, updatePrinter } = require('./printer.validation');
const service = require('./printer.service');

router.use(authenticate);

/**
 * @swagger
 * /api/printers:
 *   get:
 *     tags: [Printers]
 *     summary: Danh sách máy in
 *     security: [{bearerAuth: []}]
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', async (req, res, next) => {
  try { sendSuccess(res, await service.listPrinters()); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/printers:
 *   post:
 *     tags: [Printers]
 *     summary: Thêm máy in mới
 *     security: [{bearerAuth: []}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               type: { type: string }
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.createPrinter(createPrinter.parse(req.body), req.user.id), null, 201); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/printers/{id}:
 *   patch:
 *     tags: [Printers]
 *     summary: Cập nhật máy in
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
router.patch('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { sendSuccess(res, await service.updatePrinter(req.params.id, updatePrinter.parse(req.body), req.user.id)); } catch (e) { next(e); }
});
/**
 * @swagger
 * /api/printers/{id}:
 *   delete:
 *     tags: [Printers]
 *     summary: Xóa máy in
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
  try { sendSuccess(res, await service.deletePrinter(req.params.id, req.user.id)); } catch (e) { next(e); }
});

module.exports = router;
