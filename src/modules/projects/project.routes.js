// src/modules/projects/project.routes.js
const router = require("express").Router();
const { z } = require("zod");
const service = require("./project.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireProjectMember } = require("./project-access.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate);

const STATUS = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"];

const createSchema = z.object({
  name: z.string().min(1, "Tên dự án không được trống").max(200),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(STATUS).optional(),
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  endDate: z.string().datetime({ offset: true }).optional().nullable(),
  budget: z.number().nonnegative().optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  status: z.enum(STATUS).optional(),
  startDate: z.string().datetime({ offset: true }).optional().nullable(),
  endDate: z.string().datetime({ offset: true }).optional().nullable(),
  budget: z.number().nonnegative().optional().nullable(),
});

// GET /api/projects/overview — stats cho dashboard
router.get("/overview", async (req, res, next) => {
  try {
    success(res, await service.overview());
  } catch (err) {
    next(err);
  }
});

// GET /api/projects?status&search&page&limit
router.get("/", async (req, res, next) => {
  try {
    const { items, pagination } = await service.list(req.query);
    paginated(res, items, pagination);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id — member only
router.get("/:id", requireProjectMember(), async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/stats — member only
router.get("/:id/stats", requireProjectMember(), async (req, res, next) => {
  try {
    success(res, await service.getStats(req.params.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id/financial — Budget vs Actual + danh sách chi phí
router.get("/:id/financial", requireProjectMember(), async (req, res, next) => {
  try {
    success(res, await service.getFinancial(req.params.id, req.query));
  } catch (err) {
    next(err);
  }
});

// POST /api/projects
router.post(
  "/",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body);
      created(res, await service.create(data, req.user.id), "Đã tạo dự án");
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/projects/:id — OWNER hoặc ADMIN/SUPER_ADMIN
router.patch(
  "/:id",
  requireProjectMember({ requireRoles: ["OWNER"] }),
  async (req, res, next) => {
    try {
      const data = updateSchema.parse(req.body);
      success(res, await service.update(req.params.id, data, req.user.id), "Đã cập nhật");
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/projects/:id — chỉ ADMIN trở lên (middleware bypass)
router.delete(
  "/:id",
  authorize("ADMIN"),
  async (req, res, next) => {
    try {
      success(res, await service.remove(req.params.id, req.user.id), "Đã xóa dự án");
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
