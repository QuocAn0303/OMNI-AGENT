/**
 * modules/debt/debt.routes.js — Routes quản lý công nợ
 *
 * Tổng quan:
 * - Định nghĩa các endpoint CRUD cho công nợ (debt)
 * - Yêu cầu authenticate + requireModule("debts") cho tất cả routes
 * - Phân quyền theo role cho từng action
 *
 * Hàm:
 * - GET /: Danh sách công nợ có phân trang, lọc — gọi debtService.list() (ADMIN, MANAGER, CASHIER)
 * - GET /summary: Tổng hợp số liệu công nợ — gọi debtService.summary() (ADMIN, MANAGER)
 * - POST /:id/payments: Ghi nhận thanh toán cho 1 công nợ — validate paySchema (amount, method, note), gọi debtService.recordDebtPayment() (ADMIN, MANAGER, CASHIER)
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");
const debtService = require("./debt.service");

router.use(authenticate, requireModule("debts"));

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
