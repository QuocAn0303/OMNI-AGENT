const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const paymentService = require("../payments/payment.service");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");
const expenseAuto = require("../accounting/expense-auto.service");
const { withCodeRetry } = require("../accounting/journal.service");

const RETURN_POLICY_DAYS = 7;
const FOUR_EYES_THRESHOLD = 5_000_000;
const toNumber = (value) => Number(value || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const generateReturnCode = async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await prisma.orderReturn.count({ where: { createdAt: { gte: start } } });
  return `RET-${today}-${String(count + 1).padStart(4, "0")}`;
};

const getReturnedQuantity = async (orderItemId, tx = prisma) => {
  const result = await tx.orderReturnItem.aggregate({
    where: {
      orderItemId,
      return: { status: { in: ["APPROVED", "COMPLETED", "PENDING"] } },
    },
    _sum: { quantity: true },
  });
  return Number(result._sum.quantity || 0);
};

const calcUnitRefund = (orderItem, order) => {
  const lineTotal = toNumber(orderItem.subtotal);
  const orderSub = toNumber(order.subtotal);
  if (orderSub <= 0) return 0;
  const ratio = toNumber(order.total) / orderSub;
  return round2((lineTotal / orderItem.quantity) * ratio);
};

const assertPolicyWindow = (order, overridePolicy, userRole) => {
  const completedAt = order.updatedAt || order.createdAt;
  const days = (Date.now() - new Date(completedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days <= RETURN_POLICY_DAYS) return;
  if (overridePolicy && ["ADMIN", "MANAGER"].includes(userRole)) return;
  throw {
    status: 400,
    message: `Quá hạn trả hàng (${RETURN_POLICY_DAYS} ngày). Cần quyền quản lý để ghi đè.`,
  };
};

const getReturnableItems = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: { select: { id: true, name: true, sku: true } } } } },
  });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
  if (order.status !== "COMPLETED") {
    throw { status: 400, message: "Chỉ trả hàng cho đơn đã hoàn thành" };
  }

  const items = [];
  for (const oi of order.items) {
    const returned = await getReturnedQuantity(oi.id);
    const returnable = oi.quantity - returned;
    items.push({
      orderItemId: oi.id,
      product: oi.product,
      ordered: oi.quantity,
      returned,
      returnable: Math.max(0, returnable),
      unitRefund: calcUnitRefund(oi, order),
    });
  }
  return { orderId, orderCode: order.orderCode, items };
};

const create = async (data, userId, { overridePolicy = false, userRole } = {}) => {
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    include: { items: true },
  });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
  if (order.status !== "COMPLETED") {
    throw { status: 400, message: "Chỉ có thể trả hàng cho đơn đã hoàn thành" };
  }
  assertPolicyWindow(order, overridePolicy, userRole);

  const returnItems = [];
  for (const item of data.items) {
    const orderItem = order.items.find((it) => it.id === item.orderItemId);
    if (!orderItem) throw { status: 400, message: "Sản phẩm trả hàng không thuộc đơn gốc" };
    const returned = await getReturnedQuantity(item.orderItemId);
    if (item.quantity > orderItem.quantity - returned) {
      throw { status: 400, message: "Số lượng trả vượt quá số lượng còn được trả" };
    }
    const unitRefund = calcUnitRefund(orderItem, order);
    returnItems.push({
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      refundAmount: round2(unitRefund * item.quantity),
    });
  }

  const refundAmount = round2(returnItems.reduce((sum, item) => sum + item.refundAmount, 0));

  return withCodeRetry(
    generateReturnCode,
    (returnCode) =>
      prisma.orderReturn.create({
        data: {
          returnCode,
          orderId: data.orderId,
          reason: data.reason,
          restockable: data.restockable !== false,
          refundMethod: data.refundMethod,
          refundAmount,
          note: data.note,
          createdById: userId,
          items: { create: returnItems },
          ...(data.exchangeItems?.length && {
            exchangeItems: {
              create: data.exchangeItems.map((ex) => ({
                productId: ex.productId,
                quantity: ex.quantity,
                unitPrice: ex.unitPrice,
                subtotal: round2(ex.quantity * ex.unitPrice),
              })),
            },
          }),
        },
        include: {
          items: { include: { orderItem: { include: { product: true } } } },
          exchangeItems: { include: { product: true } },
          order: true,
        },
      }),
  );
};

