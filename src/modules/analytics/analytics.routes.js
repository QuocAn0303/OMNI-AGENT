const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const analyticsService = require("./analytics.service");

/**
 * GET /api/analytics
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), groupBy (day|week|month)
 * Used by frontend Analytics.jsx
 */
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
