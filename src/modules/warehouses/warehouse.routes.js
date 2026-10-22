/**
 * modules/warehouses/warehouse.routes.js — Routes quản lý kho hàng
 * 
 * Tổng quan:
 * - CRUD kho hàng với Zod validation, yêu cầu authenticate
 * 
 * Endpoints:
 * - GET /: Danh sách kho (tất cả role)
 * - POST /: Tạo kho mới (ADMIN)
 * - PATCH /:id: Cập nhật kho (ADMIN)
 * 
 * Validation:
 * - POST: code, name bắt buộc; address, isDefault optional
 * - PATCH: name, address, isActive, isDefault optional
 */
const router = require("express").Router();
const { z } = require("zod");
const warehouseService = require("./warehouse.service");
const treeService = require("./warehouse-tree.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created } = require("../../utils/response");

router.use(authenticate);

/**
 * Cây vị trí trong kho (Odoo `stock.location`).
 *
 * THỨ TỰ ROUTE CÓ Ý NGHĨA: `GET /tree/flat` phải khai TRƯỚC `GET /:id/tree`,
 * nếu không Express sẽ khớp "tree" vào `:id` và trả nhầm cây của kho có id="tree".
 * Cùng lý do với bài học `tests/partner-routing.test.js` trong module PRM.
 */
router.get("/tree/flat", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await treeService.listFlat({ warehouseId: req.query.warehouseId }));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/tree", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await treeService.getTree(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/locations", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        locationType: z.enum(["PHYSICAL", "VIEW", "INTERNAL"]).optional(),
      })
      .parse(req.body);
    created(res, await treeService.createLocation({ warehouseId: req.params.id, ...data }, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/location-type", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { locationType } = z
      .object({ locationType: z.enum(["PHYSICAL", "VIEW", "INTERNAL"]) })
      .parse(req.body);
    success(res, await treeService.setLocationType(req.params.id, locationType, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.get("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    success(res, await warehouseService.list());
  } catch (err) {
    next(err);
  }
});

router.post("/", authorize("ADMIN"), async (req, res, next) => {
  try {
    const data = z
      .object({
        code: z.string().min(2),
        name: z.string().min(2),
        address: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    created(res, await warehouseService.create(data, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().optional(),
        address: z.string().optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    success(res, await warehouseService.update(req.params.id, data, req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
