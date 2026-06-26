/**
 * modules/portal/portal.routes.js — Routes cho cổng thông tin khách hàng
 * 
 * Tổng quan:
 * - Không dùng JWT thông thường, dùng portal token (x-portal-token)
 * - Yêu cầu module "portal" trong plan
 * 
 * Routes:
 * - POST /otp/request: Gửi OTP đăng nhập
 * - POST /otp/verify: Xác thực OTP, nhận session token
 * - GET /me: Lấy thông tin cá nhân (cần x-portal-token)
 * - GET /orders: Lấy đơn hàng (cần x-portal-token)
 * - GET /debt: Lấy công nợ (cần x-portal-token)
 * - GET /invoices: Lấy hoá đơn (cần x-portal-token)
 * 
 * Middleware:
 * - withCustomer: Parse x-portal-token, gắn req.customer
 */
// src/modules/portal/portal.routes.js — no auth middleware (uses portal token)
const router = require("express").Router();
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./portal.service");

router.use(requireModule("portal"));

// Middleware to parse portal session token
const withCustomer = async (req, res, next) => {
  const token = req.headers["x-portal-token"] || req.query.token;
  if (!token) return res.status(401).json({ success: false, message: "Cần đăng nhập" });
  try {
    req.customer = await svc.resolveSession(token);
    next();
  } catch (e) {
    res.status(e.status || 401).json({ success: false, message: e.message });
  }
};

// OTP flow
router.post("/otp/request", async (req, res, next) => {
  try { res.json({ success: true, data: await svc.requestOtp(req.body.phone) }); } catch (e) { next(e); }
});

router.post("/otp/verify", async (req, res, next) => {
  try { res.json({ success: true, data: await svc.verifyOtp(req.body.phone, req.body.otp) }); } catch (e) { next(e); }
});

// Protected portal routes
router.get("/me", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getMyProfile(req.customer.id) }); } catch (e) { next(e); }
});

router.get("/orders", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getMyOrders(req.customer.id, req.query) }); } catch (e) { next(e); }
});

router.get("/debt", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getMyDebt(req.customer.id) }); } catch (e) { next(e); }
});

router.get("/invoices", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getMyInvoices(req.customer.id, req.query) }); } catch (e) { next(e); }
});

// Phase E: Self-order
router.post("/orders", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.createMyOrder(req.customer.id, req.body) }); } catch (e) { next(e); }
});

// Phase E: Pay debt via VietQR
router.get("/debt/pay", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.payMyDebt(req.customer.id) }); } catch (e) { next(e); }
});

// Phase E: Loyalty
router.get("/rewards", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getMyRewards(req.customer.id) }); } catch (e) { next(e); }
});

router.post("/rewards/redeem", withCustomer, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.redeemReward(req.customer.id, req.body.rewardId) }); } catch (e) { next(e); }
});

module.exports = router;
