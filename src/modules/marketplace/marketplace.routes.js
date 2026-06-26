/**
 * modules/marketplace/marketplace.routes.js — Routes cho marketplace
 * 
 * Tổng quan:
 * - REST API cho marketplace module
 * - Yêu cầu module "marketplace" trong plan
 * 
 * Routes:
 * - GET /shops: Danh sách shop
 * - POST /shops: Tạo shop mới (ADMIN)
 * - PATCH /shops/:id/toggle: Bật/tắt shop (ADMIN)
 * - GET /shops/:id/listings: Danh sách listing (ADMIN/MANAGER)
 * - POST /shops/:id/listings: Tạo/cập nhật listing (ADMIN/MANAGER)
 * - GET /shops/:id/logs: Lịch sử đồng bộ (ADMIN/MANAGER)
 * - POST /shops/:id/push-inventory: Đẩy tồn kho lên sàn (ADMIN/MANAGER)
 * - POST /shops/:id/pull-orders: Kéo đơn từ sàn (ADMIN/MANAGER)
 */
// src/modules/marketplace/marketplace.routes.js
const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./marketplace.service");

const mgr = ["ADMIN", "MANAGER"];

router.use(requireModule("marketplace"));

router.get("/shops", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.listShops() }); } catch (e) { next(e); }
});

router.post("/shops", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.createShop(req.body) }); } catch (e) { next(e); }
});

router.patch("/shops/:id/toggle", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.toggleShop(req.params.id, req.body.isActive) }); } catch (e) { next(e); }
});

router.patch("/shops/:id/credentials", authenticate, requireRole(["ADMIN"]), async (req, res, next) => {
  try { res.json({ success: true, data: await svc.updateCredentials(req.params.id, req.body.credentials) }); } catch (e) { next(e); }
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
