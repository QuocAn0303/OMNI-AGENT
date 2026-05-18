const router = require("express").Router();
const { z } = require("zod");
const orderService = require("./order.service");
const invoiceService = require("./invoice.service");
const deliveryService = require("../delivery/delivery.service");
const promotionService = require("../promotions/promotion.service");
const returnService = require("../returns/return.service");
const promotionRoutesModule = require("../promotions/promotion.routes");
const cartItemsSchema = promotionRoutesModule.cartItemsSchema;
const paymentRoutes = require("../payments/payment.routes");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD"]),
  reference: z.string().optional(),
  note: z.string().optional(),
});

const createOrderSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD"]).default("CASH"),
  paymentStatus: z.enum(["UNPAID", "PAID", "PARTIAL"]).default("UNPAID"),
  status: z
    .enum(["PENDING", "CONFIRMED", "SHIPPING", "COMPLETED", "CANCELLED"])
    .default("PENDING"),
  discount: z.number().min(0).default(0),
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  discountValue: z.number().min(0).default(0),
  note: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive("Số lượng phải lớn hơn 0"),
        discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
        discountValue: z.number().min(0).default(0),
      }),
    )
    .min(1, "Đơn hàng phải có ít nhất 1 sản phẩm"),
  payments: z.array(paymentSchema).optional().default([]),
  voucherCode: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  loyaltyPointsUsed: z.number().int().min(0).optional(),
});

router.use(authenticate);
router.use(authorize("ADMIN", "MANAGER", "CASHIER"));
router.use("/:orderId/payments", paymentRoutes);

router.get("/", async (req, res, next) => {
  try {
    const { orders, pagination } = await orderService.getAll(req.query);
    paginated(res, orders, pagination);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/invoice",
  authorize("ADMIN", "MANAGER", "CASHIER"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          taxCode: z.string().optional(),
          companyName: z.string().optional(),
        })
        .parse(req.body || {});
      const { invoice, buffer, order } = await invoiceService.generateInvoice(
        req.params.id,
        body,
        req.user.id,
      );
      if (buffer) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="invoice-${order.orderCode}.pdf"`,
        );
        return res.send(buffer);
      }
      success(res, invoice, "Hóa đơn đã tồn tại");
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id/invoice",
  authorize("ADMIN", "MANAGER", "CASHIER"),
  async (req, res, next) => {
    try {
      const { buffer, order, redirectUrl } = await invoiceService.generateInvoicePDF(
        req.params.id,
      );
      if (redirectUrl) return res.redirect(redirectUrl);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${order.orderCode}.pdf"`,
      );
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/delivery",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          provider: z.enum([
            "GHTK",
            "GHN",
            "VNPOST",
            "VIETTEL_POST",
            "J_T",
            "SELF",
            "OTHER",
          ]),
          trackingCode: z.string().optional(),
          shippingFee: z.number().min(0).optional(),
          recipientName: z.string().optional(),
          recipientPhone: z.string().optional(),
          recipientAddress: z.string().optional(),
          note: z.string().optional(),
        })
        .parse(req.body);
      created(
        res,
        await deliveryService.createForOrder(req.params.id, body, req.user.id),
        "Tạo giao hàng thành công",
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post("/preview-promotions", async (req, res, next) => {
  try {
    const data = cartItemsSchema.parse(req.body);
    success(res, await promotionService.previewAuto(data));
  } catch (err) {
    next(err);
  }
});

router.post("/validate-voucher", async (req, res, next) => {
  try {
    const body = cartItemsSchema.extend({ code: z.string().min(1) }).parse(req.body);
    success(res, await promotionService.validateVoucher(body));
  } catch (err) {
    next(err);
  }
});

router.get(
  "/:id/returnable-items",
  authorize("ADMIN", "MANAGER", "CASHIER"),
  async (req, res, next) => {
    try {
      success(res, await returnService.getReturnableItems(req.params.id));
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id", async (req, res, next) => {
  try {
    const order = await orderService.getById(req.params.id);
    success(res, order);
  } catch (err) {
    next(err);
  }
});
// Chỉ cho phép tạo đơn hàng mới, không cho phép cập nhật thông tin đơn hàng (trừ trạng thái) để đảm bảo tính toàn vẹn dữ liệu
router.post("/", async (req, res, next) => {
  try {
    const data = createOrderSchema.parse(req.body);
    const order = await orderService.create(data, req.user.id);
    created(res, order, "Tạo đơn hàng thành công");
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id/status",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const { status } = z
        .object({
          status: z.enum([
            "PENDING",
            "CONFIRMED",
            "SHIPPING",
            "COMPLETED",
            "CANCELLED",
          ]),
        })
        .parse(req.body);
      const order = await orderService.updateStatus(
        req.params.id,
        status,
        req.user.id,
      );
      success(res, order, "Cập nhật trạng thái thành công");
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
