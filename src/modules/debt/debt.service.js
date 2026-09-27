/**
 * modules/debt/debt.service.js — Service quản lý công nợ (Debt)
 *
 * Tổng quan:
 * - Quản lý 2 loại công nợ: RECEIVABLE (phải thu từ khách) và PAYABLE (phải trả nhà cung cấp)
 * - Tự động tạo công nợ khi tạo đơn hàng/PO chưa thanh toán hết
 * - Ghi nhận thanh toán công nợ, tự động cập nhật trạng thái (OPEN/PARTIAL/OVERDUE/CLOSED)
 * - Tích hợp audit log, accounting auto-post, expense tracking
 * - Cung cấp cron job đánh dấu quá hạn và tổng hợp số liệu
 *
 * Hàm:
 * - statusFromAmounts(amount, paidAmount, dueDate): Xác định trạng thái công nợ (CLOSED/PARTIAL/OVERDUE/OPEN) dựa trên số tiền, đã trả, hạn
 * - createReceivableForOrderInTx(tx, { order, userId }): Tạo công nợ phải thu cho đơn hàng trong transaction, cập nhật totalDebt của customer, ghi audit log
 * - createPayableForPoInTx(tx, { po, userId }): Tạo công nợ phải trả cho PO trong transaction, cập nhật totalDebt của vendor, ghi audit log
 * - applyOrderPaymentToDebtInTx(tx, { orderId, paymentAmount, method, userId, note }): Ghi nhận thanh toán vào công nợ đơn hàng, tạo DebtPayment, cập nhật paidAmount/status, giảm totalDebt customer
 * - list({ page, limit, type, status, customerId, vendorId, overdue }): Lấy danh sách công nợ có phân trang, lọc theo type/status/khách hàng/nhà cung cấp/quá hạn
 * - summary(): Tính tổng dư nợ phải thu/phải trả đang mở và quá hạn
 * - listByCustomer(customerId): Lấy danh sách công nợ của 1 khách hàng kèm order và payments
 * - listByVendor(vendorId): Lấy danh sách công nợ của 1 nhà cung cấp kèm PO và payments
 * - recordDebtPayment(debtId, { amount, method, note }, userId): Ghi nhận thanh toán công nợ trong transaction — cập nhật debt, tạo payment cho đơn hàng (RECEIVABLE) hoặc cập nhật PO (PAYABLE), auto-post accounting
 * - markOverdueCron(): Cron job đánh dấu công nợ quá hạn (OPEN/PARTIAL → OVERDUE)
 */
const { randomUUID } = require("crypto");
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const autopostService = require("../accounting/autopost.service");
const postingErrorService = require("../accounting/posting-error.service");
const paymentService = require("../payments/payment.service");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const statusFromAmounts = (amount, paidAmount, dueDate) => {
  const rem = round2(toNum(amount) - toNum(paidAmount));
  if (rem <= 0) return "CLOSED";
  if (toNum(paidAmount) > 0 && rem > 0) {
    if (dueDate && new Date(dueDate) < new Date()) return "OVERDUE";
    return "PARTIAL";
  }
  if (dueDate && new Date(dueDate) < new Date()) return "OVERDUE";
  return "OPEN";
};

const createReceivableForOrderInTx = async (tx, { order, userId }) => {
  if (!order.customerId) return null;
  if (!["UNPAID", "PARTIAL"].includes(order.paymentStatus)) return null;
  const paid = await paymentService.getPaidAmount(order.id, tx);
  const unpaid = round2(toNum(order.total) - paid);
  if (unpaid <= 0) return null;
  const exists = await tx.debt.findUnique({ where: { orderId: order.id } });
  if (exists) return exists;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const debt = await tx.debt.create({
    data: {
      id: randomUUID(),
      type: "RECEIVABLE",
      status: "OPEN",
      amount: unpaid,
      paidAmount: 0,
      dueDate,
      customerId: order.customerId,
      orderId: order.id,
      note: `Phải thu đơn ${order.orderCode}`,
    },
  });
  await tx.customer.update({
    where: { id: order.customerId },
    data: { totalDebt: { increment: unpaid } },
  });
  await auditService
    .log({
      userId,
      action: "DEBT_CREATED_RECEIVABLE",
      entity: "Debt",
      entityId: debt.id,
      before: null,
      after: { orderId: order.id, amount: unpaid },
    })
    .catch(() => {});
  return debt;
};