const approve = async (returnId, userId, userRole) => {
  const ret = await prisma.orderReturn.findUnique({
    where: { id: returnId },
    include: { order: true },
  });
  if (!ret) throw { status: 404, message: "Không tìm thấy phiếu trả hàng" };
  if (ret.status !== "PENDING") throw { status: 400, message: "Phiếu trả hàng đã được xử lý" };

  if (toNumber(ret.refundAmount) > FOUR_EYES_THRESHOLD && ret.createdById === userId) {
    throw { status: 403, message: "Hoàn tiền > 5tr cần người duyệt khác người tạo" };
  }

  const updated = await prisma.orderReturn.update({
    where: { id: returnId },
    data: { status: "APPROVED", approvedById: userId },
    include: { items: true, order: true, exchangeItems: true },
  });

  auditService.log({
    userId,
    action: "APPROVE_RETURN",
    entity: "OrderReturn",
    entityId: returnId,
    after: { returnCode: ret.returnCode, status: "APPROVED" },
  }).catch(() => {});

  return updated;
};

const complete = async (returnId, userId) => {
  const result = await prisma.$transaction(async (tx) => {
    const ret = await tx.orderReturn.findUnique({
      where: { id: returnId },
      include: {
        order: { include: { customer: true, debt: true } },
        items: { include: { orderItem: { include: { product: { include: { inventories: true } } } } } },
        exchangeItems: { include: { product: true } },
      },
    });
    if (!ret) throw { status: 404, message: "Không tìm thấy phiếu trả hàng" };
    if (ret.status !== "APPROVED") {
      throw { status: 400, message: "Chỉ hoàn tất phiếu đã duyệt (APPROVED)" };
    }

    const claimed = await tx.orderReturn.updateMany({
      where: { id: returnId, status: "APPROVED" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw { status: 409, message: "Phiếu trả đã được xử lý bởi tiến trình khác" };
    }

    if (ret.restockable) {
      for (const item of ret.items) {
        const inventory = item.orderItem.product.inventories?.[0];
        if (!inventory) continue;
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { increment: item.quantity } },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: inventory.id,
            type: "RETURN",
            quantity: item.quantity,
            note: `Trả hàng - ${ret.returnCode}`,
            createdById: userId,
          },
        });
      }
    }

    const refund = toNumber(ret.refundAmount);

    if (ret.refundMethod === "STORE_CREDIT" && ret.order.customerId) {
      await tx.customer.update({
        where: { id: ret.order.customerId },
        data: { storeCredit: { increment: refund } },
      });
    }

    if (ret.refundMethod === "EXCHANGE" && ret.exchangeItems.length) {
      const exchangeTotal = ret.exchangeItems.reduce((s, e) => s + toNumber(e.subtotal), 0);
      const diff = round2(exchangeTotal - refund);
      if (diff > 0 && ret.order.customerId) {
        await debtServiceReduceOrCreate(tx, ret.order, diff, userId);
      }
    }

    if (ret.order.customerId && ["CASH", "BANK_TRANSFER", "STORE_CREDIT"].includes(ret.refundMethod)) {
      await tx.customer.update({
        where: { id: ret.order.customerId },
        data: { totalSpent: { decrement: refund } },
      });
    }

    if (ret.order.debt && ret.order.debt.type === "RECEIVABLE") {
      const debt = ret.order.debt;
      const reduceBy = Math.min(refund, round2(toNumber(debt.amount) - toNumber(debt.paidAmount)));
      if (reduceBy > 0) {
        const newAmount = round2(toNumber(debt.amount) - reduceBy);
        const newPaid = toNumber(debt.paidAmount);
        const newStatus = newAmount <= newPaid ? "CLOSED" : debt.status;
        await tx.debt.update({
          where: { id: debt.id },
          data: { amount: newAmount, status: newStatus },
        });
        if (ret.order.customerId) {
          await tx.customer.update({
            where: { id: ret.order.customerId },
            data: { totalDebt: { decrement: reduceBy } },
          });
        }
      }
    }

    if (["CASH", "BANK_TRANSFER"].includes(ret.refundMethod)) {
      const paidAfterRefund = Math.max(
        0,
        await paymentService.getPaidAmount(ret.orderId, tx) - refund,
      );
      await tx.order.update({
        where: { id: ret.orderId },
        data: {
          paymentStatus: paymentService.getPaymentStatus(toNumber(ret.order.total), paidAfterRefund),
        },
      });
    }

    return tx.orderReturn.findUnique({
      where: { id: returnId },
      include: {
        items: { include: { orderItem: { include: { product: true } } } },
        exchangeItems: true,
        order: true,
      },
    });
  });

  if (["CASH", "BANK_TRANSFER"].includes(result.refundMethod)) {
    await expenseAuto.fromReturnRefund({ orderReturn: result, userId }).catch(() => {});
  }

  const postingPayload = autopostService.buildOrderReturnEntry({
    orderReturn: result,
    order: result.order,
    items: result.items.map((it) => ({
      quantity: it.quantity,
      product: it.orderItem.product,
    })),
    userId,
  });
  await postingErrorService.tryPostOrQueue(
    () =>
      autopostService.postOrderReturn({
        orderReturn: result,
        order: result.order,
        items: result.items.map((it) => ({
          quantity: it.quantity,
          product: it.orderItem.product,
        })),
        userId,
      }),
    { source: "RETURN", sourceId: result.id, payload: postingPayload },
  );

  auditService.log({
    userId,
    action: "COMPLETE_RETURN",
    entity: "OrderReturn",
    entityId: returnId,
    after: { returnCode: result.returnCode, refundAmount: result.refundAmount },
  }).catch(() => {});

  return result;
};

