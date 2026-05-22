// src/modules/fixed-assets/fixed-assets.routes.js
const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const svc = require("./fixed-assets.service");

const ok   = (res, data) => res.json({ success: true, data });
const fail = (res, err)  => res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });

// Categories
router.get("/categories", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.listCategories()); } catch (e) { fail(res, e); }
});
router.post("/categories", authenticate, authorize("ADMIN"), async (req, res) => {
  try { ok(res, await svc.createCategory(req.body)); } catch (e) { fail(res, e); }
});

// Assets
router.get("/", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.listAssets(req.query)); } catch (e) { fail(res, e); }
});
router.get("/:id", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.getAsset(req.params.id)); } catch (e) { fail(res, e); }
});
router.post("/", authenticate, authorize("ADMIN"), async (req, res) => {
  try { ok(res, await svc.createAsset(req.body, req.user.id)); } catch (e) { fail(res, e); }
});

// Dispose
router.post("/:id/dispose", authenticate, authorize("ADMIN"), async (req, res) => {
  try { ok(res, await svc.disposeAsset(req.params.id, req.body, req.user.id)); } catch (e) { fail(res, e); }
});

// Manual depreciation run (admin trigger)
router.post("/depreciation/run", authenticate, authorize("ADMIN"), async (req, res) => {
  try {
    const year  = Number(req.body.year  || new Date().getFullYear());
    const month = Number(req.body.month || new Date().getMonth() + 1);
    ok(res, await svc.runMonthlyDepreciation(year, month, req.user.id));
  } catch (e) { fail(res, e); }
});

module.exports = router;
