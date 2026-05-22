const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./workflow.service");
const mgr = ["ADMIN", "MANAGER"];

router.get("/", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listWorkflows() }); } catch (e) { next(e); }
});

router.post("/", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.createWorkflow(req.user.id, req.body) }); } catch (e) { next(e); }
});

router.patch("/:id", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.updateWorkflow(req.params.id, req.body) }); } catch (e) { next(e); }
});

router.get("/runs/:runId", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getRun(req.params.runId) }); } catch (e) { next(e); }
});

router.post("/approvals/:id/decide", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.decide(req.params.id, req.user.id, req.body) }); } catch (e) { next(e); }
});

module.exports = router;
