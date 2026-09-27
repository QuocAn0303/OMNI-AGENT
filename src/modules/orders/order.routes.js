/**
 * modules/orders/order.routes.js — Routes quản lý đơn hàng
 * 
 * Tổng quan:
 * - CRUD đơn hàng, in hóa đơn, quản lý giao hàng, khuyến mãi, trả hàng, VietQR
 * - Yêu cầu authenticate + role ADMIN/MANAGER/CASHIER
 * 
 * Endpoints:
 * - GET /: Danh sách đơn hàng phân trang
 * - POST /:id/invoice: Tạo/download hóa đơn PDF
 * - GET /:id/invoice: Tải hóa đơn PDF (hoặc redirect Cloudinary)
 * - POST /:id/delivery: Tạo thông tin giao hàng (ADMIN, MANAGER)
 * - POST /preview-promotions: Xem trước khuyến mãi tự động
 * - POST /validate-voucher: Kiểm tra mã giảm giá
 * - GET /:id/returnable-items: Lấy danh sách sản phẩm có thể trả
 * - GET /:id: Chi tiết đơn hàng
 * - POST /: Tạo đơn hàng mới
 * - PATCH /:id/status: Cập nhật trạng thái (ADMIN, MANAGER)
 * - GET /:id/vietqr: Tạo mã VietQR thanh toán
 * 
 * Validation:
 * - createOrderSchema: items, payments, discount, voucherCode, loyaltyPoints, warehouseId
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Danh sách đơn hàng (phân trang, lọc theo status/search/ngày)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: OK }
 *   post:
 *     summary: Tạo đơn hàng mới
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerId: { type: string }
 *               paymentMethod: { type: string, enum: [CASH, BANK_TRANSFER, CARD, MOMO, VNPAY, ZALOPAY, PAYOS, VIETQR] }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     quantity: { type: integer }
 *               orderType: { type: string, enum: [DINE_IN, TAKEAWAY, DELIVERY, DRIVE_THRU, QR_SELF] }
 *               tableId: { type: string }
 *               warehouseId: { type: string }
 *     responses:
 *       201: { description: Tạo đơn hàng thành công }
 *
 * /api/orders/export:
 *   get:
 *     summary: Xuất Excel đơn hàng (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: File Excel
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *
 * /api/orders/preview-promotions:
 *   post:
 *     summary: Xem trước khuyến mãi tự động cho giỏ hàng
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       200: { description: OK }
 *
 * /api/orders/validate-voucher:
 *   post:
 *     summary: Kiểm tra mã giảm giá
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/orders/{id}:
 *   get:
 *     summary: Chi tiết đơn hàng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/orders/{id}/status:
 *   patch:
 *     summary: Cập nhật trạng thái đơn (ADMIN, MANAGER)
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
 *               status: { type: string, enum: [PENDING, CONFIRMED, SHIPPING, COMPLETED, CANCELLED] }
 *     responses:
 *       200: { description: Cập nhật trạng thái thành công }
 */
const router = require("express").Router();
const { z } = require("zod");
const orderService = require("./order.service");
const invoiceService = require("./invoice.service");
const deliveryService = require("../delivery/delivery.service");
const promotionService = require("../promotions/promotion.service");
const returnService = require("../returns/return.service");
const billSplitService = require("./bill-split.service");
const kdsService = require("../kds/kds.service");
const prisma = require("../../config/prisma");
const promotionRoutesModule = require("../promotions/promotion.routes");
const cartItemsSchema = promotionRoutesModule.cartItemsSchema;
const paymentRoutes = require("../payments/payment.routes");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, paginated } = require("../../utils/response");
const { exportToExcel } = require("../../utils/exporter");

const ALL_PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOMO", "VNPAY", "ZALOPAY", "PAYOS", "VIETQR"];

/**
 * @swagger
 * /api/orders/{id}/invoice:
 *   post:
 *     summary: Tạo hóa đơn PDF cho đơn (ADMIN, MANAGER, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taxCode: { type: string }
 *               companyName: { type: string }
 *     responses:
 *       200:
 *         description: File PDF hóa đơn
 *         content:
 *           application/pdf: { schema: { type: string, format: binary } }
 *   get:
 *     summary: Tải hóa đơn PDF (hoặc redirect Cloudinary)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: File PDF hóa đơn
 *         content:
 *           application/pdf: { schema: { type: string, format: binary } }
 *
 * /api/orders/{id}/delivery:
 *   post:
 *     summary: Tạo thông tin giao hàng cho đơn (ADMIN, MANAGER)
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
 *               provider: { type: string, enum: [GHTK, GHN, VNPOST, VIETTEL_POST, J_T, SELF, OTHER] }
 *               trackingCode: { type: string }
 *               shippingFee: { type: number }
 *               recipientName: { type: string }
 *               recipientPhone: { type: string }
 *               recipientAddress: { type: string }
 *               note: { type: string }
 *     responses:
 *       201: { description: Tạo giao hàng thành công }
 *
 * /api/orders/{id}/returnable-items:
 *   get:
 *     summary: Danh sách sản phẩm có thể trả hàng (ADMIN, MANAGER, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/orders/{id}/vietqr:
 *   get:
 *     summary: Tạo mã VietQR thanh toán cho đơn
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: bankBin
 *         schema: { type: string }
 *       - in: query
 *         name: accountNumber
 *         schema: { type: string }
 *       - in: query
 *         name: accountName
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: QR string + base64
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 orderCode: { type: string }
 *                 total: { type: number }
 *                 qrString: { type: string }
 *                 qrBase64: { type: string }
 */
