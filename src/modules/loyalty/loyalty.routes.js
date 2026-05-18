const router = require("express").Router();
const { z } = require("zod");
const loyaltyService = require("./loyalty.service");
const auditService = require("../audit/audit.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");

router.post(
  "/adjust",
  authenticate,
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
