const router = require("express").Router();
const { z } = require("zod");
const deliveryService = require("./delivery.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
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

router.get("/:id/track", async (req, res, next) => {
  try {
    success(res, await deliveryService.getTrack(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.use(authenticate);

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
