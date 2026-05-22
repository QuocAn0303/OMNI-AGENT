// src/modules/accounting/posting-error.service.js
// Outbox: ghi nhận failure khi auto-post bút toán không thành công.
// Cho phép admin retry hoặc đánh dấu bỏ qua.
//
// Retry strategy: payload chỉ chứa operation + sourceId. Khi retry, ta REBUILD
// dữ liệu thực từ DB và gọi lại đúng autopost function. Không lưu sẵn lines/description
// vì chúng có thể đã đổi (vd: status đơn hàng, refund amount...).
const prisma = require("../../config/prisma");
const journalService = require("./journal.service");

// Lazy-require để tránh circular dep
const getAutopostService = () => require("./autopost.service");

// Registry: mỗi operation map tới một function rebuild + post.
// `payload.operation` (vd: ORDER_COMPLETED, PAYMENT_RECEIVED, ...) quyết định cách rebuild.
const REBUILDERS = {
  ORDER_COMPLETED: async (payload, userId) => {
    const order = await prisma.order.findUnique({
      where: { id: payload.sourceId },
      include: { items: { include: { product: true } }, payments: true },
    });
    if (!order) throw { status: 404, message: "Order không còn tồn tại" };
    const paidAmount = order.payments.reduce((s, p) => s + Number(p.amount), 0);
    return getAutopostService().postOrderCompleted({
      order,
      items: order.items.map((it) => ({ quantity: it.quantity, product: it.product })),
      payments: order.payments,
      paidAmount,
      userId,
    });
  },
  PAYMENT_RECEIVED: async (payload, userId) => {
    const payment = await prisma.payment.findUnique({
      where: { id: payload.sourceId },
      include: { order: true },
    });
    if (!payment) throw { status: 404, message: "Payment không còn tồn tại" };
    return getAutopostService().postPayment({ payment, order: payment.order, userId });
  },
  RETURN_APPROVED: async (payload, userId) => {
    const ret = await prisma.orderReturn.findUnique({
      where: { id: payload.sourceId },
      include: {
        order: true,
        items: { include: { orderItem: { include: { product: true } } } },
      },
    });
    if (!ret) throw { status: 404, message: "Return không còn tồn tại" };
    return getAutopostService().postOrderReturn({
      orderReturn: ret,
      order: ret.order,
      items: ret.items.map((it) => ({ quantity: it.quantity, product: it.orderItem.product })),
      userId,
    });
  },
  EXPENSE_POSTED: async (payload, userId) => {
    const expense = await prisma.expense.findUnique({
      where: { id: payload.sourceId },
      include: { category: true, vendor: true },
    });
    if (!expense) throw { status: 404, message: "Expense không còn tồn tại" };
    return getAutopostService().postExpense({
      expense,
      category: expense.category,
      vendor: expense.vendor,
      userId,
    });
  },
  EXPENSE_PAYMENT: async (payload, userId) => {
    const expense = await prisma.expense.findUnique({
      where: { id: payload.sourceId },
      include: { vendor: true },
    });
    if (!expense) throw { status: 404, message: "Expense không còn tồn tại" };
    return getAutopostService().postExpensePayment({ expense, vendor: expense.vendor, userId });
  },
  PURCHASE_RECEIVED: async (payload, userId) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: payload.sourceId },
      include: { vendor: true },
    });
    if (!po) throw { status: 404, message: "PO không còn tồn tại" };
    return getAutopostService().postPurchaseReceived({
      purchaseOrder: po,
      vendor: po.vendor,
      userId,
    });
  },
  PURCHASE_PAYMENT: async (payload, userId) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: payload.sourceId },
      include: { vendor: true },
    });
    if (!po) throw { status: 404, message: "PO không còn tồn tại" };
    return getAutopostService().postPurchasePayment({
      purchaseOrder: po,
      vendor: po.vendor,
      amount: Number(payload.amount || 0),
      method: payload.method || "BANK_TRANSFER",
      paymentId: payload.paymentId,
      userId,
    });
  },
  WORK_ORDER_COMPLETED: async (payload, userId) => {
    const wo = await prisma.workOrder.findUnique({
      where: { id: payload.sourceId },
      include: { product: true, items: { include: { component: true } } },
    });
    if (!wo) throw { status: 404, message: "Work Order không còn tồn tại" };
    return getAutopostService().postWorkOrderCompleted({
      workOrder: wo,
      items: wo.items,
      userId,
    });
  },
};

