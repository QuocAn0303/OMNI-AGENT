const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const paymentService = require("../payments/payment.service");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");
const debtService = require("../debt/debt.service");
const promotionService = require("../promotions/promotion.service");
const loyaltyService = require("../loyalty/loyalty.service");
const {
  getDefaultWarehouseId,
  resolveWarehouseId,
  findInventory,
} = require("../../utils/warehouse.helper");

const toNumber = (value) => Number(value || 0);

const generateOrderCode = async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await prisma.order.count({
    where: { createdAt: { gte: start } },
  });
  return `ORD-${today}-${String(count + 1).padStart(4, "0")}`;
};
//tính toán logic giảm giá phức tạp: hỗ trợ cả giảm giá theo % và theo số tiền, áp dụng cho từng item hoặc toàn đơn hàng, đảm bảo không vượt quá giá trị gốc
const calculateDiscount = (base, type = "NONE", value = 0) => {
  const amount = toNumber(value);
  if (amount < 0) throw { status: 400, message: "Giảm giá không được âm" };
  if (type === "PERCENT") {
    if (amount > 100)
      throw {
        status: 400,
        message: "Giảm giá phần trăm không được vượt quá 100%",
      };
    return Math.min(base, (base * amount) / 100);
  }
  if (type === "FIXED") return Math.min(base, amount);
  return 0;
};
// Lấy danh sách đơn hàng với phân trang và filter theo trạng thái, khách hàng
const getAll = async ({
  page = 1,
  limit = 20,
  status = "",
  customerId = "",
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {
    ...(status && { status }),
    ...(customerId && { customerId }),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: Number(limit),
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        createdBy: { select: { id: true, fullName: true } },
        payments: true,
        returns: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
};
// Ghi log audit cho các hành động liên quan đến đơn hàng: tạo mới, cập nhật trạng thái, hoàn trả, ... để có thể theo dõi lịch sử hoạt động và hỗ trợ điều tra khi cần thiết. Log sẽ bao gồm thông tin người thực hiện, hành động, entity liên quan, trạng thái trước và sau (nếu có), cùng metadata bổ sung như IP hoặc ghi chú.
const getById = async (id) => {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { id: true, fullName: true } },
      payments: {
        include: { createdBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "desc" },
      },
      returns: { include: { items: true }, orderBy: { createdAt: "desc" } },
      items: { include: { product: true } },
    },
  });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
  return order;
};
// Tạo đơn hàng mới với logic phức tạp: kiểm tra tồn kho, tính toán giá trị đơn hàng sau khi áp dụng giảm giá, xử lý thanh toán (có thể tạo nhiều payment cho một đơn), cập nhật tồn kho nếu đơn được hoàn thành ngay, và ghi log audit chi tiết. Nếu có lỗi trong quá trình tạo đơn (ví dụ: sản phẩm không đủ tồn kho, thanh toán vượt quá tổng tiền), nghiệp vụ sẽ rollback và trả về lỗi rõ ràng.
const create = async (orderData, userId) => {
  const {
    customerId,
    items,
    paymentMethod = "CASH",
    paymentStatus,
    status = "PENDING",
    discount = 0,
    discountType = "NONE",
    discountValue = 0,
    note,
    payments = [],
    voucherCode,
    warehouseId,
    loyaltyPointsUsed = 0,
  } = orderData;

  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || !customer.isActive) {
      throw {
        status: 400,
        message: "Khách hàng không tồn tại hoặc đã bị vô hiệu hóa",
      };
    }
  }

  const whId = await resolveWarehouseId(warehouseId);
  let customerTier = "BRONZE";
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId } });
    customerTier = c?.tier || "BRONZE";
  }

  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    include: {
      inventories: { where: { warehouseId: whId } },
    },
  });
  products.forEach((p) => {
    p.inventory = p.inventories?.[0] || null;
  });
  if (products.length !== new Set(productIds).size) {
    throw {
      status: 400,
      message: "Một số sản phẩm không tồn tại hoặc đã ngừng kinh doanh",
    };
  }

  const quantitiesByProduct = items.reduce((acc, item) => {
    acc[item.productId] = (acc[item.productId] || 0) + item.quantity;
    return acc;
  }, {});

  for (const [productId, quantity] of Object.entries(quantitiesByProduct)) {
    const product = products.find((p) => p.id === productId);
    if (!product.inventory)
      throw {
        status: 400,
        message: `Sản phẩm "${product.name}" chưa có tồn kho`,
      };

    //1.kiểm tra tổn kho
    const available = product.inventory.quantity - product.inventory.reserved;
    if (available < quantity) {
      throw {
        status: 400,
        message: `Sản phẩm "${product.name}" không đủ số lượng có thể bán`,
      };
    }
  }

  const orderItems = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const gross = toNumber(product.price) * item.quantity;
    const itemDiscountType = item.discountType || "NONE";
    const itemDiscountValue = toNumber(item.discountValue);
    const discountAmount = calculateDiscount(
      gross,
      itemDiscountType,
      itemDiscountValue,
    );
    return {
      productId: item.productId,
      quantity: item.quantity,
      price: product.price,
      discountType: itemDiscountType,
      discountValue: itemDiscountValue,
      discountAmount,
      subtotal: gross - discountAmount,
    };
  });

  const subtotal = orderItems.reduce(
    (sum, item) => sum + toNumber(item.subtotal),
    0,
  );
  const requestedDiscount =
    discountType === "NONE" ? toNumber(discount) : toNumber(discountValue);
  const orderDiscount =
    discountType === "NONE"
      ? Math.min(subtotal, requestedDiscount)
      : calculateDiscount(subtotal, discountType, discountValue);

  const promoResolved = await promotionService.resolveForOrder({
    items: orderItems.map((oi) => ({
      productId: oi.productId,
      quantity: oi.quantity,
      discountAmount: oi.discountAmount,
    })),
    customerId,
    voucherCode,
  });
  const tierDiscount = loyaltyService.applyTierDiscount(subtotal, customerTier);
  const promotionDiscount = promoResolved.promotionDiscount + tierDiscount;
  let loyaltyDiscount = 0;
  const pointsToRedeem =
    customerId && loyaltyPointsUsed > 0 ? loyaltyPointsUsed : 0;
  if (pointsToRedeem > 0) {
    loyaltyDiscount = loyaltyService.redeemValueFromPoints(pointsToRedeem);
  }
  const total =
    subtotal - orderDiscount - promotionDiscount - loyaltyDiscount;
  if (total < 0) throw { status: 400, message: "Tổng đơn hàng không hợp lệ sau khuyến mãi" };
  const paymentTotal = payments.reduce((sum, p) => sum + toNumber(p.amount), 0);
  if (paymentTotal > total)
    throw { status: 400, message: "Tổng thanh toán vượt quá giá trị đơn hàng" };

  const finalPaymentStatus = payments.length
    ? paymentService.getPaymentStatus(total, paymentTotal)
    : paymentStatus || "UNPAID";
  const orderCode = await generateOrderCode();
  //2. toàn bộ DB trong 1 lần
  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        orderCode,
        customerId,
        createdById: userId,
        paymentMethod,
        paymentStatus: finalPaymentStatus,
        status,
        discount: orderDiscount,
        discountType,
        discountValue: toNumber(discountValue),
        promotionDiscount,
        voucherCode: promoResolved.voucherCode,
        loyaltyDiscount,
        loyaltyPointsUsed: pointsToRedeem,
        warehouseId: whId,
        subtotal,
        total,
        note,
        items: { create: orderItems },
        payments: {
          create: payments.map((payment) => ({
            amount: toNumber(payment.amount),
            method: payment.method,
            reference: payment.reference,
            note: payment.note,
            createdById: userId,
          })),
        },
      },
      include: { items: true, customer: true, payments: true },
    });

    if (pointsToRedeem > 0 && customerId) {
      await loyaltyService.redeemInTx(
        tx,
        customerId,
        pointsToRedeem,
        newOrder.id,
      );
    }

    if (status === "COMPLETED") {
      for (const item of items) {
        const inv = await findInventory(tx, item.productId, whId);
        const available = inv.quantity - (inv.reserved || 0);
        if (available < item.quantity) {
          const p = products.find((p) => p.id === item.productId);
          throw { status: 400, message: `Sản phẩm "${p?.name}" không đủ tồn kho` };
        }
        await tx.inventory.update({
          where: { id: inv.id },
          data: { quantity: { decrement: item.quantity } },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "EXPORT",
            quantity: item.quantity,
            note: `Bán hàng - đơn ${orderCode}`,
            createdById: userId,
          },
        });
      }
    } else if (status !== "CANCELLED") {
      for (const item of items) {
        const inv = await findInventory(tx, item.productId, whId);
        const available = inv.quantity - (inv.reserved || 0);
        if (available < item.quantity) {
          const p = products.find((p) => p.id === item.productId);
          throw { status: 400, message: `Sản phẩm "${p?.name}" không đủ tồn kho` };
        }
        await tx.inventory.update({
          where: { id: inv.id },
          data: { reserved: { increment: item.quantity } },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "RESERVATION",
            quantity: item.quantity,
            note: `Giữ hàng - đơn ${orderCode}`,
            createdById: userId,
          },
        });
      }
    }

    if (customerId && status === "COMPLETED") {
      await tx.customer.update({
        where: { id: customerId },
        data: { totalSpent: { increment: total } },
      });
      await loyaltyService.earnOnOrderCompleted(tx, {
        ...newOrder,
        customerId,
        total,
      });
    }

    if (promoResolved.applied.length || promoResolved.voucher) {
      await promotionService.recordUsagesInTx(tx, {
        orderId: newOrder.id,
        customerId,
        applied: promoResolved.applied,
        voucher: promoResolved.voucher,
      });
    }

    if (status === "COMPLETED" && ["UNPAID", "PARTIAL"].includes(finalPaymentStatus)) {
      await debtService.createReceivableForOrderInTx(tx, { order: newOrder, userId });
    }

    return newOrder;
  });

  // Auto-post bút toán SAU khi business transaction đã commit.
  // Nếu posting fail (CoA chưa seed, period closed, ...), nghiệp vụ vẫn an toàn,
  // nhưng lỗi được lưu vào outbox để admin retry.
  if (status === "COMPLETED") {
    try {
      const notif = require("../notifications/notification.service");
      for (const it of items) {
        await notif.checkAfterExport(it.productId);
      }
    } catch (_) {}
    const productMap = new Map(products.map((p) => [p.id, p]));
    const itemsForPost = items.map((it) => ({
      quantity: it.quantity,
      product: productMap.get(it.productId),
    }));
    const postingPayload = autopostService.buildOrderCompletedEntry({
      order: { ...order, paymentMethod, customerId },
      items: itemsForPost,
      paidAmount: paymentTotal,
      payments: order.payments,
      userId,
    });
    await postingErrorService.tryPostOrQueue(
      () =>
        autopostService.postOrderCompleted({
          order: { ...order, paymentMethod, customerId },
          items: itemsForPost,
          paidAmount: paymentTotal,
          payments: order.payments,
          userId,
        }),
      {
        source: "ORDER",
        sourceId: order.id,
        payload: postingPayload,
      },
    );
  }

  auditService
    .log({
      userId,
      action: "CREATE_ORDER",
      entity: "Order",
      entityId: order.id,
      before: null,
      after: {
        orderCode: order.orderCode,
        total: order.total,
        items: order.items,
      },
    })
    .catch((err) => console.error("Failed to write audit log for order:", err));

  return order;
};

