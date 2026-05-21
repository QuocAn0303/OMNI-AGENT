// src/modules/production/bom.routes.js
const router = require("express").Router();
const { z } = require("zod");
const service = require("./bom.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate);

const STATUS = ["DRAFT", "ACTIVE", "INACTIVE"];

const itemSchema = z.object({
  componentId: z.string().uuid("componentId phải là uuid"),
  quantity: z.number().int().positive("Số lượng phải > 0"),
  notes: z.string().max(500).optional().nullable(),
});

const createSchema = z.object({
  productId: z.string().uuid("productId phải là uuid"),
  version: z.string().min(1).max(50).optional(),
  status: z.enum(STATUS).optional(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema).min(1, "Cần ít nhất 1 nguyên liệu"),
});

const updateSchema = z.object({
  version: z.string().min(1).max(50).optional(),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema).min(1).optional(),
});

// GET /api/production/boms
router.get("/", async (req, res, next) => {
  try {
    const { items, pagination } = await service.list(req.query);
    paginated(res, items, pagination);
  } catch (err) {
    next(err);
  }
});

// GET /api/production/boms/:id
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/production/boms
router.post(
  "/",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body);
      created(res, await service.create(data, req.user.id), "Đã tạo BOM");
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/production/boms/:id
router.patch(
  "/:id",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const data = updateSchema.parse(req.body);
      success(res, await service.update(req.params.id, data, req.user.id), "Đã cập nhật BOM");
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/production/boms/:id/activate
router.post(
  "/:id/activate",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(res, await service.changeStatus(req.params.id, "ACTIVE", req.user.id), "Đã kích hoạt");
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/production/boms/:id/deactivate
router.post(
  "/:id/deactivate",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(res, await service.changeStatus(req.params.id, "INACTIVE", req.user.id), "Đã vô hiệu hóa");
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/production/boms/:id
router.delete(
  "/:id",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(res, await service.remove(req.params.id, req.user.id), "Đã xóa BOM");
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
