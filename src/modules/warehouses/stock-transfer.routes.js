/**
 * modules/warehouses/stock-transfer.routes.js — Routes chuyển kho
 * 
 * Tổng quan:
 * - Tạo và hoàn thành phiếu chuyển kho giữa các warehouse
 * - Yêu cầu authenticate + module stock-transfer
 * 
 * Endpoints:
 * - POST /: Tạo phiếu chuyển (ADMIN, MANAGER, WAREHOUSE)
 * - POST /:id/complete: Hoàn thành chuyển kho (ADMIN, MANAGER, WAREHOUSE)
 * 
 * Validation:
 * - body gồm fromWarehouseId, toWarehouseId uuid bắt buộc, items array tối thiểu 1
 */
const router = require("express").Router();
const { z } = require("zod");
const stockTransferService = require("./stock-transfer.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");

router.use(authenticate, requireModule("stock-transfer"));

router.post("/", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = z
      .object({
        fromWarehouseId: z.string().uuid(),
        toWarehouseId: z.string().uuid(),
        note: z.string().optional(),
        items: z
          .array(
            z.object({
              productId: z.string().uuid(),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    created(res, await stockTransferService.create(data, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/complete",
  authorize("ADMIN", "MANAGER", "WAREHOUSE"),
  async (req, res, next) => {
    try {
      success(
        res,
        await stockTransferService.complete(req.params.id, req.user.id),
        "Hoàn tất chuyển kho",
      );
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
