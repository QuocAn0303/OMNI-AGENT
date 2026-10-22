/**
 * modules/fixed-assets/fixed-assets.routes.js — Routes cho tài sản cố định
 * 
 * Tổng quan:
 * - REST API cho fixed-assets module
 * - Yêu cầu module "fixed-assets" trong plan
 * 
 * Routes:
 * - GET /categories: Danh sách nhóm tài sản (ADMIN/MANAGER)
 * - POST /categories: Tạo nhóm tài sản (ADMIN)
 * - GET /: Danh sách TSCĐ (ADMIN/MANAGER)
 * - GET /:id: Chi tiết TSCĐ (ADMIN/MANAGER)
 * - POST /: Tạo TSCĐ mới (ADMIN)
 * - POST /:id/dispose: Thanh lý TSCĐ (ADMIN)
 * - POST /depreciation/run: Chạy khấu hao thủ công (ADMIN)
 */
// src/modules/fixed-assets/fixed-assets.routes.js
const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./fixed-assets.service");

const ok = (res, data) => res.json({ success: true, data });

router.use(authenticate, requireModule("fixed-assets"));

// Categories
router.get("/categories", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { ok(res, await svc.listCategories()); } catch (e) { next(e); }
});
router.post("/categories", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try { ok(res, await svc.createCategory(req.body)); } catch (e) { next(e); }
});

// Assets
router.get("/", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { ok(res, await svc.listAssets(req.query)); } catch (e) { next(e); }
});
router.get("/:id", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { ok(res, await svc.getAsset(req.params.id)); } catch (e) { next(e); }
});
router.post("/", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try { ok(res, await svc.createAsset(req.body, req.user.id)); } catch (e) { next(e); }
});

// Dispose
router.post("/:id/dispose", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try { ok(res, await svc.disposeAsset(req.params.id, req.body, req.user.id)); } catch (e) { next(e); }
});

// Manual depreciation run (admin trigger)
router.post("/depreciation/run", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try {
    const year  = Number(req.body.year  || new Date().getFullYear());
    const month = Number(req.body.month || new Date().getMonth() + 1);
    ok(res, await svc.runMonthlyDepreciation(year, month, req.user.id));
  } catch (e) { next(e); }
});

module.exports = router;