const createPayableForPoInTx = async (tx, { po, userId }) => {
  if (!["UNPAID", "PARTIAL"].includes(po.paymentStatus || "UNPAID")) return null;
  const unpaid = round2(toNum(po.total) - toNum(po.paidAmount));
  if (unpaid <= 0) return null;
  const exists = await tx.debt.findUnique({ where: { poId: po.id } });
  if (exists) return exists;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const debt = await tx.debt.create({
    data: {
      id: randomUUID(),
      type: "PAYABLE",
      status: "OPEN",
      amount: unpaid,
      paidAmount: 0,
      dueDate,
      vendorId: po.vendorId,
      poId: po.id,
      note: `Phải trả PO ${po.poCode}`,
    },
  });
  await tx.vendor.update({
    where: { id: po.vendorId },
    data: { totalDebt: { increment: unpaid } },
  });
  await auditService
    .log({
      userId,
      action: "DEBT_CREATED_PAYABLE",
      entity: "Debt",
      entityId: debt.id,
      before: null,
      after: { poId: po.id, amount: unpaid },
    })
    .catch(() => {});
  return debt;
};

const applyOrderPaymentToDebtInTx = async (tx, { orderId, paymentAmount, method, userId, note }) => {
  const debt = await tx.debt.findUnique({ where: { orderId } });
  if (!debt || debt.status === "CLOSED") return null;
  const remaining = round2(toNum(debt.amount) - toNum(debt.paidAmount));
  const apply = round2(Math.min(toNum(paymentAmount), remaining));
  if (apply <= 0) return null;

  const nextPaid = round2(toNum(debt.paidAmount) + apply);
  const nextStatus = statusFromAmounts(debt.amount, nextPaid, debt.dueDate);

  await tx.debtPayment.create({
    data: {
      id: randomUUID(),
      debtId: debt.id,
      amount: apply,
      method: method || "CASH",
      note: note || "Thu đơn hàng",
      createdById: userId,
    },
  });
  await tx.debt.update({
    where: { id: debt.id },
    data: { paidAmount: nextPaid, status: nextStatus },
  });
  if (debt.customerId) {
    await tx.customer.update({
      where: { id: debt.customerId },
      data: { totalDebt: { decrement: apply } },
    });
  }
  return { debt, apply, nextStatus };
};

const list = async ({
  page = 1,
  limit = 20,
  type,
  status,
  customerId,
  vendorId,
  overdue,
} = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (vendorId) where.vendorId = vendorId;
  if (overdue === "true" || overdue === true) {
    where.dueDate = { lt: new Date() };
    where.status = { not: "CLOSED" };
  }

  const [debts, total] = await Promise.all([
    prisma.debt.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vendor: { select: { id: true, name: true, code: true } },
        order: { select: { id: true, orderCode: true, total: true, paymentStatus: true } },
        purchaseOrder: { select: { id: true, poCode: true, total: true, paymentStatus: true } },
        payments: { orderBy: { paidAt: "desc" }, take: 5 },
      },
    }),
    prisma.debt.count({ where }),
  ]);
  return {
    debts,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
};

const summary = async () => {
  const [arOpen, apOpen, arOver, apOver] = await Promise.all([
    prisma.debt.aggregate({
      where: { type: "RECEIVABLE", status: { in: ["OPEN", "PARTIAL", "OVERDUE"] } },
      _sum: { amount: true, paidAmount: true },
    }),
    prisma.debt.aggregate({
      where: { type: "PAYABLE", status: { in: ["OPEN", "PARTIAL", "OVERDUE"] } },
      _sum: { amount: true, paidAmount: true },
    }),
    prisma.debt.aggregate({
      where: {
        type: "RECEIVABLE",
        status: { not: "CLOSED" },
        dueDate: { lt: new Date() },
      },
      _sum: { amount: true, paidAmount: true },
    }),
    prisma.debt.aggregate({
      where: {
        type: "PAYABLE",
        status: { not: "CLOSED" },
        dueDate: { lt: new Date() },
      },
      _sum: { amount: true, paidAmount: true },
    }),
  ]);
  const arRem = round2(toNum(arOpen._sum.amount) - toNum(arOpen._sum.paidAmount));
  const apRem = round2(toNum(apOpen._sum.amount) - toNum(apOpen._sum.paidAmount));
  return {
    receivableOpenTotal: arRem,
    payableOpenTotal: apRem,
    receivableOverdue: round2(toNum(arOver._sum.amount) - toNum(arOver._sum.paidAmount)),
    payableOverdue: round2(toNum(apOver._sum.amount) - toNum(apOver._sum.paidAmount)),
  };
};

const listByCustomer = async (customerId, page = 1, limit = 50) => {
  const skip = (Math.max(1, page) - 1) * Math.min(limit, 200);
  const take = Math.min(limit, 200);
  const where = { customerId };
  const [data, total] = await Promise.all([
    prisma.debt.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { order: { select: { id: true, orderCode: true } }, payments: true },
    }),
    prisma.debt.count({ where }),
  ]);
  return { data, pagination: { page: Math.max(1, page), limit: take, total, totalPages: Math.ceil(total / take) } };
};

const listByVendor = async (vendorId, page = 1, limit = 50) => {
  const skip = (Math.max(1, page) - 1) * Math.min(limit, 200);
  const take = Math.min(limit, 200);
  const where = { vendorId };
  const [data, total] = await Promise.all([
    prisma.debt.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: { purchaseOrder: { select: { id: true, poCode: true } }, payments: true },
    }),
    prisma.debt.count({ where }),
  ]);
  return { data, pagination: { page: Math.max(1, page), limit: take, total, totalPages: Math.ceil(total / take) } };
};

