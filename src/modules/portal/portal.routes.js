// src/modules/portal/portal.routes.js — no auth middleware (uses portal token)
const router = require("express").Router();
const svc = require("./portal.service");

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

module.exports = router;
