// src/modules/debt/debt.routes.js
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");
const debtService = require("./debt.service");

router.use(authenticate);

router.get("/", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    success(res, await debtService.list(req.query));
  } catch (e) {
    next(e);
  }
});

router.get("/summary", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await debtService.summary());
  } catch (e) {
    next(e);
  }
});

const paySchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD"]).optional(),
  note: z.string().optional(),
});

router.post("/:id/payments", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const body = paySchema.parse(req.body);
    created(res, await debtService.recordDebtPayment(req.params.id, body, req.user.id), "Đã ghi nhận thanh toán công nợ");
  } catch (e) {
    next(e);
  }
});

module.exports = router;
