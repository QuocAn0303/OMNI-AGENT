const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./work-center.service");
const mgr = ["ADMIN", "MANAGER"];

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
