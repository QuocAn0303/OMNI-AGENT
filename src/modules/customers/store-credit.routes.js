/**
 * modules/customers/store-credit.routes.js — Routes quản lý store credit (tín dụng cửa hàng)
 *
 * Tổng quan:
 * - Xem lịch sử giao dịch, số dư store credit của khách hàng
 * - Ghi nhận giao dịch EARN/SPEND/ADJUST/REFUND (ADMIN, MANAGER)
 * - Validate bằng Zod (createSchema)
 */

/**
 * @swagger
 * /api/store-credit/{customerId}:
 *   get:
 *     summary: Lịch sử giao dịch store credit của khách (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Ghi nhận giao dịch store credit (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: number }
 *               type: { type: string, enum: [EARN, SPEND, ADJUST, REFUND] }
 *               note: { type: string }
 *               referenceId: { type: string }
 *     responses:
 *       200: { description: Ghi nhận store credit thành công }
 *
 * /api/store-credit/{customerId}/balance:
 *   get:
 *     summary: Số dư store credit của khách (ADMIN, MANAGER, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 */
const express = require('express');
const { z } = require('zod');
const storeCreditService = require('./store-credit.service');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { success, paginated } = require('../../utils/response');

const router = express.Router();

router.use(authenticate);

router.get('/:customerId', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const result = await storeCreditService.listByCustomer(
      req.params.customerId,
      req.query,
    );
    paginated(res, result.transactions, result);
  } catch (err) {
    next(err);
  }
});

router.get('/:customerId/balance', authorize('ADMIN', 'MANAGER', 'CASHIER'), async (req, res, next) => {
  try {
    success(res, await storeCreditService.getBalance(req.params.customerId));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  amount: z.number().positive('Số tiền phải lớn hơn 0'),
  type: z.enum(['EARN', 'SPEND', 'ADJUST', 'REFUND']),
  note: z.string().optional(),
  referenceId: z.string().optional(),
});

router.post('/:customerId', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const data = createSchema.parse({ ...req.body, customerId: req.params.customerId });
    const tx = await storeCreditService.create(data, req.user.id);
    success(res, tx, 'Ghi nhận store credit thành công');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
