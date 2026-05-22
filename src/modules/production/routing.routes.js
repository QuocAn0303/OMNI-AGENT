const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./routing.service");
const mgr = ["ADMIN", "MANAGER"];

router.get("/", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.list(req.query) }); } catch (e) { next(e); }
});
router.get("/:id", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getById(req.params.id) }); } catch (e) { next(e); }
});
router.post("/", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.create(req.body) }); } catch (e) { next(e); }
});
router.patch("/:id", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.update(req.params.id, req.body) }); } catch (e) { next(e); }
});

module.exports = router;
