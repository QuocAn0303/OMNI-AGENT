/**
 * modules/projects/timesheet.routes.js — Định tuyến Timesheet & Hóa đơn dự án
 *
 * Tổng quan:
 * - REST endpoints cho quản lý timesheet và hóa đơn dự án
 * - Yêu cầu requireModule("projects") + authenticate
 * - ADMIN/MANAGER mới được xóa timesheet và quản lý hóa đơn
 * - Hỗ trợ xuất hóa đơn từ timesheet billable chưa invoice
 *
 * Hàm:
 * - GET / → svc.listEntries: Danh sách time entries, lọc theo projectId/userId/invoiced
 * - POST / → svc.createEntry: Tạo time entry mới, tự tính hours nếu có endTime
 * - PATCH /:entryId → svc.updateEntry: Cập nhật entry (chỉ khi chưa invoiced)
 * - DELETE /:entryId → svc.deleteEntry (ADMIN/MANAGER): Xóa entry (chỉ khi chưa invoiced)
 * - GET /../invoices → svc.listInvoices: Danh sách hóa đơn của dự án
 * - POST /../invoices/generate → svc.generateInvoice: Tạo hóa đơn từ timesheet
 * - PATCH /../invoices/:invId → svc.updateInvoiceStatus: Cập nhật trạng thái hóa đơn
 */
// src/modules/projects/timesheet.routes.js
const router = require("express").Router({ mergeParams: true });
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./timesheet.service");
const mgr = ["ADMIN", "MANAGER"];

router.use(requireModule("projects"));

// GET /api/projects/:id/timesheet
router.get("/", authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: await svc.listEntries({ projectId: req.params.id, ...req.query }) });
  } catch (e) { next(e); }
});

// POST /api/projects/:id/timesheet
router.post("/", authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: await svc.createEntry(req.user.id, { projectId: req.params.id, ...req.body }) });
  } catch (e) { next(e); }
});

// PATCH /api/projects/:id/timesheet/:entryId
router.patch("/:entryId", authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: await svc.updateEntry(req.params.entryId, req.user.id, req.body) });
  } catch (e) { next(e); }
});

// DELETE /api/projects/:id/timesheet/:entryId
router.delete("/:entryId", authenticate, requireRole(mgr), async (req, res, next) => {
  try { await svc.deleteEntry(req.params.entryId); res.json({ success: true }); } catch (e) { next(e); }
});

// GET /api/projects/:id/invoices
router.get("/../invoices", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listInvoices(req.params.id) }); } catch (e) { next(e); }
});

// POST /api/projects/:id/invoices/generate
router.post("/../invoices/generate", authenticate, requireRole(mgr), async (req, res, next) => {
  try {
    res.json({ success: true, data: await svc.generateInvoice(req.params.id, { ...req.body, userId: req.user.id }) });
  } catch (e) { next(e); }
});

// PATCH /api/projects/:id/invoices/:invId
router.patch("/../invoices/:invId", authenticate, requireRole(mgr), async (req, res, next) => {
  try {
    res.json({ success: true, data: await svc.updateInvoiceStatus(req.params.invId, req.body.status) });
  } catch (e) { next(e); }
});

module.exports = router;
