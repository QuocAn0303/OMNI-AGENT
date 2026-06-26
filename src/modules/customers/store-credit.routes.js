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
