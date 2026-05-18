const router = require("express").Router();
const { z } = require("zod");
const returnService = require("./return.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");

const createReturnSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.enum(["DEFECTIVE", "WRONG_ITEM", "CUSTOMER_CHANGE", "EXPIRED", "OTHER"]),
  refundMethod: z.enum(["CASH", "BANK_TRANSFER", "STORE_CREDIT", "EXCHANGE", "NONE"]),
  restockable: z.boolean().optional(),
  items: z.array(z.object({
    orderItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
  exchangeItems: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).optional(),
  note: z.string().optional(),
  overridePolicy: z.boolean().optional(),
});

router.use(authenticate);

router.post("/", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const data = createReturnSchema.parse(req.body);
    const { overridePolicy, ...payload } = data;
    const ret = await returnService.create(payload, req.user.id, {
      overridePolicy,
      userRole: req.user.role,
    });
    created(res, ret, "Tạo yêu cầu trả hàng thành công");
  } catch (err) {
    next(err);
  }
});

router.get("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { returns, pagination } = await returnService.getAll(req.query);
    paginated(res, returns, pagination);
  } catch (err) {
    next(err);
  }
});

router.get("/order/:orderId", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const returns = await returnService.getByOrderId(req.params.orderId);
    success(res, returns);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const ret = await returnService.getById(req.params.id);
    success(res, ret);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/approve", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const ret = await returnService.approve(req.params.id, req.user.id, req.user.role);
    success(res, ret, "Duyệt trả hàng thành công");
  } catch (err) {
    next(err);
  }
});

router.post("/:id/complete", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const ret = await returnService.complete(req.params.id, req.user.id);
    success(res, ret, "Hoàn tất trả hàng thành công");
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/reject", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const ret = await returnService.reject(req.params.id, req.user.id);
    success(res, ret, "Từ chối trả hàng thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
