// src/modules/crm/notes.routes.js
const router = require("express").Router();
const { z } = require("zod");
const notesService = require("./notes.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate, authorize("ADMIN", "MANAGER", "CASHIER"));

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
