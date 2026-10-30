/**
 * modules/accounting/purchase-order.routes.js — Định tuyến đơn nhập hàng (PO)
 * 
 * Tổng quan:
 * - Định nghĩa REST endpoints cho Purchase Order (đơn đặt hàng nhà cung cấp).
 * - Tích hợp Zod validation, authenticate + authorize + requireModule middleware.
 * - Logic nghiệp vụ được xử lý bởi purchaseService.
 * 
 * Hàm:
 * - GET /: Danh sách PO (purchaseService.list)
 * - GET /:id: Chi tiết PO (purchaseService.getById)
 * - POST /: Tạo PO mới (purchaseService.create)
 * - POST /:id/submit: Gửi duyệt PO (purchaseService.submit)
 * - POST /:id/approve: Phê duyệt PO (purchaseService.approve)
 * - POST /:id/receive: Nhập kho từ PO (purchaseService.receive)
 * - POST /:id/payment: Thanh toán PO (purchaseService.pay)
 * - POST /:id/cancel: Hủy PO (purchaseService.cancel)
 */
// src/modules/accounting/purchase-order.routes.js
// Alias REST paths theo spec: /api/purchase-orders (logic dùng chung purchase.service)
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");
const purchaseService = require("./purchase.service");

router.use(authenticate, requireModule("purchase-orders"));

const poSchema = z.object({
  vendorId: z.string(),
  expectedAt: z.string().optional(),
  invoiceNumber: z.string().optional(),
  note: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        unitCost: z.number().nonnegative(),
        taxRateId: z.string().optional().nullable(),
      }),
    )
    .min(1),
});

router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await purchaseService.list(req.query));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await purchaseService.getById(req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = poSchema.parse(req.body);
    created(res, await purchaseService.create(data, req.user.id), "Đã tạo PO");
  } catch (e) {
    next(e);
  }
});

router.post("/:id/submit", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await purchaseService.submit(req.params.id, req.user.id), "Đã gửi duyệt");
  } catch (e) {
    next(e);
  }
});

router.post("/:id/approve", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await purchaseService.approve(req.params.id, req.user.role, req.user.id), "Đã duyệt");
  } catch (e) {
    next(e);
  }
});

router.post("/:id/order", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await purchaseService.order(req.params.id, req.user.id), "Đã gửi NCC");
  } catch (e) {
    next(e);
  }
});

router.post("/:id/receive", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await purchaseService.receive(req.params.id, req.user.id), "Đã nhập kho");
  } catch (e) {
    next(e);
  }
});

router.post("/:id/payment", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const { amount, method } = req.body;
    success(
      res,
      await purchaseService.pay(req.params.id, { amount: Number(amount), method }, req.user.id),
      "Đã thanh toán",
    );
  } catch (e) {
    next(e);
  }
});

router.post("/:id/cancel", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await purchaseService.cancel(req.params.id, req.user.id), "Đã hủy");
  } catch (e) {
    next(e);
  }
});

module.exports = router;
