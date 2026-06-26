/**
 * modules/subscriptions/subscription.routes.js — Routes cho gói dịch vụ & đăng ký
 * 
 * Tổng quan:
 * - REST API cho subscription module
 * - Public: xem gói, xem subscription của tôi
 * - SUPER_OMEGA_ULTRA_ADMIN: CRUD gói, gán cho tenant, quản lý hoá đơn
 * - Webhook PAYOS (raw body — mount trước express.json)
 * 
 * Routes:
 * - GET /plans: Danh sách gói
 * - GET /plans/:id: Chi tiết gói
 * - POST /plans: Tạo gói (SUPER_OMEGA_ULTRA_ADMIN)
 * - PUT /plans/:id: Cập nhật gói (SUPER_OMEGA_ULTRA_ADMIN)
 * - DELETE /plans/:id: Xoá gói (SUPER_OMEGA_ULTRA_ADMIN)
 * - GET /my: Subscription của tôi
 * - GET /my/features: Features của gói tôi đang dùng
 * - GET /my/invoices: Hoá đơn của tôi
 * - POST /my/invoices/:id/pay: Thanh toán hoá đơn
 * - POST /my/upgrade-request: Yêu cầu nâng gói
 * - GET /tenant: Danh sách subscription (SUPER_OMEGA_ULTRA_ADMIN)
 * - POST /tenant/:tenantId: Gán gói cho tenant (SUPER_OMEGA_ULTRA_ADMIN)
 * - GET /admin/invoices: Danh sách hoá đơn (SUPER_OMEGA_ULTRA_ADMIN)
 * - POST /admin/invoices: Tạo hoá đơn (SUPER_OMEGA_ULTRA_ADMIN)
 * - PUT /admin/invoices/:id: Cập nhật hoá đơn (SUPER_OMEGA_ULTRA_ADMIN)
 * - POST /webhook: Webhook PAYOS
 */
const router = require("express").Router();
const { authenticate, requireSuperOmega } = require("../../middleware/auth.middleware");
const controller = require("./subscription.controller");
const {
  createPlanSchema, updatePlanSchema, assignPlanSchema,
  generateInvoiceSchema, updateInvoiceSchema,
} = require("./subscription.validation");

const parseFeatures = (req, res, next) => {
  if (typeof req.body.features === "string") {
    try { req.body.features = JSON.parse(req.body.features); }
    catch { return next({ status: 400, message: "Features không đúng định dạng JSON" }); }
  }
  next();
};

// ==================== Public plan listing ====================
router.get("/plans", authenticate, controller.listPlans);
router.get("/plans/:id", authenticate, controller.getPlan);

// ==================== SUPER_OMEGA_ULTRA_ADMIN: Plan CRUD ====================
router.post("/plans", authenticate, requireSuperOmega, parseFeatures, (req, res, next) => {
  try { req.body = createPlanSchema.parse(req.body); next(); } catch (e) { next(e); }
}, controller.createPlan);

router.put("/plans/:id", authenticate, requireSuperOmega, parseFeatures, (req, res, next) => {
  try { req.body = updatePlanSchema.parse(req.body); next(); } catch (e) { next(e); }
}, controller.updatePlan);

router.delete("/plans/:id", authenticate, requireSuperOmega, controller.deletePlan);

// ==================== Tenant-facing ====================
router.get("/my", authenticate, controller.mySubscription);
router.get("/my/features", authenticate, controller.myPlanFeatures);
router.get("/my/invoices", authenticate, controller.myInvoices);
router.post("/my/invoices/:id/pay", authenticate, controller.payInvoice);
router.post("/my/upgrade-request", authenticate, controller.requestUpgrade);

// ==================== SUPER_OMEGA_ULTRA_ADMIN: Tenant subscriptions ====================
router.get("/tenant", authenticate, requireSuperOmega, controller.listAllTenantSubscriptions);
router.post("/tenant/:tenantId", authenticate, requireSuperOmega, (req, res, next) => {
  try { req.body = assignPlanSchema.parse(req.body); next(); } catch (e) { next(e); }
}, controller.assignPlan);

// ==================== SUPER_OMEGA_ULTRA_ADMIN: Invoices ====================
router.get("/admin/invoices", authenticate, requireSuperOmega, controller.listAllInvoices);
router.post("/admin/invoices", authenticate, requireSuperOmega, (req, res, next) => {
  try { req.body = generateInvoiceSchema.parse(req.body); next(); } catch (e) { next(e); }
}, controller.createInvoice);

router.put("/admin/invoices/:id", authenticate, requireSuperOmega, (req, res, next) => {
  try { req.body = updateInvoiceSchema.parse(req.body); next(); } catch (e) { next(e); }
}, controller.updateInvoice);

// ==================== Webhook (raw body — mounted BEFORE express.json in app.js) ====================
router.post("/webhook", controller.handleWebhook);

module.exports = router;
