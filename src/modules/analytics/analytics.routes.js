/**
 * modules/analytics/analytics.routes.js — Routes cho phân tích dữ liệu
 * 
 * Tổng quan:
 * - REST API cho analytics module
 * - Yêu cầu module "analytics" trong plan
 * 
 * Routes:
 * - GET /: Dữ liệu analytics theo khoảng thời gian (from, to, groupBy) (ADMIN/MANAGER)
 * - GET /customer-insights: RFM/CLV/churn/tier — dữ liệu đã chấm sẵn trên Customer
 *   (CRM Phase 4 mục 1; trước đó có dữ liệu nhưng không endpoint nào đọc)
 * - GET /sales-insights: Legacy — analytics 30 ngày (ADMIN/MANAGER)
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const analyticsService = require("./analytics.service");

/**
 * GET /api/analytics
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), groupBy (day|week|month)
 * Used by frontend Analytics.jsx
 */
router.use(authenticate, requireModule("analytics"));

router.get("/", authenticate, authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 29);

    const from = req.query.from ? new Date(req.query.from) : defaultFrom;
    const to = req.query.to ? new Date(req.query.to) : now;
    const groupBy = ["day", "week", "month"].includes(req.query.groupBy)
      ? req.query.groupBy
      : "day";

    const data = await analyticsService.getAnalytics(from, to, groupBy);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/analytics/customer-insights:
 *   get:
 *     summary: Chỉ số CRM khách hàng — RFM, CLV, churn, tier (CRM Phase 4 mục 1)
 *     description: >
 *       Đọc dữ liệu ĐÃ TÍNH SẵN trên Customer (rfm.service.js + clv-forecast.service.js).
 *       Không tự tính lại để tránh 2 nguồn sự thật. Khách chưa chấm điểm được
 *       báo riêng ở totals.unscoredCustomers.
 *     tags: [Analytics]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: riskLimit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: clvLimit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: "totals, rfmSegments[], tiers[], clv, churn, atRisk, topClv" }
 */
router.get("/customer-insights", authenticate, authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const clamp = (v, dflt) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : dflt;
    };
    const data = await analyticsService.getCustomerInsights({
      riskLimit: clamp(req.query.riskLimit, 20),
      clvLimit: clamp(req.query.clvLimit, 20),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/analytics/retention-kpi:
 *   get:
 *     summary: KPI giữ chân — cohort, khách rủi ro, hiệu quả win-back (AN.4)
 *     tags: [Analytics]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: months
 *         schema: { type: integer, default: 6 }
 *     responses:
 *       200: { description: "customers{}, cohorts[], winback{}, caveats[]" }
 */
router.get("/retention-kpi", authenticate, authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const months = Number(req.query.months);
    const out = await analyticsService.retentionKpi({
      months: Number.isFinite(months) && months > 0 ? Math.min(24, Math.floor(months)) : 6,
    });
    res.json({ success: true, data: out });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/sales-insights
 * Legacy endpoint — kept for backward compatibility
 */
router.get("/sales-insights", authenticate, authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const out = await analyticsService.salesInsights();
    res.json({ success: true, data: out });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