const recordDebtPayment = async (debtId, { amount, method = "CASH", note }, userId) => {
  const payAmount = round2(toNum(amount));
  if (payAmount <= 0) throw { status: 400, message: "Số tiền phải > 0" };

  const { debtPayment, debt } = await prisma.$transaction(async (tx) => {
    const debt = await tx.debt.findUnique({
      where: { id: debtId },
      include: { order: true, purchaseOrder: true },
    });
    if (!debt) throw { status: 404, message: "Không tìm thấy công nợ" };
    if (debt.status === "CLOSED") throw { status: 400, message: "Công nợ đã đóng" };

    const remaining = round2(toNum(debt.amount) - toNum(debt.paidAmount));
    if (payAmount > remaining) throw { status: 400, message: "Số tiền vượt quá dư nợ" };

    const nextPaid = round2(toNum(debt.paidAmount) + payAmount);
    const nextStatus = statusFromAmounts(debt.amount, nextPaid, debt.dueDate);

    const debtPayment = await tx.debtPayment.create({
      data: {
        id: randomUUID(),
        debtId: debt.id,
        amount: payAmount,
        method,
        note: note || null,
        createdById: userId,
      },
    });

    await tx.debt.update({
      where: { id: debt.id },
      data: { paidAmount: nextPaid, status: nextStatus },
    });

    if (debt.type === "RECEIVABLE" && debt.orderId) {
      const order = debt.order || (await tx.order.findUnique({ where: { id: debt.orderId } }));
      if (!order) throw { status: 400, message: "Đơn hàng không tồn tại" };
      await tx.payment.create({
        data: {
          orderId: order.id,
          amount: payAmount,
          method,
          note: note || "Thu công nợ",
          createdById: userId,
        },
      });
      const paidSum = await paymentService.getPaidAmount(order.id, tx);
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: paymentService.getPaymentStatus(toNum(order.total), paidSum),
          paymentMethod: method,
        },
      });
      if (debt.customerId) {
        await tx.customer.update({
          where: { id: debt.customerId },
          data: { totalDebt: { decrement: payAmount } },
        });
      }
    }

    if (debt.type === "PAYABLE" && debt.poId) {
      const po = debt.purchaseOrder || (await tx.purchaseOrder.findUnique({ where: { id: debt.poId } }));
      if (!po) throw { status: 400, message: "PO không tồn tại" };
      const newPaid = round2(toNum(po.paidAmount) + payAmount);
      const total = toNum(po.total);
      const paymentStatus = paymentService.getPaymentStatus(total, newPaid);
      const newPoStatus = newPaid >= total && po.status === "RECEIVED" ? "PAID" : po.status;
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          paidAmount: newPaid,
          paymentStatus,
          status: newPoStatus,
        },
      });
      if (debt.vendorId) {
        await tx.vendor.update({
          where: { id: debt.vendorId },
          data: { totalDebt: { decrement: payAmount } },
        });
      }
    }

    return { debtPayment, debt };
  });

  const postingPayload = autopostService.buildDebtPaymentEntry({
    debt,
    payment: debtPayment,
    userId,
  });
  await postingErrorService.tryPostOrQueue(
    () => autopostService.postDebtPayment({ debt, payment: debtPayment, userId }),
    {
      source: "DEBT",
      sourceId: debtPayment.id,
      payload: postingPayload,
    },
  );

  // A4: KHÔNG tạo expense thanh toán nợ NCC nữa — postDebtPayment (bên trên) đã
  // ghi DR 331 CR tiền mặt đúng chuẩn (chi phí đã ghi nhận lúc nhập hàng/nhận PO).
  // Trước đây ghi thêm expense PAID → tiền mặt bị trừ 2 lần + phí sai tăng.

  await auditService
    .log({
      userId,
      action: "DEBT_PAYMENT",
      entity: "Debt",
      entityId: debt.id,
      before: null,
      after: { paymentId: debtPayment.id, amount: payAmount },
    })
    .catch(() => {});

  return prisma.debt.findUnique({
    where: { id: debt.id },
    include: { payments: true, order: true, purchaseOrder: true },
  });
};

const markOverdueCron = async () => {
  const r = await prisma.debt.updateMany({
    where: {
      dueDate: { lt: new Date() },
      status: { in: ["OPEN", "PARTIAL"] },
    },
    data: { status: "OVERDUE" },
  });
  return { updated: r.count };
};

module.exports = {
  createReceivableForOrderInTx,
  createPayableForPoInTx,
  applyOrderPaymentToDebtInTx,
  list,
  summary,
  listByCustomer,
  listByVendor,
  recordDebtPayment,
  markOverdueCron,
  statusFromAmounts,
};
