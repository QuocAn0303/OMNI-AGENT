/**
 * modules/payments/payment.routes.js — Routes quản lý thanh toán theo đơn hàng
 *
 * Tổng quan:
 * - Định nghĩa các endpoint CRUD thanh toán nested dưới /orders/:orderId/payments
 * - Sử dụng mergeParams: true để nhận orderId từ URL cha
 * - Yêu cầu authenticate cho tất cả routes
 *
 * Hàm:
 * - GET /: Lấy danh sách thanh toán + số dư của đơn hàng — gọi paymentService.getByOrderId() và getOrderBalance()
 * - POST /: Ghi nhận thanh toán mới — validate paymentSchema (amount, method, reference, note), gọi paymentService.recordPayment() (ADMIN, MANAGER, CASHIER)
 */
const express = require("express");
const { z } = require("zod");
const paymentService = require("./payment.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");

const router = express.Router({ mergeParams: true });

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD"]),
  reference: z.string().optional(),
  note: z.string().optional(),
});

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const [payments, balance] = await Promise.all([
      paymentService.getByOrderId(req.params.orderId),
      paymentService.getOrderBalance(req.params.orderId),
    ]);
    success(res, { payments, balance });
  } catch (err) {
    next(err);
  }
});

router.post("/", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const data = paymentSchema.parse(req.body);
    const payment = await paymentService.recordPayment(
      { ...data, orderId: req.params.orderId },
      req.user.id,
    );
    created(res, payment, "Ghi nhận thanh toán thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
