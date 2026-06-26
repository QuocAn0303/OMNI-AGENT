/**
 * modules/production/routing.routes.js — Định tuyến quản lý Routing (quy trình sản xuất)
 *
 * Tổng quan:
 * - REST endpoints cho quản lý quy trình sản xuất (Routing)
 * - Yêu cầu requireModule("production") + authenticate
 * - Chỉ ADMIN/MANAGER mới được tạo/sửa
 *
 * Hàm:
 * - GET / → svc.list: Danh sách routing, lọc theo productId, kèm operations và workCenter
 * - GET /:id → svc.getById: Chi tiết routing kèm danh sách operations theo sequence
 * - POST / → svc.create (ADMIN/MANAGER): Tạo routing mới với danh sách operations
 * - PATCH /:id → svc.update (ADMIN/MANAGER): Cập nhật routing, thay thế operations trong transaction
 */
const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./routing.service");
const mgr = ["ADMIN", "MANAGER"];

router.use(requireModule("production"));

router.get("/", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.list(req.query) }); } catch (e) { next(e); }
});
router.get("/:id", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getById(req.params.id) }); } catch (e) { next(e); }
});
router.post("/", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.create(req.body) }); } catch (e) { next(e); }
});
router.patch("/:id", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.update(req.params.id, req.body) }); } catch (e) { next(e); }
});

module.exports = router;
