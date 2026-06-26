/**
 * modules/crm/tags.routes.js — Định tuyến thẻ khách hàng
 * 
 * Tổng quan:
 * - REST endpoints cho CustomerTag (thẻ gắn cho khách hàng) và gán tag cho khách hàng.
 * - Tích hợp Zod validation, authenticate + authorize + requireModule middleware.
 * 
 * Hàm:
 * - GET /: Danh sách tag (tagsService.list)
 * - POST /: Tạo tag mới (tagsService.create) — ADMIN/MANAGER
 * - PUT /:id: Cập nhật tag (tagsService.update) — ADMIN/MANAGER
 * - DELETE /:id: Xóa tag (tagsService.remove) — ADMIN/MANAGER
 * - GET /customer/:customerId: Danh sách tag của khách hàng (tagsService.listByCustomer)
 * - POST /customer/:customerId/assign/:tagId: Gán tag cho khách hàng (tagsService.assign)
 * - DELETE /customer/:customerId/unassign/:tagId: Gỡ tag khỏi khách hàng (tagsService.unassign)
 */
// src/modules/crm/tags.routes.js
const router = require("express").Router();
const { z } = require("zod");
const tagsService = require("./tags.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { created, success } = require("../../utils/response");

router.use(authenticate, authorize("ADMIN", "MANAGER", "CASHIER"), requireModule("crm"));

const COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;

const createSchema = z.object({
  name: z.string().min(1, "Tên tag không được trống").max(50),
  color: z.string().regex(COLOR_REGEX, "Màu phải dạng #RRGGBB").optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(COLOR_REGEX).optional(),
});

// GET /api/crm/tags
router.get("/", async (req, res, next) => {
  try {
    success(res, await tagsService.list(req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/tags  (ADMIN/MANAGER only)
router.post("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(res, await tagsService.create(data, req.user.id), "Đã tạo tag");
  } catch (err) {
    next(err);
  }
});

// PUT /api/crm/tags/:id  (ADMIN/MANAGER only)
router.put("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    success(
      res,
      await tagsService.update(req.params.id, data, req.user.id),
      "Đã cập nhật tag",
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/tags/:id  (ADMIN/MANAGER only)
router.delete("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(
      res,
      await tagsService.remove(req.params.id, req.user.id),
      "Đã xóa tag",
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/tags/customer/:customerId
router.get("/customer/:customerId", async (req, res, next) => {
  try {
    success(res, await tagsService.listByCustomer(req.params.customerId));
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/tags/customer/:customerId/assign/:tagId
router.post("/customer/:customerId/assign/:tagId", async (req, res, next) => {
  try {
    const { customerId, tagId } = req.params;
    success(
      res,
      await tagsService.assign(customerId, tagId, req.user.id),
      "Đã gắn tag",
    );
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/tags/customer/:customerId/unassign/:tagId
router.delete(
  "/customer/:customerId/unassign/:tagId",
  async (req, res, next) => {
    try {
      const { customerId, tagId } = req.params;
      success(
        res,
        await tagsService.unassign(customerId, tagId, req.user.id),
        "Đã gỡ tag",
      );
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
