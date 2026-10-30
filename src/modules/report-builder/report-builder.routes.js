/**
 * modules/report-builder/report-builder.routes.js — Routes cho báo cáo động
 * 
 * Tổng quan:
 * - Định nghĩa REST API cho report-builder module
 * - Yêu cầu module "report-builder" trong plan
 * 
 * Routes:
 * - GET /tables: Danh sách bảng được phép (public)
 * - GET /: Danh sách báo cáo đã lưu
 * - POST /: Tạo báo cáo mới (ADMIN/MANAGER)
 * - PATCH /:id: Cập nhật báo cáo (ADMIN/MANAGER)
 * - DELETE /:id: Xoá báo cáo (ADMIN)
 * - POST /run: Chạy truy vấn động (ADMIN/MANAGER)
 * - POST /:id/run: Chạy báo cáo đã lưu
 */
const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./report-builder.service");
const mgr = ["ADMIN", "MANAGER"];

router.use(authenticate, requireModule("report-builder"));

router.get("/tables", authenticate, (req, res) => res.json({ success: true, data: svc.getTables() }));

router.get("/", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listReports(req.user.id) }); } catch (e) { next(e); }
});

router.post("/", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.createReport(req.user.id, req.body) }); } catch (e) { next(e); }
});

router.patch("/:id", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.updateReport(req.params.id, req.user.id, req.body) }); } catch (e) { next(e); }
});

router.delete("/:id", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { await svc.deleteReport(req.params.id, req.user.id); res.json({ success: true }); } catch (e) { next(e); }
});

router.post("/run", authenticate, requireRole(mgr), async (req, res, next) => {
  // CRM audit M2: truyền `req.user` để runQuery áp owner scope cho bảng lead/deal.
  try { res.json({ success: true, data: await svc.runQuery(req.body, { limit: req.query.limit, user: req.user }) }); } catch (e) { next(e); }
});

router.post("/:id/run", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.executeReport(req.params.id, req.user.id, req.query, req.user) }); } catch (e) { next(e); }
});

// Mục 8: seed 10 báo cáo phân tích mặc định (R-01 → R-10) cho tenant — ADMIN
router.post("/seed-defaults", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const { seedDefaultReports } = require("./default-reports.seed");
    res.json({ success: true, data: await seedDefaultReports(req.user.id) });
  } catch (e) { next(e); }
});

module.exports = router;
