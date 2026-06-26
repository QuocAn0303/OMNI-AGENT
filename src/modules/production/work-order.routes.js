/**
 * modules/production/work-order.routes.js — Định tuyến module Work Order (lệnh sản xuất)
 *
 * Tổng quan:
 * - REST endpoints cho quản lý lệnh sản xuất (Work Order)
 * - Yêu cầu authenticate + requireModule("production")
 * - Validate body bằng Zod schemas (createSchema, updateSchema)
 * - Hỗ trợ vòng đời: DRAFT → IN_PROGRESS → COMPLETED / CANCELLED
 *
 * Hàm:
 * - GET / → service.list: Danh sách WO phân trang, lọc theo status/productId/search
 * - GET /:id → service.getById: Chi tiết WO kèm items, available stock, line cost
 * - POST / → service.create (ADMIN/MANAGER/WAREHOUSE): Tạo WO từ BOM đang ACTIVE
 * - PATCH /:id → service.update (ADMIN/MANAGER/WAREHOUSE): Cập nhật WO ở DRAFT, tính lại quantity items
 * - POST /:id/start → service.start: Bắt đầu sản xuất, kiểm tra tồn kho và costPrice
 * - POST /:id/complete → service.complete: Hoàn thành, trừ nguyên liệu, nhập thành phẩm, tính giá vốn, tạo bút toán
 * - POST /:id/cancel → service.cancel (ADMIN/MANAGER): Hủy WO
 * - DELETE /:id → service.remove (ADMIN/MANAGER): Xóa WO ở DRAFT
 */
// src/modules/production/work-order.routes.js
const router = require("express").Router();
const { z } = require("zod");
const service = require("./work-order.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate, requireModule("production"));

const createSchema = z.object({
  bomId: z.string().uuid("bomId phải là uuid"),
  quantity: z.number().int().positive("Số lượng phải > 0"),
  warehouseId: z.string().uuid("warehouseId phải là uuid"),
  plannedStartDate: z.string().datetime({ offset: true }).optional().nullable(),
  plannedEndDate: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateSchema = z.object({
  quantity: z.number().int().positive().optional(),
  warehouseId: z.string().uuid().optional(),
  plannedStartDate: z.string().datetime({ offset: true }).optional().nullable(),
  plannedEndDate: z.string().datetime({ offset: true }).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// GET /api/production/work-orders
router.get("/", async (req, res, next) => {
  try {
    const { items, pagination } = await service.list(req.query);
    paginated(res, items, pagination);
  } catch (err) {
    next(err);
  }
});

// GET /api/production/work-orders/:id
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/production/work-orders
router.post(
  "/",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body);
      created(res, await service.create(data, req.user.id), "Đã tạo lệnh sản xuất");
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/production/work-orders/:id
router.patch(
  "/:id",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      const data = updateSchema.parse(req.body);
      success(res, await service.update(req.params.id, data, req.user.id), "Đã cập nhật");
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/production/work-orders/:id/start
router.post(
  "/:id/start",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      success(res, await service.start(req.params.id, req.user.id), "Đã bắt đầu sản xuất");
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/production/work-orders/:id/complete
router.post(
  "/:id/complete",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      success(res, await service.complete(req.params.id, req.user.id), "Đã hoàn thành lệnh sản xuất");
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/production/work-orders/:id/cancel
router.post(
  "/:id/cancel",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(res, await service.cancel(req.params.id, req.user.id), "Đã hủy lệnh sản xuất");
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/production/work-orders/:id
router.delete(
  "/:id",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(res, await service.remove(req.params.id, req.user.id), "Đã xóa lệnh sản xuất");
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
