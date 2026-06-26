/**
 * modules/production/lot.routes.js — Định tuyến quản lý Lô hàng
 *
 * Tổng quan:
 * - REST endpoints cho quản lý lô/hạn dùng/serial trong sản xuất
 * - Yêu cầu requireModule("production") + authenticate + role MANAGER
 * - Hỗ trợ nhập lô, tiêu thụ lô, danh sách lô sắp hết hạn
 *
 * Hàm:
 * - GET / → svc.listLots: Danh sách lô, lọc theo productId, warehouseId, expiringSoonDays, hasStock
 * - GET /expiring → svc.getExpiringLots: Lô sắp hết hạn trong vòng N ngày (mặc định 30)
 * - GET /:id → svc.getLot: Chi tiết lô kèm giao dịch
 * - POST /receive → svc.receiveLot: Nhập lô mới (upsert theo lotCode+productId+warehouseId)
 * - POST /:id/consume → svc.consumeLot: Tiêu thụ lô, giảm quantity, tạo LotTransaction OUT
 */
const router = require("express").Router();
const { authenticate, requireRole } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./lot.service");
const mgr = ["ADMIN", "MANAGER", "WAREHOUSE"];

router.use(requireModule("production"));

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