const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(ALL_PAYMENT_METHODS),
  reference: z.string().optional(),
  note: z.string().optional(),
});

const createOrderSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  paymentMethod: z.enum(ALL_PAYMENT_METHODS).default("CASH"),
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
        serials: z.array(z.string().uuid()).optional(),
        // F&B: modifier (topping, size, đường, đá...)
        modifiers: z.array(z.object({
          modifierOptionId: z.string().uuid(),
          quantity: z.number().int().positive().default(1),
        })).optional(),
        courseId: z.number().int().positive().default(1),
      }),
    )
    .min(1, "Đơn hàng phải có ít nhất 1 sản phẩm"),
  payments: z.array(paymentSchema).optional().default([]),
  voucherCode: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  loyaltyPointsUsed: z.number().int().min(0).optional(),
  // F&B order-level
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "DRIVE_THRU", "QR_SELF"]).default("DINE_IN"),
  tableId: z.string().uuid().optional(),
  tableSessionId: z.string().uuid().optional(),
  seatNumber: z.number().int().positive().optional(),
  serviceChargePercent: z.number().min(0).max(100).default(0),
  tipAmount: z.number().min(0).default(0),
  channel: z.string().default("POS"),
  channelOrderId: z.string().optional(),
});

router.use(authenticate);
router.use(authorize("ADMIN", "MANAGER", "CASHIER"));
router.use("/:orderId/payments", paymentRoutes);

