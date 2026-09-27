const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../../config/prisma");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const auditService = require("../audit/audit.service");

const idsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

const adjustPriceSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  type: z.enum(["percentage", "fixed"]),
  value: z.number(),
});

router.use(authenticate);
router.use(authorize("ADMIN", "MANAGER"));

router.post("/products/deactivate", async (req, res, next) => {
  try {
    const { ids } = idsSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      for (const id of ids) {
        await tx.product.update({ where: { id }, data: { isActive: false } });
        await auditService.log({ userId: req.user.id, action: "BULK_DEACTIVATE_PRODUCT", entity: "Product", entityId: id });
      }
    });
    success(res, { count: ids.length }, "Vô hiệu hóa sản phẩm thành công");
  } catch (err) {
    next(err);
  }
});

router.post("/products/activate", async (req, res, next) => {
  try {
    const { ids } = idsSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      for (const id of ids) {
        await tx.product.update({ where: { id }, data: { isActive: true } });
        await auditService.log({ userId: req.user.id, action: "BULK_ACTIVATE_PRODUCT", entity: "Product", entityId: id });
      }
    });
    success(res, { count: ids.length }, "Kích hoạt sản phẩm thành công");
  } catch (err) {
    next(err);
  }
});

router.post("/products/adjust-price", async (req, res, next) => {
  try {
    const { ids, type, value } = adjustPriceSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      for (const id of ids) {
        const product = await tx.product.findUnique({ where: { id }, select: { price: true } });
        if (!product) continue;
        const newPrice = type === "percentage"
          ? product.price.mul(1 + value / 100)
          : product.price.add(value);
        await tx.product.update({ where: { id }, data: { price: newPrice } });
        await auditService.log({
          userId: req.user.id,
          action: "BULK_ADJUST_PRICE",
          entity: "Product",
          entityId: id,
          meta: { oldPrice: product.price, newPrice, type, value },
        });
      }
    });
    success(res, { count: ids.length }, "Điều chỉnh giá thành công");
  } catch (err) {
    next(err);
  }
});

router.post("/orders/cancel", async (req, res, next) => {
  try {
    const { ids } = idsSchema.parse(req.body);
    const results = { cancelled: 0, skipped: 0 };
    await prisma.$transaction(async (tx) => {
      for (const id of ids) {
        const order = await tx.order.findUnique({ where: { id }, select: { id: true, status: true } });
        if (!order || !["PENDING", "CONFIRMED"].includes(order.status)) {
          results.skipped++;
          continue;
        }
        await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
        await auditService.log({ userId: req.user.id, action: "BULK_CANCEL_ORDER", entity: "Order", entityId: id });
        results.cancelled++;
      }
    });
    success(res, results, "Hủy đơn hàng thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
