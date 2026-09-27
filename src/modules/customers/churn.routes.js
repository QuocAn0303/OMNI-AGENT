/**
 * modules/customers/churn.routes.js — API cảnh báo rời bỏ khách hàng (Mục 4)
 *
 * Routes:
 * - GET  /api/churn-alerts        : Danh sách alert (filter riskLevel, status) — MANAGER/ADMIN
 * - GET  /api/churn-alerts/:id    : Chi tiết alert kèm customer + promotion
 *
 * Swagger: xem @swagger doc từng endpoint.
 */
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const service = require("./churn-automation.service");

router.use(authenticate);

/**
 * @swagger
 * /api/churn-alerts:
 *   get:
 *     summary: Danh sách cảnh báo rời bỏ khách hàng (Churn Win-Back)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: riskLevel
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH, CRITICAL] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, TRIGGERED, RETAINED, LOST] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Danh sách churn alerts có phân trang }
 */
router.get("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { riskLevel, status, page, limit } = req.query;
    success(res, await service.listAlerts({ riskLevel, status, page, limit }));
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/churn-alerts/{id}:
 *   get:
 *     summary: Chi tiết cảnh báo churn
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Chi tiết alert }
 *       404: { description: Không tìm thấy }
 */
router.get("/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await service.getAlertById(req.params.id));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
