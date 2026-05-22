// src/modules/projects/timesheet.routes.js
const router = require("express").Router({ mergeParams: true });
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./timesheet.service");
const mgr = ["ADMIN", "MANAGER"];

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
