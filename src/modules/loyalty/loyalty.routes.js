/**
 * modules/loyalty/loyalty.routes.js — Routes quản lý điểm thưởng (Loyalty)
 *
 * Tổng quan:
 * - Định nghĩa endpoint điều chỉnh điểm loyalty thủ công
 * - Yêu cầu authenticate + requireModule("loyalty") cho tất cả routes
 * - Chỉ ADMIN mới được phép adjust points
 * - Ghi audit log cho mỗi lần điều chỉnh
 *
 * Hàm:
 * - POST /adjust: Điều chỉnh điểm loyalty cho khách hàng — validate (customerId, points, note), gọi loyaltyService.adjustPoints(), ghi audit log (ADMIN)
 */

/**
 * @swagger
 * /api/loyalty/config:
 *   get:
 *     summary: Cấu hình loyalty (tỷ lệ tích điểm, đổi điểm, hạng khách) (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pointsPer1000: { type: number }
 *                 redeemPoints: { type: number }
 *                 redeemValue: { type: number }
 *                 tiers: { type: object }
 *
 * /api/loyalty/adjust:
 *   post:
 *     summary: Điều chỉnh điểm loyalty thủ công (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerId: { type: string }
 *               points: { type: integer, description: Số dương cộng, số âm trừ }
 *               note: { type: string }
 *     responses:
 *       200: { description: Điều chỉnh điểm thành công }
 */
const express = require("express");
const { z } = require("zod");
const loyaltyService = require("./loyalty.service");
const auditService = require("../audit/audit.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");

const router = express.Router();

router.use(authenticate, requireModule("loyalty"));

router.get(
  "/config",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(res, {
        pointsPer1000: loyaltyService.POINTS_PER_1000,
        redeemPoints: loyaltyService.REDEEM_POINTS,
        redeemValue: loyaltyService.REDEEM_VALUE,
        tiers: Object.fromEntries(
          Object.entries(loyaltyService.TIER_LABEL).map(([key, label]) => [
            key,
            {
              threshold: loyaltyService.TIER_THRESHOLDS[key] || 0,
              discountPercent: loyaltyService.TIER_DISCOUNT[key] || 0,
              label,
            },
          ]),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/adjust",
  authorize("ADMIN"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          customerId: z.string().uuid(),
          points: z.number().int(),
          note: z.string().optional(),
        })
        .parse(req.body);
      const customer = await loyaltyService.adjustPoints(
        body.customerId,
        body.points,
        body.note,
        req.user.id,
      );
      await auditService.log({
        userId: req.user.id,
        action: "LOYALTY_ADJUST",
        entity: "Customer",
        entityId: body.customerId,
        after: { points: body.points },
      });
      success(res, customer, "Điều chỉnh điểm thành công");
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
