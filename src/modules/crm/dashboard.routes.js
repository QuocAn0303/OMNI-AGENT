/**
 * modules/crm/dashboard.routes.js — Định tuyến dashboard CRM
 *
 * Tổng quan:
 * - Một endpoint tổng hợp cho trang CRM Dashboard (frontend gọi 1 lần, vẽ nhiều chart).
 * - Phân quyền: ADMIN/MANAGER xem toàn tenant; CASHIER xem số liệu của mình
 *   (service tự scope theo `dealOwnerId`/`leadOwnerId`).
 *
 * Hàm:
 * - GET /         Toàn bộ số liệu: KPI, phễu lead, giá trị theo stage, forecast,
 *                 thắng/thua theo tháng, lý do thua, deal mới cập nhật
 * - GET /funnel   Riêng phễu lead (dùng cho widget nhỏ)
 */
const router = require("express").Router();
const dashboardService = require("./dashboard.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");
const { CRM_PIPELINE_ROLES } = require("./roles");

router.use(authenticate, authorize(...CRM_PIPELINE_ROLES), requireModule("crm"));

/**
 * @swagger
 * /api/crm/dashboard:
 *   get:
 *     summary: Số liệu tổng quan CRM pipeline (KPI, phễu lead, forecast, thắng/thua)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: months
 *         schema: { type: integer, default: 6 }
 *     responses:
 *       200: { description: KPI + funnel + dealByStage + dealByMonth + lostReasons }
 */
router.get("/", async (req, res, next) => {
  try {
    success(res, await dashboardService.getSummary(req.user, { months: req.query.months }));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/dashboard/funnel:
 *   get:
 *     summary: Phễu lead theo giai đoạn kèm tỉ lệ chuyển đổi
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "steps[] + total" }
 */
router.get("/funnel", async (req, res, next) => {
  try {
    success(res, await dashboardService.getFunnel(req.user));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
