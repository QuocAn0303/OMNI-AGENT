// src/modules/crm/tasks.routes.js
const router = require("express").Router();
const { z } = require("zod");
const tasksService = require("./tasks.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate, authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"));

// CASHIER chỉ được phép xem; tạo/sửa/xóa dành cho SUPER_ADMIN/ADMIN/MANAGER
const requireManager = authorize("SUPER_ADMIN", "ADMIN", "MANAGER");

const STATUS = ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"];
const PRIORITY = ["LOW", "NORMAL", "HIGH"];

const createSchema = z.object({
  customerId: z.string().uuid("customerId phải là uuid"),
  title: z.string().min(1, "Tiêu đề không được trống").max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITY).optional(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  assignedToId: z.string().uuid("assignedToId phải là uuid"),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  assignedToId: z.string().uuid().optional(),
});

// GET /api/crm/tasks/assignable-users — danh sách user để giao việc
router.get("/assignable-users", async (req, res, next) => {
  try {
    const prisma = require("../../config/prisma");
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "MANAGER", "CASHIER"] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    });
    success(res, users);
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/tasks?status&priority&assignedTo&customerId&overdue
// CASHIER: ép assignedTo = chính mình (chỉ thấy nhiệm vụ được giao)
router.get("/", async (req, res, next) => {
  try {
    const query = { ...req.query };
    if (req.user.role === "CASHIER") query.assignedTo = req.user.id;
    const { tasks, pagination } = await tasksService.list(query);
    paginated(res, tasks, pagination);
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/tasks/my?overdue=1
router.get("/my", async (req, res, next) => {
  try {
    const { tasks, pagination } = await tasksService.myTasks(req.user.id, req.query);
    paginated(res, tasks, pagination);
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/tasks/my/overdue-count
router.get("/my/overdue-count", async (req, res, next) => {
  try {
    success(res, await tasksService.overdueCountForUser(req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/tasks  (SUPER_ADMIN/ADMIN/MANAGER)
router.post("/", requireManager, async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(res, await tasksService.create(data, req.user.id), "Đã tạo nhiệm vụ");
  } catch (err) {
    next(err);
  }
});

// PATCH /api/crm/tasks/:id  (SUPER_ADMIN/ADMIN/MANAGER)
router.patch("/:id", requireManager, async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    success(res, await tasksService.update(req.params.id, data, req.user.id), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/tasks/:id  (ADMIN/MANAGER only)
router.delete("/:id", requireManager, async (req, res, next) => {
  try {
    success(res, await tasksService.remove(req.params.id, req.user.id), "Đã xóa nhiệm vụ");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