// Xuất Excel — chỉ ADMIN, MANAGER
router.get("/export", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { status } = req.query;
    const orders = await prisma.order.findMany({
      where: { ...(status ? { status } : {}) },
      include: { customer: { select: { name: true } }, createdBy: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    const buf = await exportToExcel(
      orders.map(o => ({ code: o.orderCode, customer: o.customer?.name || "", total: Number(o.total), status: o.status, date: new Date(o.createdAt).toLocaleDateString("vi-VN"), staff: o.createdBy?.fullName || "" })),
      [
        { header: "Mã đơn", key: "code" },
        { header: "Khách hàng", key: "customer" },
        { header: "Tổng tiền", key: "total" },
        { header: "Trạng thái", key: "status" },
        { header: "Ngày", key: "date" },
        { header: "NV bán", key: "staff" },
      ],
      "Đơn hàng"
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=orders_${Date.now()}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (e) { next(e); }
});

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
    const order = await orderService.create(data, req.user.id, {
      overrideCreditLimit: req.body.overrideCreditLimit === true,
      userRole: req.user.role,
    });
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

// GET /api/orders/:id/vietqr — tạo VietQR cho đơn hàng
router.get("/:id/vietqr", authenticate, async (req, res, next) => {
  try {
    const { generateVietQRBase64, buildVietQRString, BANK_BINS } = require("../../utils/vietqr");
    const order = await orderService.getById(req.params.id);
    const bankBin  = req.query.bankBin  || BANK_BINS.VCB;
    const accountNumber = req.query.accountNumber || "";
    const accountName   = req.query.accountName   || "";
    if (!accountNumber) throw { status: 400, message: "accountNumber là bắt buộc" };

    const description = `TT ${order.orderCode}`.slice(0, 25);
    const qrString = buildVietQRString({ bankBin, accountNumber, accountName, amount: Number(order.total), description });
    const qrBase64 = await generateVietQRBase64({ bankBin, accountNumber, accountName, amount: Number(order.total), description });

    success(res, { orderId: order.id, orderCode: order.orderCode, total: order.total, qrString, qrBase64 });
  } catch (err) { next(err); }
});

// ==================== F&B ENDPOINTS (Phase 3 + 4) ====================

/**
 * @swagger
 * /api/orders/{id}/items/{itemId}/void:
 *   post:
 *     summary: Hủy 1 món trong đơn (trên 100k cần MANAGER duyệt)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Đã hủy món }
 *
 * /api/orders/{id}/split-bill:
 *   post:
 *     summary: Tách tiền hóa đơn (ITEM | EVEN | CUSTOM)
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
 *               mode: { type: string, enum: [ITEM, EVEN, CUSTOM] }
 *               n: { type: integer }
 *               splits:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     itemId: { type: string }
 *                     amount: { type: number }
 *     responses:
 *       200: { description: Tách tiền thành công }
 *
 * /api/orders/{id}/splits:
 *   get:
 *     summary: Danh sách nhóm tiền đã tách
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/orders/{id}/splits/{splitId}/pay:
 *   post:
 *     summary: Đánh dấu 1 nhóm đã thanh toán
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: splitId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentMethod: { type: string, enum: [CASH, BANK_TRANSFER, CARD, MOMO, VNPAY, ZALOPAY, PAYOS, VIETQR] }
 *     responses:
 *       200: { description: OK }
 *
 * /api/orders/{id}/kds-generate:
 *   post:
 *     summary: Gửi món ra bếp (sinh KDS ticket)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Đã gửi món ra bếp }
 */

// POST /api/orders/:id/items/:itemId/void — hủy 1 món (cần reason, >100k cần MANAGER)
router.post("/:id/items/:itemId/void", async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const item = await prisma.orderItem.findUnique({
      where: { id: req.params.itemId },
      include: { order: true },
    });
    if (!item || item.orderId !== req.params.id) {
      throw { status: 404, message: "Không tìm thấy món trong đơn" };
    }
    if (item.status === "VOIDED") throw { status: 400, message: "Món đã hủy rồi" };

    // 4-eyes: void > 100k cần MANAGER+
    const voidAmount = Number(item.subtotal);
    if (voidAmount > 100000 && !["ADMIN", "MANAGER"].includes(req.user.role)) {
      throw { status: 403, message: "Hủy món trên 100k cần quản lý duyệt" };
    }

    await prisma.orderItem.update({
      where: { id: item.id },
      data: { status: "VOIDED", voidReason: reason },
    });
    // Void KDS ticket nếu có
    await prisma.kdsTicket.updateMany({
      where: { orderItemId: item.id },
      data: { status: "VOIDED" },
    });
    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: "VOID_ORDER_ITEM",
        entity: "OrderItem",
        entityId: item.id,
        before: { status: item.status, subtotal: item.subtotal },
        after: { status: "VOIDED", reason },
      },
    });
    success(res, { id: item.id, status: "VOIDED", voidReason: reason }, "Đã hủy món");
  } catch (err) { next(err); }
});

// POST /api/orders/:id/split-bill — tách tiền (ITEM | EVEN | CUSTOM)
router.post("/:id/split-bill", async (req, res, next) => {
  try {
    const { mode, splits, n } = z.object({
      mode: z.enum(["ITEM", "EVEN", "CUSTOM"]),
      // ITEM: [{ label, itemIds: [orderItemId], quantities: { orderItemId: qty } }]
      // CUSTOM: [{ label, amount }]
      splits: z.array(z.object({
        label: z.string().optional(),
        itemIds: z.array(z.string().min(1)).optional(),
        quantities: z.record(z.string(), z.number().int().positive()).optional(),
        amount: z.number().positive().optional(),
      })).optional(),
      n: z.number().int().min(2).optional(),
    }).parse(req.body);
    const result = await billSplitService.splitBill(req.params.id, mode, mode === "EVEN" ? n : splits, req.user.id);
    success(res, result, "Tách tiền thành công");
  } catch (err) { next(err); }
});

// GET /api/orders/:id/splits — xem các nhóm đã tách
router.get("/:id/splits", async (req, res, next) => {
  try { success(res, await billSplitService.listSplits(req.params.id)); }
  catch (err) { next(err); }
});

// POST /api/orders/:id/splits/:splitId/pay — đánh dấu 1 nhóm đã thanh toán
router.post("/:id/splits/:splitId/pay", async (req, res, next) => {
  try {
    const { paymentMethod } = z.object({ paymentMethod: z.enum(ALL_PAYMENT_METHODS) }).parse(req.body);
    success(res, await billSplitService.markSplitPaid(req.params.splitId, paymentMethod, req.user.id));
  } catch (err) { next(err); }
});

// POST /api/orders/:id/kds-generate — gửi món ra bếp (sinh KDS ticket)
router.post("/:id/kds-generate", async (req, res, next) => {
  try {
    const tickets = await kdsService.generateTicketsForOrder(req.params.id);
    success(res, tickets, `Đã gửi ${tickets.length} món ra bếp`);
  } catch (err) { next(err); }
});

module.exports = router;
