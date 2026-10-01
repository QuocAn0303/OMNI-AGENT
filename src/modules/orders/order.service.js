/**
 * modules/orders/order.service.js — Service quản lý đơn hàng
 * 
 * Tổng quan:
 * - Xử lý toàn bộ logic nghiệp vụ đơn hàng: tạo đơn, cập nhật trạng thái, tính giảm giá, kiểm tra tồn kho, thanh toán, loyalty, promotions, e-invoice, auto-posting bút toán kế toán
 * - Sử dụng Prisma transaction để đảm bảo toàn vẹn dữ liệu
 * 
 * Hàm:
 * - generateOrderCode(): Sinh mã đơn tự động ORD-YYYYMMDD-XXXX, tăng dần trong ngày
 * - calculateDiscount(base, type, value): Tính tiền giảm giá theo PERCENT hoặc FIXED, không vượt quá base
 * - getAll({page, limit, status, customerId}): Lấy danh sách đơn hàng phân trang, lọc theo trạng thái và khách hàng
 * - getById(id): Lấy chi tiết đơn hàng kèm customer, payments, returns, items, createdBy
 * - create(orderData, userId): Tạo đơn hàng — kiểm tra customer, kiểm tra tồn kho từng sản phẩm, tính subtotal/discount/promotion/loyalty, xử lý thanh toán, tạo items+payments trong transaction, nếu COMPLETED thì xuất kho ngay (còn không thì reserved), ghi audit log, auto-issue e-invoice + auto-post bút toán
 * - updateStatus(id, status, userId): Cập nhật trạng thái đơn — kiểm tra validTransitions, nếu CANCELLED thì rollback kho (reservation hoặc nhập lại tùy trạng thái cũ), nếu SHIPPING→COMPLETED thì xuất kho + tính loyalty + tạo debt receivable, auto-issue e-invoice + auto-post/reverse bút toán
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const paymentService = require("../payments/payment.service");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");
const journalService = require("../accounting/journal.service");
const debtService = require("../debt/debt.service");
const promotionService = require("../promotions/promotion.service");
const loyaltyService = require("../loyalty/loyalty.service");
const {
  getDefaultWarehouseId,
  resolveWarehouseId,
  findInventory,
} = require("../../utils/warehouse.helper");
const { recordFifoConsumption } = require('../inventory/valuation.service');
const logger = require('../../utils/logger');

const toNumber = (value) => Number(value || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const generateOrderCode = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await tx.order.count({
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
    // A9: round2 chống float (9999*10/100 = 999.9000000000001)
    return Math.min(base, round2((base * amount) / 100));
  }
  if (type === "FIXED") return Math.min(base, amount);
  return 0;
};
// Lấy danh sách đơn hàng với phân trang và filter theo trạng thái, khách hàng
const getAll = async ({
  page = 1,
  limit = 20,
  status = "",
  paymentStatus = "",
  customerId = "",
  fromDate = "",
  toDate = "",
}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {
    ...(status && { status }),
    ...(paymentStatus && { paymentStatus }),
    ...(customerId && { customerId }),
    ...(fromDate || toDate ? {
      createdAt: {
        ...(fromDate && { gte: new Date(fromDate) }),
        ...(toDate && { lte: new Date(toDate) }),
      },
    } : {}),
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
        delivery: { include: { events: { orderBy: { occurredAt: "desc" } } } },
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
const create = async (orderData, userId, options = {}) => {
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
    // F&B fields
    orderType = "DINE_IN",
    tableId,
    tableSessionId,
    seatNumber,
    serviceChargePercent = 0,
    tipAmount = 0,
    channel = "POS",
    channelOrderId,
    // CRM audit H9: deal có thể ghi USD/EUR… Nếu không truyền xuống, `Order.currency`
    // luôn = "VND" mặc định schema ⇒ deal 500 USD sinh đơn ghi 500 VND (sai sổ sách).
    currency = "VND",
  } = orderData;

  let customer = null;
  if (customerId) {
    customer = await prisma.customer.findUnique({
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
  if (customer) {
    customerTier = customer.tier || "BRONZE";
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

  // F&B: fetch modifier options để tính priceAdjust
  const allModifierOptionIds = items.flatMap((it) => (it.modifiers || []).map((m) => m.modifierOptionId));
  const modifierOptionsMap = {};
  if (allModifierOptionIds.length > 0) {
    const opts = await prisma.modifierOption.findMany({
      where: { id: { in: allModifierOptionIds }, isActive: true },
    });
    for (const o of opts) modifierOptionsMap[o.id] = o;
  }

  const orderItems = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    // F&B: tính phụ thu modifier (priceAdjust × quantity)
    const itemModifiers = (item.modifiers || []).map((m) => {
      const opt = modifierOptionsMap[m.modifierOptionId];
      if (!opt) return null;
      return {
        modifierOptionId: m.modifierOptionId,
        quantity: m.quantity || 1,
        priceAdjust: toNumber(opt.priceAdjust),
      };
    }).filter(Boolean);
    const modifierAdjustTotal = itemModifiers.reduce(
      (sum, m) => sum + m.priceAdjust * m.quantity,
      0,
    );
    const unitPrice = toNumber(product.price) + modifierAdjustTotal;
    const gross = round2(unitPrice * item.quantity);
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
      price: unitPrice,
      discountType: itemDiscountType,
      discountValue: itemDiscountValue,
      discountAmount,
      subtotal: round2(gross - discountAmount),
      courseId: item.courseId || 1,
      modifiers: itemModifiers,
    };
  });

  const subtotal = round2(
    orderItems.reduce((sum, item) => sum + toNumber(item.subtotal), 0),
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
  // F&B: phí dịch vụ (service charge) tính trên subtotal + tip — cộng vào tổng tiền
  const serviceCharge = Math.round(
    (subtotal * toNumber(serviceChargePercent)) / 100,
  );
  const total = round2(
    subtotal -
      orderDiscount -
      promotionDiscount -
      loyaltyDiscount +
      serviceCharge +
      toNumber(tipAmount),
  );
  if (total < 0) throw { status: 400, message: "Tổng đơn hàng không hợp lệ sau khuyến mãi" };
  const paymentTotal = round2(payments.reduce((sum, p) => sum + toNumber(p.amount), 0));
  // A9: so sánh sau khi round2 — trước đây 8999.10 > 8999.099999999999 (đúng tiền)
  // vẫn bị từ chối vì lỗi float
  if (round2(paymentTotal - total) > 0.001)
    throw { status: 400, message: "Tổng thanh toán vượt quá giá trị đơn hàng" };

  const finalPaymentStatus = payments.length
    ? paymentService.getPaymentStatus(total, paymentTotal)
    : paymentStatus || "UNPAID";

  // Customer credit limit check (P2-C7) — MANAGER/ADMIN có thể override
  if (customerId && finalPaymentStatus !== "PAID" && !options.overrideCreditLimit) {
    const customerCredit = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { totalDebt: true, creditLimit: true },
    });
    if (customerCredit && Number(customerCredit.creditLimit) > 0) {
      const newTotalDebt = Number(customerCredit.totalDebt) + Number(total);
      if (newTotalDebt > Number(customerCredit.creditLimit)) {
        throw {
          status: 400,
          message: `Khách hàng đã vượt hạn mức tín dụng (${Number(customerCredit.creditLimit).toLocaleString()} VND). Vui lòng thu hồi công nợ trước khi tạo đơn mới.`,
          details: { overrideAllowed: true, currentDebt: Number(customerCredit.totalDebt), creditLimit: Number(customerCredit.creditLimit), newTotal: newTotalDebt },
        };
      }
    }
  } else if (customerId && finalPaymentStatus !== "PAID" && options.overrideCreditLimit && !['MANAGER', 'ADMIN'].includes(options.userRole)) {
    throw { status: 403, message: 'Chỉ MANAGER/ADMIN mới có thể override hạn mức tín dụng' };
  }

  // A8: mã sinh TRONG transaction + retry khi unique violation (chống 2 POS đặt
  // cùng lúc trùng mã → 500). Trước đây sinh ngoài tx, race → P2002 crash.
  if (options.overrideCreditLimit && customerId) {
    logger.warn(`[order] credit limit override by userId=${userId}, customerId=${customerId}`);
  }

  // CRM audit H9: ngoài VND thì `subotal`/`total` vẫn là SỐ NGUYÊN của deal, chưa
  // quy đổi — `exchangeRate` để mặc định 1. Ghi log rõ để không ai đọc sổ sách tưởng
  // đã quy đổi. Quy đổi thật thuộc module `currency` (bảng tỷ giá), không tự bịa ở đây.
  if (currency && currency !== "VND") {
    logger.warn(
      `[order] currency=${currency} nhưng chưa quy đổi (exchangeRate=1) — tổng tiền ghi nguyên giá trị deal.`,
    );
  }

  //2. toàn bộ DB trong 1 lần
  const txResult = await journalService.withUniqueRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const orderCode = await generateOrderCode(tx);
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
        currency,
        subtotal,
        total,
        note,
        orderType,
        tableId: tableId || null,
        tableSessionId: tableSessionId || null,
        seatNumber: seatNumber || null,
        serviceChargePercent: toNumber(serviceChargePercent),
        tipAmount: toNumber(tipAmount),
        channel,
        channelOrderId: channelOrderId || null,
        items: {
          create: orderItems.map(({ modifiers, ...oi }) => ({
            ...oi,
            modifiers: modifiers && modifiers.length > 0 ? { create: modifiers } : undefined,
          })),
        },
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

    let fifoTotalCost = 0;
    if (status === "COMPLETED") {
      for (const item of items) {
        const inv = await findInventory(tx, item.productId, whId);
        const p = products.find((p) => p.id === item.productId);
        if (!inv) throw { status: 400, message: `Sản phẩm "${p?.name}" chưa có tồn kho` };
        const available = inv.quantity - (inv.reserved || 0);
        if (available < item.quantity) {
          throw { status: 400, message: `Sản phẩm "${p?.name}" không đủ tồn kho` };
        }
        // A7: atomic — điều kiện gte kiểm tra lại tại thời điểm ghi (chống race âm kho)
        const res = await tx.inventory.updateMany({
          where: { id: inv.id, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } },
        });
        if (res.count === 0) {
          throw { status: 400, message: `Sản phẩm "${p?.name}" không đủ tồn kho` };
        }
        const { totalCost } = await recordFifoConsumption(tx, item.productId, whId, item.quantity, {
          note: `Bán hàng - đơn ${orderCode}`,
          orderId: newOrder.id,
        });
        fifoTotalCost += Number(totalCost || 0);
        const avgUnitCost = totalCost > 0 ? Math.round((totalCost / item.quantity + Number.EPSILON) * 100) / 100 : null;
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "EXPORT",
            quantity: item.quantity,
            unitCost: avgUnitCost,
            note: `Bán hàng - đơn ${orderCode}`,
            createdById: userId,
          },
        });
      }
    } else if (status !== "CANCELLED") {
      for (const item of items) {
        const inv = await findInventory(tx, item.productId, whId);
        const p = products.find((p) => p.id === item.productId);
        if (!inv) throw { status: 400, message: `Sản phẩm "${p?.name}" chưa có tồn kho` };
        const available = inv.quantity - (inv.reserved || 0);
        if (available < item.quantity) {
          throw { status: 400, message: `Sản phẩm "${p?.name}" không đủ tồn kho` };
        }
        // A7: atomic — điều kiện gte khóa tại thời điểm ghi, chống 2 đơn giữ hàng cùng lúc
        const res = await tx.inventory.updateMany({
          where: { id: inv.id, quantity: { gte: item.quantity + (inv.reserved || 0) } },
          data: { reserved: { increment: item.quantity } },
        });
        if (res.count === 0) {
          throw { status: 400, message: `Sản phẩm "${p?.name}" không đủ tồn kho` };
        }
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
      for (const p of promoResolved.applied) {
        const promo = await tx.promotion.findUnique({ where: { id: p.id }, select: { usageLimit: true, _count: { select: { usages: true } } } });
        if (promo.usageLimit && promo._count.usages >= promo.usageLimit) {
          throw { status: 400, message: `Khuyến mãi "${p.name}" đã hết lượt sử dụng` };
        }
      }
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

    if (status === "COMPLETED") {
      for (const item of items) {
        const prod = products.find((p) => p.id === item.productId);
        if (prod?.trackBySerial) {
          const serialIds = item.serials || [];
          if (serialIds.length) {
            await tx.serialNumber.updateMany({
              where: { id: { in: serialIds }, status: "IN_STOCK" },
              data: { status: "SOLD", orderId: newOrder.id },
            });
          } else {
            const available = await tx.serialNumber.findMany({
              where: { productId: item.productId, warehouseId: whId, status: "IN_STOCK" },
              take: item.quantity,
              select: { id: true },
            });
            if (available.length) {
              await tx.serialNumber.updateMany({
                where: { id: { in: available.map((s) => s.id) } },
                data: { status: "SOLD", orderId: newOrder.id },
              });
            }
          }
        }
      }
    }

    return { newOrder, fifoTotalCost };
      }),
    5,
  );

  const order = txResult.newOrder;
  const fifoTotalCost = Number(txResult.fifoTotalCost || 0);

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
    // F&B Phase 8: auto-trừ nguyên liệu theo recipe (non-blocking)
    try {
      const recipeService = require("../recipe/recipe.service");
      await recipeService.deductOnOrderComplete(order.id);
    } catch (_) {}
    // F&B Phase 4: sinh KDS ticket (non-blocking)
    try {
      const kdsService = require("../kds/kds.service");
      await kdsService.generateTicketsForOrder(order.id);
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
      fifoTotalCost,
    });
    await postingErrorService.tryPostOrQueue(
      () =>
        autopostService.postOrderCompleted({
          order: { ...order, paymentMethod, customerId },
          items: itemsForPost,
          paidAmount: paymentTotal,
          payments: order.payments,
          userId,
          fifoTotalCost,
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
      after: { orderCode: order.orderCode, total: order.total, items: order.items },
    })
    .catch((err) => logger.error("Failed to write audit log for order:", err));

  // Auto-issue e-invoice + invoice PDF khi tạo đơn trực tiếp COMPLETED (POS)
  if (status === "COMPLETED") {
    const einvoiceService = require("../einvoice/einvoice.service");
    einvoiceService.autoIssueForOrder(order.id, userId).catch(() => {});
    const invoiceService = require("./invoice.service");
    invoiceService.generateInvoice(order.id, {}, userId).catch(() => {});

    // CRM (Mục 3.2, 4.3 đặc tả CRM/SRM): RFM động + đóng vòng churn win-back
    if (order.customerId) {
      require("../customers/rfm.service").onOrderCompletedForCustomer(order.customerId);
      require("../customers/churn-automation.service").checkRetainedForOrder(order);
    }
  }

  try {
    const webhookSvc = require('../integrations/webhook.service');
    const { getTenantId } = require('../../config/tenantContext');
    const tid = getTenantId();
    if (tid) webhookSvc.emitEvent('order.created', { event: 'order.created', data: { id: order.id, code: order.orderCode, total: Number(order.total), status: order.status } }, tid);
  } catch (_) {}

  return order;
};

const validTransitions = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SHIPPING", "CANCELLED"],
  SHIPPING: ["COMPLETED", "CANCELLED"],
  // COMPLETED → CANCELLED chỉ dành cho khôi phục sai sót (vd order tạo nhầm).
  // Khi hủy đơn đã COMPLETED: tự reverse bút toán + nhập lại kho + rollback loyalty/promo + đóng debt.
  COMPLETED: ["CANCELLED"],
  CANCELLED: [],
};

const updateStatusInTx = async (tx, id, status, userId = null) => {
  const order = await tx.order.findUnique({
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

      // Tùy trạng thái cũ mà xử lý kho khác nhau:
      //   PENDING/CONFIRMED/SHIPPING: giải phóng RESERVATION
      //   COMPLETED: nhập lại kho (đã EXPORT) — đây là khôi phục đơn lỡ tay
      const wasCompleted = order.status === "COMPLETED";
      for (const item of order.items) {
        const inv =
          item.product.inventories?.find((i) => i.warehouseId === whId) ||
          (await findInventory(tx, item.productId, whId));
        if (wasCompleted) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { increment: item.quantity } },
          });
          await tx.inventoryTransaction.create({
            data: {
              inventoryId: inv.id,
              type: "RETURN",
              quantity: item.quantity,
              note: `Hủy đơn đã hoàn thành - nhập lại kho ${order.orderCode}`,
              createdById: userId,
            },
          });
          const consumedLots = await tx.lotTransaction.findMany({
            where: { orderId: id, type: 'CONSUME' },
          });
          for (const cl of consumedLots) {
            await tx.inventoryLot.update({
              where: { id: cl.lotId },
              data: { quantity: { increment: cl.quantity } },
            });
            await tx.lotTransaction.create({
              data: {
                lotId: cl.lotId,
                type: 'RETURN',
                quantity: cl.quantity,
                orderId: id,
                note: `Hoàn nhập lot - hủy đơn ${order.orderCode}`,
              },
            });
          }
        } else {
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

      // Nếu trước đó COMPLETED và đã có totalSpent/debt thì rollback
      if (wasCompleted) {
        if (order.customerId) {
          await tx.customer.update({
            where: { id: order.customerId },
            data: { totalSpent: { decrement: order.total } },
          });
        }
        // Đóng debt phải thu (nếu có) — chuyển sang CLOSED + note đính kèm
        await tx.debt.updateMany({
          where: { orderId: id, type: "RECEIVABLE", status: { not: "CLOSED" } },
          data: { status: "CLOSED" },
        });
      }
    }

    let statusFifoTotalCost = 0;
    if (order.status === "SHIPPING" && status === "COMPLETED") {
      for (const item of order.items) {
        const inv =
          item.product.inventories?.find((i) => i.warehouseId === whId) ||
          (await findInventory(tx, item.productId, whId));
        // A7: atomic — kiểm tra + trừ trong 1 statement, chống race âm kho
        const res = await tx.inventory.updateMany({
          where: { id: inv.id, quantity: { gte: item.quantity }, reserved: { gte: item.quantity } },
          data: {
            quantity: { decrement: item.quantity },
            reserved: { decrement: item.quantity },
          },
        });
        if (res.count === 0) {
          throw { status: 400, message: `Sản phẩm "${item.product?.name || ""}" không đủ tồn kho` };
        }
        const { totalCost } = await recordFifoConsumption(tx, item.productId, whId, item.quantity, {
          note: `Xuất bán - đơn ${order.orderCode}`,
          orderId: id,
        });
        statusFifoTotalCost += Number(totalCost || 0);
        const avgUnitCost = totalCost > 0 ? Math.round((totalCost / item.quantity + Number.EPSILON) * 100) / 100 : null;
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inv.id,
            type: "EXPORT",
            quantity: item.quantity,
            unitCost: avgUnitCost,
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
    return { updatedOrder, statusFifoTotalCost };
  });

  const statusFifoTotalCost = Number(updated.statusFifoTotalCost || 0);

  if (order.status === "SHIPPING" && status === "COMPLETED") {
    try {
      const notif = require("../notifications/notification.service");
      for (const it of order.items) {
        await notif.checkAfterExport(it.productId);
      }
    } catch (_) {}
  }

  // Hủy đơn đã COMPLETED: đảo bút toán đã ghi
  if (order.status === "COMPLETED" && status === "CANCELLED") {
    try {
      const orig = await prisma.journalEntry.findFirst({
        where: {
          source: "ORDER",
          sourceId: id,
          operation: "PRIMARY",
          status: "POSTED",
        },
        select: { id: true },
      });
      if (orig) {
        await journalService.reverseEntry(orig.id, userId);
      }
    } catch (err) {
      // Không re-throw — nghiệp vụ đã commit. Lưu vào outbox để admin retry.
      await postingErrorService
        .recordError({
          source: "ORDER",
          sourceId: id,
          payload: { operation: "REVERSE_ORDER", reason: "COMPLETED_TO_CANCELLED" },
          error: err,
        })
        .catch(() => {});
    }
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
      fifoTotalCost: statusFifoTotalCost,
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
          fifoTotalCost: statusFifoTotalCost,
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

  // Auto-issue e-invoice + invoice PDF + auto-reorder khi SHIPPING → COMPLETED
  if (order.status === "SHIPPING" && status === "COMPLETED") {
    const einvoiceService = require("../einvoice/einvoice.service");
    einvoiceService.autoIssueForOrder(id, userId).catch(() => {});
    const invoiceService = require("./invoice.service");
    invoiceService.generateInvoice(id, {}, userId).catch(() => {});

    // Auto-reorder: kiem tra tồn kho thap sau khi xuat hang
    const automation = require("../automation/automation.service");
const logger = require('../../utils/logger');
    automation.onOrderCompleted(updated, userId);

    // CRM (Mục 3.2, 4.3 đặc tả CRM/SRM): RFM động + đóng vòng churn win-back
    if (updated.customerId) {
      require("../customers/rfm.service").onOrderCompletedForCustomer(updated.customerId);
      require("../customers/churn-automation.service").checkRetainedForOrder(updated);
    }
  }

  return updated;
};

const updateStatus = async (id, status, userId = null) => {
  return prisma.$transaction(async (tx) => {
    return updateStatusInTx(tx, id, status, userId);
  });
};

module.exports = { getAll, getById, create, updateStatus, updateStatusInTx };
