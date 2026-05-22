// src/modules/einvoice/einvoice.routes.js
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const svc = require("./einvoice.service");

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, err) => res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });

// GET /api/einvoice - danh sách HĐĐT
router.get("/", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.list(req.query)); } catch (e) { fail(res, e); }
});

// GET /api/einvoice/:id
router.get("/:id", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.getById(req.params.id)); } catch (e) { fail(res, e); }
});

// POST /api/einvoice/order/:orderId/issue - phát hành HĐĐT cho đơn hàng
router.post("/order/:orderId/issue", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.issueForOrder(req.params.orderId, req.user.id)); } catch (e) { fail(res, e); }
});

// POST /api/einvoice/:id/cancel - hủy HĐĐT
router.post("/:id/cancel", authenticate, authorize("ADMIN"), async (req, res) => {
  try { ok(res, await svc.cancelInvoice(req.params.id, req.user.id)); } catch (e) { fail(res, e); }
});

// POST /api/einvoice/:id/sync - đồng bộ trạng thái từ VNPT
router.post("/:id/sync", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.syncStatus(req.params.id)); } catch (e) { fail(res, e); }
});

module.exports = router;
