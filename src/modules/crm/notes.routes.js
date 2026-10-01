/**
 * modules/crm/notes.routes.js — Định tuyến ghi chú khách hàng
 * 
 * Tổng quan:
 * - REST endpoints cho CustomerNote (ghi chú về khách hàng: NOTE, CALL, EMAIL, MEETING, ZALO).
 * - Hỗ trợ CRUD ghi chú theo khách hàng.
 * - Tích hợp Zod validation, authenticate + authorize + requireModule middleware.
 * 
 * Hàm:
 * - GET /customer/:customerId: Danh sách ghi chú của khách hàng (notesService.listByCustomer)
 * - POST /customer/:customerId: Tạo ghi chú mới cho khách hàng (notesService.create)
 * - PUT /:id: Cập nhật ghi chú (notesService.update)
 * - DELETE /:id: Xóa ghi chú (notesService.remove)
 */
// src/modules/crm/notes.routes.js
const router = require("express").Router();
const { z } = require("zod");
const notesService = require("./notes.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { paginated, created, success } = require("../../utils/response");
const { CRM_NOTE_ROLES } = require("./roles");

router.use(authenticate, authorize(...CRM_NOTE_ROLES), requireModule("crm"));

const NOTE_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "ZALO"];

const createSchema = z.object({
  content: z.string().min(1, "Nội dung không được trống").max(5000),
  type: z.enum(NOTE_TYPES).optional(),
});

const updateSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  type: z.enum(NOTE_TYPES).optional(),
});

// GET /api/crm/notes/customer/:customerId
router.get("/customer/:customerId", async (req, res, next) => {
  try {
    const { notes, pagination } = await notesService.listByCustomer(
      req.params.customerId,
      req.query,
    );
    paginated(res, notes, pagination);
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/notes/customer/:customerId
router.post("/customer/:customerId", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const note = await notesService.create(
      req.params.customerId,
      data,
      req.user.id,
    );
    created(res, note, "Đã thêm ghi chú");
  } catch (err) {
    next(err);
  }
});

// PUT /api/crm/notes/:id
router.put("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const note = await notesService.update(req.params.id, data, req.user.id);
    success(res, note, "Đã cập nhật ghi chú");
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/notes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const result = await notesService.remove(req.params.id, req.user.id);
    success(res, result, "Đã xóa ghi chú");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
