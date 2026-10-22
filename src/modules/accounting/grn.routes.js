/**
 * modules/accounting/grn.routes.js — Routes Phiếu nhập kho từ PO (Mục 6)
 *
 * Routes:
 * - POST /api/grn                 : Tạo GRN DRAFT từ PO (ADMIN/MANAGER/WAREHOUSE)
 * - POST /api/grn/:id/qc          : Ghi nhận QC pass/reject → QC_DONE
 * - POST /api/grn/:id/post        : POSTED — nhập kho + tính onTime
 * - GET  /api/grn?poId=&status=   : Danh sách GRN
 * - GET  /api/grn/:id             : Chi tiết GRN
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");
const service = require("./grn.service");

router.use(authenticate);

const grnItemSchema = z.object({
  purchaseItemId: z.string().min(1),
  productId: z.string().min(1),
  receivedQty: z.number().int().positive(),
  lotCode: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
});

const createSchema = z.object({
  purchaseOrderId: z.string().min(1),
  warehouseId: z.string().optional().nullable(),
  receivedAt: z.string().optional().nullable(),
  items: z.array(grnItemSchema).min(1),
});

const qcSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        passQty: z.number().int().nonnegative(),
        rejectQty: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

/**
 * @swagger
 * /api/grn:
 *   post:
 *     summary: Tạo Phiếu nhập kho (GRN) từ Purchase Order
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Đã tạo GRN DRAFT }
 *       400: { description: Nhận vượt số lượng đặt / PO không hợp lệ }
 */
router.post("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(
      res,
      await service.create(data.purchaseOrderId, data, req.user.id),
      "Đã tạo phiếu nhận hàng (GRN)",
    );
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/grn/{id}/qc:
 *   post:
 *     summary: Lập phiếu QC — ghi nhận PASS/REJECT từng dòng
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: GRN chuyển QC_DONE }
 */
router.post("/:id/qc", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = qcSchema.parse(req.body);
    success(res, await service.recordQc(req.params.id, data.items, req.user.id), "Đã ghi nhận QC");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/grn/{id}/post:
 *   post:
 *     summary: POSTED — nhập kho (bình quân gia quyền) + tính onTime
 *     tags: [SRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: GRN POSTED — hàng đã vào tồn kho }
 */
router.post("/:id/post", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await service.post(req.params.id, req.user.id), "Đã nhập kho (GRN POSTED)");
  } catch (e) {
    next(e);
  }
});

router.post("/quick-receive", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const schema = z.object({
      purchaseOrderId: z.string().min(1),
      warehouseId: z.string().optional().nullable(),
    });
    const data = schema.parse(req.body);
    success(res, await service.quickReceive(data.purchaseOrderId, { warehouseId: data.warehouseId }, req.user.id), "Đã nhận nhanh (GRN POSTED)");
  } catch (e) {
    next(e);
  }
});

router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await service.list(req.query));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
