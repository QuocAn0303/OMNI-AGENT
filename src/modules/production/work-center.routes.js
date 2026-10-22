/**
 * modules/production/work-center.routes.js — Định tuyến quản lý Work Center
 *
 * Tổng quan:
 * - REST endpoints cho quản lý trung tâm làm việc (Work Center)
 * - Yêu cầu requireModule("production") + authenticate
 * - Chỉ ADMIN/MANAGER tạo/sửa, chỉ ADMIN xóa
 *
 * Hàm:
 * - GET / → svc.list: Danh sách tất cả work centers kèm account
 * - POST / → svc.create (ADMIN/MANAGER): Tạo work center mới
 * - PATCH /:id → svc.update (ADMIN/MANAGER): Cập nhật work center
 * - DELETE /:id → svc.remove (ADMIN): Xóa work center nếu không được dùng trong routing
 */
const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./work-center.service");
const mgr = ["ADMIN", "MANAGER"];

router.use(authenticate, requireModule("production"));

router.get("/", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.list() }); } catch (e) { next(e); }
});
router.post("/", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.create(req.body) }); } catch (e) { next(e); }
});
router.patch("/:id", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.update(req.params.id, req.body) }); } catch (e) { next(e); }
});
router.delete("/:id", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { await svc.remove(req.params.id); res.json({ success: true }); } catch (e) { next(e); }
});

module.exports = router;
