const prisma = require("../../config/prisma");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");

const toNumber = (value) => Number(value || 0);

const getPaidAmount = async (orderId, tx = prisma) => {
  const result = await tx.payment.aggregate({
    where: { orderId },
    _sum: { amount: true },
  });
  return toNumber(result._sum.amount);
};

const getPaymentStatus = (total, paid) => {
  if (paid <= 0) return "UNPAID";
  if (paid >= total) return "PAID";
  return "PARTIAL";
};

const recordPayment = async (data, userId) => {
  const { orderId, amount, method, reference, note } = data;
  const paymentAmount = toNumber(amount);
  if (paymentAmount <= 0) {
    throw { status: 400, message: "Số tiền thanh toán phải lớn hơn 0" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
    if (order.status === "CANCELLED") {
      throw { status: 400, message: "Không thể ghi nhận thanh toán cho đơn đã hủy" };
    }

    const total = toNumber(order.total);
    const paid = await getPaidAmount(orderId, tx);
    if (paid + paymentAmount > total) {
      throw { status: 400, message: "Số tiền thanh toán vượt quá giá trị còn lại của đơn" };
    }

    const payment = await tx.payment.create({
      data: {
        orderId,
        amount: paymentAmount,
        method,
        reference,
        note,
        createdById: userId,
      },
    });

    const nextPaid = paid + paymentAmount;
    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentMethod: method,
        paymentStatus: getPaymentStatus(total, nextPaid),
      },
    });

    const debtSvc = require("../debt/debt.service");
    await debtSvc.applyOrderPaymentToDebtInTx(tx, {
      orderId,
      paymentAmount,
      method,
      userId,
      note,
    });

    return { payment, order };
  });

  // Auto-post bút toán SAU khi tx commit; failure → outbox
  if (result.order.status === "COMPLETED") {
    const postingPayload = autopostService.buildPaymentEntry({
      payment: result.payment,
      order: result.order,
      userId,
    });
    await postingErrorService.tryPostOrQueue(
      () => autopostService.postPayment({ payment: result.payment, order: result.order, userId }),
      {
        source: "PAYMENT",
        sourceId: result.payment.id,
        payload: postingPayload,
      },
    );
  }

  return result.payment;
};

const getByOrderId = async (orderId) => {
  return prisma.payment.findMany({
    where: { orderId },
    include: { createdBy: { select: { id: true, fullName: true, role: true } } },
    orderBy: { createdAt: "desc" },
  });
};

const getOrderBalance = async (orderId) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw { status: 404, message: "Không tìm thấy đơn hàng" };
  const paid = await getPaidAmount(orderId);
  const total = toNumber(order.total);
  return { total, paid, remaining: Math.max(0, total - paid) };
};

module.exports = {
  getPaidAmount,
  getPaymentStatus,
  recordPayment,
  getByOrderId,
  getOrderBalance,
};
