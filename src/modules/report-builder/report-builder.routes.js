const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./report-builder.service");
const mgr = ["ADMIN", "MANAGER"];

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
  try { await svc.deleteReport(req.params.id); res.json({ success: true }); } catch (e) { next(e); }
});

router.post("/run", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.runQuery(req.body, { limit: req.query.limit }) }); } catch (e) { next(e); }
});

router.post("/:id/run", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.executeReport(req.params.id, req.query) }); } catch (e) { next(e); }
});

module.exports = router;