const validTransitions = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SHIPPING", "CANCELLED"],
  SHIPPING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const updateStatus = async (id, status, userId = null) => {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: { include: { inventories: true } } } },
      delivery: true,
    },
  });
  if (!order)
    throw { status: 404, message: "Không tìm thấy đơn hàng để cập nhật" };
  if (!validTransitions[order.status]?.includes(status)) {
    throw {
      status: 400,
      message: `Không thể chuyển đơn từ ${order.status} sang ${status}`,
    };
  }

  const whId = order.warehouseId || (await getDefaultWarehouseId());

  if (status === "SHIPPING") {
    const delivery = await prisma.delivery.findUnique({ where: { orderId: id } });
    if (!delivery) {
      throw {
        status: 400,
        message: "Cần tạo thông tin giao hàng trước khi chuyển sang Đang giao",
      };
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (status === "CANCELLED") {
      await promotionService.rollbackOrderPromotions(tx, id);
      await loyaltyService.rollbackOnCancel(tx, order);
      for (const item of order.items) {
        const inv =
          item.product.inventories?.find((i) => i.warehouseId === whId) ||
          (await findInventory(tx, item.productId, whId));
        await tx.inventory.update({
          where: { id: inv.id },
          data: { reserved: { decrement: item.quantity } },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "RESERVATION_RELEASE",
            quantity: item.quantity,
            note: `Giải phóng giữ hàng - đơn ${order.orderCode}`,
            createdById: userId,
          },
        });
      }
    }

    if (order.status === "SHIPPING" && status === "COMPLETED") {
      for (const item of order.items) {
        const inv =
          item.product.inventories?.find((i) => i.warehouseId === whId) ||
          (await findInventory(tx, item.productId, whId));
        await tx.inventory.update({
          where: { id: inv.id },
          data: {
            quantity: { decrement: item.quantity },
            reserved: { decrement: item.quantity },
          },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "EXPORT",
            quantity: item.quantity,
            note: `Xuất bán - đơn ${order.orderCode}`,
            createdById: userId,
          },
        });
      }
      if (order.customerId) {
        await tx.customer.update({
          where: { id: order.customerId },
          data: { totalSpent: { increment: order.total } },
        });
        await loyaltyService.earnOnOrderCompleted(tx, order);
      }
    }

    const updatedOrder = await tx.order.update({ where: { id }, data: { status } });
    if (order.status === "SHIPPING" && status === "COMPLETED" && ["UNPAID", "PARTIAL"].includes(order.paymentStatus)) {
      await debtService.createReceivableForOrderInTx(tx, { order: updatedOrder, userId });
    }
    return updatedOrder;
  });

  if (order.status === "SHIPPING" && status === "COMPLETED") {
    try {
      const notif = require("../notifications/notification.service");
      for (const it of order.items) {
        await notif.checkAfterExport(it.productId);
      }
    } catch (_) {}
  }

  // Sau khi commit, nếu chuyển PENDING/CONFIRMED/SHIPPING → COMPLETED, autopost
  if (order.status === "SHIPPING" && status === "COMPLETED") {
    const paidAgg = await prisma.payment.aggregate({
      where: { orderId: id },
      _sum: { amount: true },
    });
    const payments = await prisma.payment.findMany({ where: { orderId: id } });
    const postingPayload = autopostService.buildOrderCompletedEntry({
      order,
      items: order.items.map((it) => ({
        quantity: it.quantity,
        product: it.product,
      })),
      paidAmount: Number(paidAgg._sum.amount || 0),
      payments,
      userId,
    });
    await postingErrorService.tryPostOrQueue(
      () =>
        autopostService.postOrderCompleted({
          order,
          items: order.items.map((it) => ({
            quantity: it.quantity,
            product: it.product,
          })),
          paidAmount: Number(paidAgg._sum.amount || 0),
          payments,
          userId,
        }),
      {
        source: "ORDER",
        sourceId: id,
        payload: postingPayload,
      },
    );
  }

  auditService
    .log({
      userId,
      action: "UPDATE_ORDER_STATUS",
      entity: "Order",
      entityId: id,
      before: { status: order.status },
      after: { status },
    })
    .catch(() => {});

  return updated;
};

module.exports = { getAll, getById, create, updateStatus };
