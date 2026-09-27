/**
 * modules/accounting/purchase-invoice.routes.js — Routes Hoá đơn NCC + 3-Way Matching (Mục 6)
 *
 * Routes:
 * - POST /api/purchase-invoices                    : Ghi nhận hoá đơn NCC (tự match nếu có GRN POSTED)
 * - POST /api/purchase-invoices/:id/match          : Đối soát 3-way (dung sai ±1%)
 * - POST /api/purchase-invoices/:id/approve-override : ADMIN chấp nhận lệch có kiểm soát
 * - GET  /api/purchase-invoices?poId=&matchStatus=  : Danh sách
 * - GET  /api/purchase-invoices/:id                : Chi tiết
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");
const service = require("./purchase-invoice.service");

router.use(authenticate);

const invoiceSchema = z.object({
  purchaseOrderId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  invoiceAmount: z.number().nonnegative(),
  invoiceTax: z.number().nonnegative().optional().default(0),
});

/**
 * @swagger
 * /api/purchase-invoices:
 *   post:
 *     summary: Ghi nhận hoá đơn NCC để đối soát 3-way (PO / GRN / Hoá đơn)
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [purchaseOrderId, invoiceNumber, invoiceAmount]
 *             properties:
 *               purchaseOrderId: { type: string }
 *               invoiceNumber: { type: string }
 *               invoiceAmount: { type: number }
 *               invoiceTax: { type: number }
 *     responses:
 *       201: { description: Đã ghi nhận — tự match nếu đã có GRN POSTED }
 *       409: { description: Hoá đơn trùng số trong PO }
 */
router.post("/", authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const data = invoiceSchema.parse(req.body);
    created(res, await service.create(data, req.user.id), "Đã ghi nhận hoá đơn NCC");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/purchase-invoices/{id}/match:
 *   post:
 *     summary: Chạy 3-Way Matching — MATCHED (≤±1%) hoặc VARIANCE_HOLD (chặn thanh toán)
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kết quả đối soát }
 */
router.post("/:id/match", authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await service.match(req.params.id, req.user.id), "Đã đối soát");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/purchase-invoices/{id}/approve-override:
 *   post:
 *     summary: ADMIN chấp nhận lệch có kiểm soát (APPROVED_OVERRIDE) → mở khoá công nợ
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Đã override }
 */
router.post("/:id/approve-override", authorize("ADMIN"), async (req, res, next) => {
  try {
    success(res, await service.approveOverride(req.params.id, req.user.id), "Đã chấp nhận lệch (override)");
  } catch (e) {
    next(e);
  }
});

router.get("/", authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await service.list(req.query));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