const debtServiceReduceOrCreate = async (tx, order, amount, userId) => {
  if (order.debt) {
    await tx.debt.update({
      where: { id: order.debt.id },
      data: { amount: { increment: amount } },
    });
    if (order.customerId) {
      await tx.customer.update({
        where: { id: order.customerId },
        data: { totalDebt: { increment: amount } },
      });
    }
  }
};

const reject = async (returnId, userId) => {
  return prisma.orderReturn.update({
    where: { id: returnId },
    data: { status: "REJECTED", approvedById: userId },
  });
};

const getAll = async ({ page = 1, limit = 20, status = "" }) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = { ...(status && { status }) };
  const [returns, total] = await Promise.all([
    prisma.orderReturn.findMany({
      where,
      skip,
      take: Number(limit),
      include: {
        order: { select: { id: true, orderCode: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.orderReturn.count({ where }),
  ]);
  return {
    returns,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const ret = await prisma.orderReturn.findUnique({
    where: { id },
    include: {
      order: true,
      createdBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
      items: { include: { orderItem: { include: { product: true } } } },
      exchangeItems: { include: { product: true } },
    },
  });
  if (!ret) throw { status: 404, message: "Không tìm thấy phiếu trả hàng" };
  return ret;
};

const getByOrderId = async (orderId) => {
  return prisma.orderReturn.findMany({
    where: { orderId },
    include: {
      items: { include: { orderItem: { include: { product: true } } } },
      exchangeItems: true,
    },
    orderBy: { createdAt: "desc" },
  });
};

module.exports = {
  generateReturnCode,
  getReturnableItems,
  create,
  approve,
  complete,
  reject,
  getAll,
  getById,
  getByOrderId,
  RETURN_POLICY_DAYS,
};
