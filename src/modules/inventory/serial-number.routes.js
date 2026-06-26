const express = require('express');
const { z } = require('zod');
const serialService = require('./serial-number.service');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { requireModule } = require('../../middleware/plan.middleware');
const { success } = require('../../utils/response');

const router = express.Router();

router.use(authenticate, requireModule('inventory'));

router.get('/', authorize('ADMIN', 'MANAGER', 'WAREHOUSE'), async (req, res, next) => {
  try {
    const result = await serialService.list(req.query);
    success(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authorize('ADMIN', 'MANAGER', 'WAREHOUSE'), async (req, res, next) => {
  try {
    success(res, await serialService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/lookup/:code', authorize('ADMIN', 'MANAGER', 'WAREHOUSE', 'CASHIER'), async (req, res, next) => {
  try {
    const { productId } = req.query;
    const result = await serialService.findBySerialCode(
      req.params.code,
      productId,
    );
    success(res, result || {});
  } catch (err) {
    next(err);
  }
});

const registerSchema = z.object({
  serialCodes: z.array(z.string().min(1)).min(1, 'Phải có ít nhất 1 serial number'),
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  note: z.string().optional(),
});

router.post('/register', authorize('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const result = await serialService.register(data, req.user.id);
    success(res, result, 'Đăng ký serial number thành công');
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({
  status: z.enum(['IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED']),
  orderId: z.string().uuid().optional(),
});

router.patch('/:id/status', authorize('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    const { status, orderId } = statusSchema.parse(req.body);
    const result = await serialService.updateStatus(req.params.id, status, orderId);
    success(res, result, 'Cập nhật trạng thái serial number thành công');
  } catch (err) {
    next(err);
  }
});

router.patch('/bulk-status', authorize('ADMIN', 'WAREHOUSE'), async (req, res, next) => {
  try {
    const { ids, status, orderId } = z
      .object({
        ids: z.array(z.string().uuid()).min(1),
        status: z.enum(['IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED']),
        orderId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const result = await serialService.bulkUpdateStatus(ids, status, orderId);
    success(res, result, `Đã cập nhật ${result.count} serial number`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
