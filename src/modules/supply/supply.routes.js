/**
 * modules/supply/supply.routes.js — Dashboard KPI chuỗi cung ứng (chỉ đọc)
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const service = require("./supply-dashboard.service");

router.use(authenticate);

/**
 * @swagger
 * /api/supply/kpis:
 *   get:
 *     summary: KPI chuỗi cung ứng (tồn kho, vòng quay, tồn chết, giao hàng NCC)
 *     tags: [Supply]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 30 }
 *     responses:
 *       200:
 *         description: Chỉ số kèm `note` giải thích cách tính và giới hạn.
 *           Giá trị `null` = CHƯA ĐỦ DỮ LIỆU, không phải bằng 0.
 */
router.get("/kpis", authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    success(res, await service.getKpis(req.tenantId, { days }));
  } catch (e) {
    next(e);
  }
});

module.exports = router;