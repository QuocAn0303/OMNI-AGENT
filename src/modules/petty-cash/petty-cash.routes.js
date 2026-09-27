/**
 * modules/petty-cash/petty-cash.routes.js
 */

/**
 * @swagger
 * /api/petty-cash:
 *   get:
 *     summary: Danh sách giao dịch quỹ tiền mặt nhỏ
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo giao dịch quỹ tiền mặt nhỏ
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *
 * /api/petty-cash/balance:
 *   get:
 *     summary: Số dư quỹ tiền mặt hiện tại
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const { createPettyCash } = require('./petty-cash.validation');
const service = require('./petty-cash.service');

router.use(authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"));

router.get('/', async (req, res, next) => { try { sendSuccess(res, await service.list(req.query)); } catch (e) { next(e); } });
router.get('/balance', async (req, res, next) => { try { sendSuccess(res, await service.getBalance()); } catch (e) { next(e); } });
router.post('/', async (req, res, next) => {
  try { sendSuccess(res, await service.create({ ...createPettyCash.parse(req.body), userId: req.user.id }), null, 201); } catch (e) { next(e); }
});

module.exports = router;
