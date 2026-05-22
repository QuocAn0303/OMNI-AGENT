// src/modules/projects/task.routes.js
const router = require("express").Router({ mergeParams: true });
const { z } = require("zod");
const service = require("./task.service");
const { authenticate } = require("../../middleware/auth.middleware");
const { requireProjectMember } = require("./project-access.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate);
// Mọi route đều yêu cầu là thành viên của project trong URL.
// (ADMIN/SUPER_ADMIN sẽ tự bypass theo logic của middleware)
router.use(requireProjectMember());

const STATUS = ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"];
const PRIORITY = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const createSchema = z.object({
  title: z.string().min(1, "Tiêu đề không được trống").max(200),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  dueDate: z.string().datetime({ offset: true }).optional().nullable(),
  assigneeId: z.string().uuid("assigneeId phải là uuid").optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  dueDate: z.string().datetime({ offset: true }).optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

// GET /api/projects/:id/tasks
router.get("/", async (req, res, next) => {
  try {
    const { tasks, pagination } = await service.list(req.params.id, req.query);
    paginated(res, tasks, pagination);
  } catch (err) {
    next(err);
  }
});

// POST /api/projects/:id/tasks
router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(res, await service.create(req.params.id, data, req.user.id), "Đã tạo công việc");
  } catch (err) {
    next(err);
  }
});

// PATCH /api/projects/:id/tasks/:taskId
router.patch("/:taskId", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    success(
      res,
      await service.update(req.params.taskId, data, req.user.id, { projectId: req.params.id }),
      "Đã cập nhật"
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /api/projects/:id/tasks/:taskId
router.delete("/:taskId", async (req, res, next) => {
  try {
    success(
      res,
      await service.remove(req.params.taskId, req.user.id, { projectId: req.params.id }),
      "Đã xóa công việc"
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
