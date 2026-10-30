/**
 * modules/rfq/rfq.routes.js — RFQ và so sánh báo giá NCC
 *
 * Lưu ý phân quyền: ghi báo giá và chốt NCC là quyết định mua hàng ⇒ ADMIN/MANAGER.
 * Người thao tác kho (WAREHOUSE) được XEM để tham gia đánh giá NCC nhưng không
 * được tự chốt nhà cung cấp.
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");
const service = require("./rfq.service");

router.use(authenticate, requireModule("purchase-orders"));

const itemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().min(1).max(500).nullable().optional(),
  quantity: z.number().int().positive(),
  unit: z.string().max(20).nullable().optional(),
});

const createSchema = z.object({
  vendorIds: z.array(z.string().uuid()).min(1, "Cần ít nhất 1 nhà cung cấp"),
  deadlineAt: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  items: z.array(itemSchema).min(1, "RFQ cần ít nhất 1 dòng hàng"),
});

const quoteSchema = z.object({
  lines: z.array(z.object({
    rfqItemId: z.string().uuid(),
    unitCost: z.number().positive(),
    availableQty: z.number().int().positive().nullable().optional(),
  })).min(1),
  promisedAt: z.string().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

/**
 * @swagger
 * /api/rfq:
 *   get:
 *     summary: Danh sách RFQ
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Danh sách có phân trang }
 *   post:
 *     summary: Tạo RFQ và hỏi giá nhiều nhà cung cấp
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Đã tạo RFQ (chưa gửi — cần người dùng gửi) }
 */
router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await service.list(req.query));
  } catch (e) {
    next(e);
  }
});

router.post("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    created(res, await service.create(createSchema.parse(req.body), req.user.id));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id));
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/rfq/{id}/comparison:
 *   get:
 *     summary: Bảng so sánh các báo giá của RFQ
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Xếp hạng theo tổng tiền + giới hạn so sánh }
 */
router.get("/:id/comparison", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await service.comparison(req.params.id));
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/rfq/{id}/quotes:
 *   post:
 *     summary: Ghi nhận báo giá của một nhà cung cấp
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Đã lưu báo giá }
 */
router.post("/:id/quotes", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { vendorId, ...rest } = req.body || {};
    if (!vendorId) throw { status: 400, message: "Thiếu vendorId" };
    success(res, await service.recordQuote(req.params.id, vendorId, quoteSchema.parse(rest), req.user.id));
  } catch (e) {
    next(e);
  }
});

router.post("/:id/quotes/decline", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { vendorId, declineReason } = req.body || {};
    if (!vendorId) throw { status: 400, message: "Thiếu vendorId" };
    success(res, await service.declineQuote(req.params.id, vendorId, declineReason, req.user.id));
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/rfq/{id}/award:
 *   post:
 *     summary: Chốt nhà cung cấp và tạo PO
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Đã tạo PO từ báo giá }
 *       400: { description: Báo giá thiếu dòng / RFQ đã chốt }
 */
router.post("/:id/award", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { vendorId, note } = req.body || {};
    if (!vendorId) throw { status: 400, message: "Thiếu vendorId" };
    success(res, await service.award(req.params.id, vendorId, req.user.id, { note }), "Đã chốt nhà cung cấp và tạo đơn mua");
  } catch (e) {
    next(e);
  }
});

router.post("/:id/cancel", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await service.cancel(req.params.id, req.user.id, req.body?.reason), "Đã huỷ RFQ");
  } catch (e) {
    next(e);
  }
});

module.exports = router;