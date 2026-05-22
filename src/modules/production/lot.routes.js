const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./lot.service");
const mgr = ["ADMIN", "MANAGER", "WAREHOUSE"];

router.get("/", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listLots(req.query) }); } catch (e) { next(e); }
});
router.get("/expiring", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getExpiringLots(req.query.days || 30) }); } catch (e) { next(e); }
});
router.get("/:id", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getLot(req.params.id) }); } catch (e) { next(e); }
});
router.post("/receive", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.receiveLot(req.body) }); } catch (e) { next(e); }
});
router.post("/:id/consume", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.consumeLot(req.params.id, req.body.quantity, req.body) }); } catch (e) { next(e); }
});

module.exports = router;
