/**
 * modules/delivery/delivery.routes.js — Định tuyến module Giao hàng
 *
 * Tổng quan:
 * - Định nghĩa các endpoint REST cho giao hàng: theo dõi, cập nhật, thêm sự kiện
 * - Route GET /:id/track public (chỉ requireModule), các route còn lại yêu cầu authenticate + authorize
 * - Sử dụng Zod để validate request body với providerEnum và statusEnum
 *
 * Hàm:
 * - GET /:id/track → deliveryService.getTrack (public, chỉ requireModule delivery)
 * - PATCH /:id → deliveryService.updateDelivery (ADMIN, MANAGER). Validate body Zod
 * - POST /:id/events → deliveryService.addEvent (ADMIN, MANAGER). Validate body Zod
 */

/**
 * @swagger
 * /api/delivery/{id}/track:
 *   get:
 *     summary: Theo dõi trạng thái giao hàng (public, cần gói delivery)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Không tìm thấy đơn giao hàng }
 *
 * /api/delivery/{id}:
 *   patch:
 *     summary: Cập nhật đơn giao hàng (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trackingCode: { type: string }
 *               status:
 *                 type: string
 *                 enum: [PENDING, PICKED_UP, IN_TRANSIT, DELIVERED, FAILED, RETURNED]
 *               shippingFee: { type: number }
 *               failedReason: { type: string }
 *               note: { type: string }
 *     responses:
 *       200: { description: Cập nhật giao hàng thành công }
 *
 * /api/delivery/{id}/events:
 *   post:
 *     summary: Ghi sự kiện vận chuyển (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, PICKED_UP, IN_TRANSIT, DELIVERED, FAILED, RETURNED]
 *               location: { type: string }
 *               note: { type: string }
 *               occurredAt: { type: string, format: date-time }
 *     responses:
 *       200: { description: Ghi sự kiện thành công }
 */
const router = require("express").Router();
const { z } = require("zod");
const deliveryService = require("./delivery.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");

const providerEnum = z.enum([
  "GHTK",
  "GHN",
  "VNPOST",
  "VIETTEL_POST",
  "J_T",
  "SELF",
  "OTHER",
]);
const statusEnum = z.enum([
  "PENDING",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "RETURNED",
]);

router.get("/:id/track", requireModule("delivery"), async (req, res, next) => {
  try {
    success(res, await deliveryService.getTrack(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.use(authenticate, requireModule("delivery"));

router.patch(
  "/:id",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          trackingCode: z.string().optional(),
          status: statusEnum.optional(),
          shippingFee: z.number().min(0).optional(),
          failedReason: z.string().optional(),
          note: z.string().optional(),
        })
        .parse(req.body);
      success(
        res,
        await deliveryService.updateDelivery(req.params.id, body, req.user.id),
        "Cập nhật giao hàng thành công",
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/events",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          status: statusEnum,
          location: z.string().optional(),
          note: z.string().optional(),
          occurredAt: z.string().datetime().optional(),
        })
        .parse(req.body);
      success(
        res,
        await deliveryService.addEvent(req.params.id, body, req.user.id),
        "Ghi sự kiện thành công",
      );
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
