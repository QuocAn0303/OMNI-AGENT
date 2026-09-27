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

/**
 * @swagger
 * /api/portal/otp/request:
 *   post:
 *     summary: Gửi OTP đăng nhập cho khách hàng (public, rate-limit 5/phút)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/otp/verify:
 *   post:
 *     summary: Xác thực OTP, nhận portal session token (public, rate-limit)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone: { type: string }
 *               otp: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/me:
 *   get:
 *     summary: Thông tin cá nhân khách hàng (header x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/orders:
 *   get:
 *     summary: Đơn hàng của khách (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Đặt hàng lại / tạo đơn từ portal (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/debt:
 *   get:
 *     summary: Công nợ của khách (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/debt/pay:
 *   get:
 *     summary: Tạo VietQR thanh toán công nợ (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/invoices:
 *   get:
 *     summary: Hóa đơn của khách (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/rewards:
 *   get:
 *     summary: Phần thưởng điểm loyalty của khách (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/portal/rewards/redeem:
 *   post:
 *     summary: Đổi phần thưởng (x-portal-token)
 *     parameters:
 *       - in: header
 *         name: x-portal-token
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rewardId: { type: string }
 *     responses:
 *       200: { description: OK }
 */
// src/modules/portal/portal.routes.js — no auth middleware (uses portal token)
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { requireModule } = require("../../middleware/plan.middleware");
const { runWithTenant } = require("../../config/tenantContext");
const { success, error } = require("../../utils/response");
const svc = require("./portal.service");

router.use(requireModule("portal"));

const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu OTP, vui lòng thử lại sau." },
});

// Middleware to parse portal session token
// M11: chỉ nhận token từ header — query string lọt access log/referrer
const withCustomer = async (req, res, next) => {
  const token = req.headers["x-portal-token"];
  if (!token) return error(res, "Cần đăng nhập", 401);
  try {
    const customer = await svc.resolveSession(token);
    req.customer = customer;
    // Scope toàn bộ handlers downstream theo tenant của khách hàng
    runWithTenant(customer.tenantId, () => next());
  } catch (e) {
    error(res, e.message, e.status || 401);
  }
};

// OTP flow
router.post("/otp/request", otpLimiter, async (req, res, next) => {
  try { success(res, await svc.requestOtp(req.body.phone)); } catch (e) { next(e); }
});

router.post("/otp/verify", otpLimiter, async (req, res, next) => {
  try { success(res, await svc.verifyOtp(req.body.phone, req.body.otp)); } catch (e) { next(e); }
});

// Protected portal routes
router.get("/me", withCustomer, async (req, res, next) => {
  try { success(res, await svc.getMyProfile(req.customer.id)); } catch (e) { next(e); }
});

router.get("/orders", withCustomer, async (req, res, next) => {
  try { success(res, await svc.getMyOrders(req.customer.id, req.query)); } catch (e) { next(e); }
});

router.get("/debt", withCustomer, async (req, res, next) => {
  try { success(res, await svc.getMyDebt(req.customer.id)); } catch (e) { next(e); }
});

router.get("/invoices", withCustomer, async (req, res, next) => {
  try { success(res, await svc.getMyInvoices(req.customer.id, req.query)); } catch (e) { next(e); }
});

// Phase E: Self-order
router.post("/orders", withCustomer, async (req, res, next) => {
  try { success(res, await svc.createMyOrder(req.customer.id, req.body)); } catch (e) { next(e); }
});

// Phase E: Pay debt via VietQR
router.get("/debt/pay", withCustomer, async (req, res, next) => {
  try { success(res, await svc.payMyDebt(req.customer.id)); } catch (e) { next(e); }
});

// Phase E: Loyalty
router.get("/rewards", withCustomer, async (req, res, next) => {
  try { success(res, await svc.getMyRewards(req.customer.id)); } catch (e) { next(e); }
});

router.post("/rewards/redeem", withCustomer, async (req, res, next) => {
  try { success(res, await svc.redeemReward(req.customer.id, req.body.rewardId)); } catch (e) { next(e); }
});

module.exports = router;
