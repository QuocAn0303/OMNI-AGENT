/**
 * modules/promotions/promotion.routes.js — Routes quản lý khuyến mãi
 *
 * Tổng quan:
 * - Định nghĩa các endpoint CRUD + actions cho khuyến mãi
 * - Yêu cầu authenticate + requireModule("promotions") cho tất cả routes
 * - Phân quyền ADMIN/MANAGER cho hầu hết actions, ADMIN cho xoá
 * - Validation đầu vào bằng Zod schema (promotionSchema, cartItemsSchema)
 *
 * Hàm:
 * - POST /: Tạo khuyến mãi mới — validate promotionSchema, gọi promotionService.create() (ADMIN, MANAGER)
 * - GET /: Danh sách khuyến mãi phân trang — gọi promotionService.list() (ADMIN, MANAGER)
 * - GET /report: Báo cáo hiệu quả khuyến mãi — gọi promotionService.reportEffectiveness() (ADMIN, MANAGER)
 * - GET /:id: Chi tiết khuyến mãi — gọi promotionService.getById() (ADMIN, MANAGER)
 * - PATCH /:id: Cập nhật khuyến mãi — gọi promotionService.update() (ADMIN, MANAGER)
 * - POST /:id/activate: Kích hoạt khuyến mãi — gọi promotionService.setStatus(id, "ACTIVE") (ADMIN, MANAGER)
 * - POST /:id/pause: Tạm dừng khuyến mãi — gọi promotionService.setStatus(id, "PAUSED") (ADMIN, MANAGER)
 * - DELETE /:id: Xoá khuyến mãi — gọi promotionService.remove() (ADMIN)
 * - router.cartItemsSchema: Export schema để các module khác sử dụng
 */

/**
 * @swagger
 * /api/promotions:
 *   post:
 *     summary: Tạo khuyến mãi mới (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *               name: { type: string }
 *               type: { type: string, enum: [PERCENTAGE, FIXED_AMOUNT, BUY_X_GET_Y, CATEGORY_DISCOUNT, PRODUCT_DISCOUNT, FREE_SHIPPING, HAPPY_HOUR] }
 *               scope: { type: string, enum: [AUTO, VOUCHER_CODE] }
 *               value: { type: number }
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time }
 *     responses:
 *       201: { description: Tạo khuyến mãi thành công }
 *   get:
 *     summary: Danh sách khuyến mãi phân trang (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/promotions/report:
 *   get:
 *     summary: Báo cáo hiệu quả khuyến mãi (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/promotions/{id}:
 *   get:
 *     summary: Chi tiết khuyến mãi (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *   patch:
 *     summary: Cập nhật khuyến mãi (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: Cập nhật thành công }
 *   delete:
 *     summary: Xóa khuyến mãi (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Đã xóa khuyến mãi }
 *
 * /api/promotions/{id}/activate:
 *   post:
 *     summary: Kích hoạt khuyến mãi (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Đã kích hoạt }
 *
 * /api/promotions/{id}/pause:
 *   post:
 *     summary: Tạm dừng khuyến mãi (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Đã tạm dừng }
 */
const express = require("express");
const { z } = require("zod");
const promotionService = require("./promotion.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");

const router = express.Router();

const promotionSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "PERCENTAGE",
    "FIXED_AMOUNT",
    "BUY_X_GET_Y",
    "CATEGORY_DISCOUNT",
    "PRODUCT_DISCOUNT",
    "FREE_SHIPPING",
    "HAPPY_HOUR",
  ]),
  scope: z.enum(["AUTO", "VOUCHER_CODE"]).default("AUTO"),
  value: z.number().positive(),
  maxDiscount: z.number().positive().optional(),
  minOrderValue: z.number().min(0).optional(),
  minQuantity: z.number().int().positive().optional(),
  buyQuantity: z.number().int().positive().optional(),
  getQuantity: z.number().int().positive().optional(),
  startDate: z.string(),
  endDate: z.string(),
  usageLimit: z.number().int().positive().optional(),
  perUserLimit: z.number().int().positive().optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  // Happy Hour fields
  scheduleType: z.enum(["ALWAYS", "CRON"]).optional(),
  cronExpression: z.string().optional(),
  daysOfWeek: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const cartItemsSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
      discountAmount: z.number().min(0).optional(),
    }),
  ).min(1),
  customerId: z.string().uuid().optional().nullable(),
});

router.use(authenticate, requireModule("promotions"));

router.post("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = promotionSchema.parse(req.body);
    created(res, await promotionService.create(data, req.user.id), "Tạo khuyến mãi thành công");
  } catch (e) { next(e); }
});

router.get("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { promotions, pagination } = await promotionService.list(req.query);
    paginated(res, promotions, pagination);
  } catch (e) { next(e); }
});

router.get("/report", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.reportEffectiveness(req.query));
  } catch (e) { next(e); }
});

router.get("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.getById(req.params.id));
  } catch (e) { next(e); }
});

router.patch("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = promotionSchema.partial().parse(req.body);
    success(res, await promotionService.update(req.params.id, data, req.user.id), "Cập nhật thành công");
  } catch (e) { next(e); }
});

router.post("/:id/activate", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.setStatus(req.params.id, "ACTIVE", req.user.id), "Đã kích hoạt");
  } catch (e) { next(e); }
});

router.post("/:id/pause", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await promotionService.setStatus(req.params.id, "PAUSED", req.user.id), "Đã tạm dừng");
  } catch (e) { next(e); }
});

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    await promotionService.remove(req.params.id, req.user.id);
    success(res, null, "Đã xóa khuyến mãi");
  } catch (e) { next(e); }
});

router.cartItemsSchema = cartItemsSchema;
module.exports = router;
