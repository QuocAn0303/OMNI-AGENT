/**
 * modules/crm/segments.routes.js — Định tuyến phân khúc khách hàng
 * 
 * Tổng quan:
 * - REST endpoints cho CustomerSegment (phân khúc khách hàng theo rules).
 * - Hỗ trợ preview segment (xem trước khách hàng matching) trước khi lưu.
 * - Tích hợp Zod validation, authenticate + authorize + requireModule middleware.
 * 
 * Hàm:
 * - GET /: Danh sách segment (segmentsService.list)
 * - GET /fields: Schema fields để frontend render rule builder (segmentsService.SUPPORTED_FIELDS)
 * - POST /preview: Xem trước segment từ rules chưa lưu (segmentsService.previewByRules)
 * - GET /:id: Chi tiết segment (segmentsService.getById)
 * - GET /:id/preview: Xem trước segment đã lưu (segmentsService.preview)
 * - POST /: Tạo segment mới (segmentsService.create)
 * - PUT /:id: Cập nhật segment (segmentsService.update)
 * - DELETE /:id: Xóa segment (segmentsService.remove)
 */
// src/modules/crm/segments.routes.js
const router = require("express").Router();
const { z } = require("zod");
const segmentsService = require("./segments.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");

router.use(authenticate, authorize("ADMIN", "MANAGER"), requireModule("segments"));

const ruleSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.any().optional(),
});

const rulesSchema = z.object({
  all: z.array(ruleSchema).optional(),
  any: z.array(ruleSchema).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  rules: rulesSchema,
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  rules: rulesSchema.optional(),
});

// GET /api/crm/segments
router.get("/", async (req, res, next) => {
  try {
    success(res, await segmentsService.list());
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/segments/fields - schema để frontend render rule builder
router.get("/fields", async (req, res, next) => {
  try {
    success(res, { fields: segmentsService.SUPPORTED_FIELDS });
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/segments/preview - xem trước segment chưa lưu
router.post("/preview", async (req, res, next) => {
  try {
    const { rules } = z.object({ rules: rulesSchema }).parse(req.body);
    const limit = Number(req.query.limit) || 20;
    success(res, await segmentsService.previewByRules(rules, limit));
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/segments/:id
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await segmentsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/segments/:id/preview
router.get("/:id/preview", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 20;
    success(res, await segmentsService.preview(req.params.id, limit));
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/segments
router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(res, await segmentsService.create(data, req.user.id), "Đã tạo segment");
  } catch (err) {
    next(err);
  }
});

// PUT /api/crm/segments/:id
router.put("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    success(res, await segmentsService.update(req.params.id, data, req.user.id), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/segments/:id
router.delete("/:id", async (req, res, next) => {
  try {
    success(res, await segmentsService.remove(req.params.id, req.user.id), "Đã xóa segment");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
