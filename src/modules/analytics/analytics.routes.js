/**
 * modules/analytics/analytics.routes.js — Routes cho phân tích dữ liệu
 * 
 * Tổng quan:
 * - REST API cho analytics module
 * - Yêu cầu module "analytics" trong plan
 * 
 * Routes:
 * - GET /: Dữ liệu analytics theo khoảng thời gian (from, to, groupBy) (ADMIN/MANAGER)
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
router.use(requireModule("analytics"));

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
