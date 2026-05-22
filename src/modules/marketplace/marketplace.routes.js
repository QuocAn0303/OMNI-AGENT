// src/modules/marketplace/marketplace.routes.js
const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const svc = require("./marketplace.service");

const mgr = ["ADMIN", "MANAGER"];

router.get("/shops", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listShops() }); } catch (e) { next(e); }
});

router.post("/shops", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.createShop(req.body) }); } catch (e) { next(e); }
});

router.patch("/shops/:id/toggle", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.toggleShop(req.params.id, req.body.isActive) }); } catch (e) { next(e); }
});

router.get("/shops/:id/listings", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listListings(req.params.id) }); } catch (e) { next(e); }
});

router.post("/shops/:id/listings", authenticate, requireRole(mgr), async (req, res, next) => {
  try {
    const data = await svc.upsertListing(req.params.id, req.body.productId, req.body);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

router.get("/shops/:id/logs", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getSyncLogs(req.params.id, req.query.limit) }); } catch (e) { next(e); }
});

router.post("/shops/:id/push-inventory", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.pushInventory(req.params.id) }); } catch (e) { next(e); }
});

router.post("/shops/:id/pull-orders", authenticate, requireRole(mgr), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.pullOrders(req.params.id) }); } catch (e) { next(e); }
});

module.exports = router;