/**
 * Persist một posting failure. Phải được gọi BÊN NGOÀI transaction nghiệp vụ
 * để: nếu nghiệp vụ thành công nhưng bút toán fail, ta vẫn lưu được lỗi.
 *
 * @param {Object} ctx - Prisma client (KHÔNG phải tx của caller)
 */
const recordError = async (
  { source, sourceId, payload, error },
  client = prisma,
) => {
  return client.journalPostingError.create({
    data: {
      source,
      sourceId,
      payload: JSON.parse(JSON.stringify(payload || {})),
      errorMsg: error?.message || String(error),
      retryCount: 0,
      lastTriedAt: new Date(),
    },
  });
};

/**
 * Wrapper: thử post bằng autopost function. Nếu fail, lưu vào outbox.
 * KHÔNG re-throw để nghiệp vụ chính không bị rollback (đã commit ngoài tx).
 *
 * @param {() => Promise<any>} postFn - hàm gọi autopost (đã bind tham số sẵn)
 * @param {Object} meta - { source, sourceId, payload }
 */
const tryPostOrQueue = async (postFn, meta) => {
  try {
    return await postFn();
  } catch (err) {
    try {
      await recordError({ ...meta, error: err });
    } catch (e2) {
      // Last resort: log to console
      console.error("[posting-error] failed to record outbox:", e2.message, "original:", err.message);
    }
    return null;
  }
};

const list = async ({ page = 1, limit = 50, resolved } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (resolved === "true" || resolved === true) where.resolvedAt = { not: null };
  else if (resolved === "false" || resolved === false) where.resolvedAt = null;
  const [errors, total] = await Promise.all([
    prisma.journalPostingError.findMany({
      where, skip, take: Number(limit), orderBy: { createdAt: "desc" },
    }),
    prisma.journalPostingError.count({ where }),
  ]);
  return {
    errors,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

/**
 * Retry một posting error: dùng payload đã lưu để gọi lại postEntry.
 */
const retry = async (errorId, userId) => {
  const err = await prisma.journalPostingError.findUnique({ where: { id: errorId } });
  if (!err) throw { status: 404, message: "Không tìm thấy posting error" };
  if (err.resolvedAt) throw { status: 400, message: "Lỗi này đã được xử lý" };

  const payload = err.payload || {};
  try {
    const entry = await journalService.postEntry({
      ...payload,
      source: payload.source || err.source,
      sourceId: payload.sourceId || err.sourceId,
      userId: userId || payload.userId,
    });
    await prisma.journalPostingError.update({
      where: { id: errorId },
      data: {
        resolvedAt: new Date(),
        resolvedEntryId: entry.id,
        retryCount: { increment: 1 },
        lastTriedAt: new Date(),
      },
    });
    return { success: true, entry };
  } catch (retryErr) {
    await prisma.journalPostingError.update({
      where: { id: errorId },
      data: {
        retryCount: { increment: 1 },
        lastTriedAt: new Date(),
        errorMsg: retryErr.message || String(retryErr),
      },
    });
    throw retryErr;
  }
};

const dismiss = async (errorId) => {
  const err = await prisma.journalPostingError.findUnique({ where: { id: errorId } });
  if (!err) throw { status: 404, message: "Không tìm thấy" };
  return prisma.journalPostingError.update({
    where: { id: errorId },
    data: { resolvedAt: new Date(), errorMsg: `[DISMISSED] ${err.errorMsg}` },
  });
};

module.exports = { recordError, tryPostOrQueue, list, retry, dismiss };
