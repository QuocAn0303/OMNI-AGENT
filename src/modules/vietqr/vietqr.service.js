const prisma = require("../../config/prisma");
const paymentService = require("../payments/payment.service");
const { verifyWebhook } = require("../../config/payos");

const LOG = "[vietqr]";

const matchTransaction = async ({ amount, description, txDate, reference }) => {
  const matches = [];

  // Match 1: By order code in description
  const orderMatch = description.match(/ORD-\d{8}-\d{4}/i);
  if (orderMatch) {
    const order = await prisma.order.findFirst({
      where: { orderCode: orderMatch[0].toUpperCase() },
      select: { id: true, orderCode: true, total: true, paymentStatus: true },
    });
    if (order) {
      matches.push({ type: "ORDER", id: order.id, code: order.orderCode, source: "orderCode" });
    }
  }

  // Match 2: By debt code in description
  const debtMatch = description.match(/DEBT-?(\w+)/i);
  if (debtMatch) {
    const debt = await prisma.debt.findFirst({
      where: { id: { startsWith: debtMatch[1] } },
      select: { id: true, customerId: true, amount: true, paidAmount: true },
    });
    if (debt) {
      matches.push({ type: "DEBT", id: debt.id, code: `DEBT-${debt.id.slice(0, 8)}`, source: "debtCode" });
    }
  }

  // Match 3: By exact amount (fuzzy — within 5% tolerance)
  if (!matches.length) {
    const lowerBound = amount * 0.95;
    const upperBound = amount * 1.05;

    // Check orders pending payment with matching amount
    const ordersByAmount = await prisma.order.findMany({
      where: {
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        total: { gte: lowerBound, lte: upperBound },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, orderCode: true, total: true, paymentStatus: true },
    });

    for (const order of ordersByAmount) {
      const balance = await paymentService.getOrderBalance(order.id);
      const remaining = balance.total - balance.paid;
      if (Math.abs(remaining - amount) < 5000) {
        matches.push({ type: "ORDER", id: order.id, code: order.orderCode, source: "amount" });
      }
    }
  }

  return matches;
};

const processWebhook = async (body, provider = "casso") => {
  try {
    const transaction = provider === "payos"
      ? verifyWebhook(body)
      : { success: true, data: body };

    if (!transaction.success) {
      console.error(`${LOG} webhook verification failed`);
      return { success: false, message: "Verification failed" };
    }

    const txn = provider === "payos"
      ? { amount: transaction.data.amount, description: transaction.data.description, reference: transaction.data.reference, txDate: new Date() }
      : { amount: body.amount || 0, description: body.description || "", reference: body.tid || body.reference || "", txDate: new Date(body.when || Date.now()) };

    if (!txn.amount || txn.amount <= 0) {
      return { success: false, message: "Invalid amount" };
    }

    console.log(`${LOG} received: ${txn.amount.toLocaleString()} VND — "${txn.description}"`);

    // Deduplicate: check if this reference was already processed
    if (txn.reference) {
      const existing = await prisma.payment.findFirst({ where: { reference: txn.reference } });
      if (existing) {
        return { success: true, message: "Already processed", alreadyProcessed: true };
      }
    }

    // Match to order/debt
    const matches = await matchTransaction(txn);

    if (!matches.length) {
      console.log(`${LOG} no match found for ${txn.amount.toLocaleString()} VND — "${txn.description}"`);
      return { success: true, message: "No match found", unmatched: true };
    }

    const systemUser = await prisma.user.findFirst({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    const userId = systemUser?.id;

    const results = [];
    for (const match of matches) {
      if (match.type === "ORDER") {
        const payment = await paymentService.recordPayment({
          orderId: match.id,
          amount: txn.amount,
          method: "BANK_TRANSFER",
          reference: txn.reference,
          note: `[VietQR tự động] ${txn.description}`,
        }, userId);

        console.log(`${LOG} auto-paid order ${payment.order.orderCode}: ${txn.amount.toLocaleString()} VND`);
        results.push({
          type: "ORDER",
          orderCode: payment.order.orderCode,
          paymentId: payment.id,
          amount: txn.amount,
        });
      } else if (match.type === "DEBT") {
        // Record debt payment
        await prisma.debtPayment.create({
          data: {
            debtId: match.id,
            amount: txn.amount,
            method: "BANK_TRANSFER",
            reference: txn.reference,
            paidAt: new Date(),
            note: `[VietQR tự động] ${txn.description}`,
          },
        }).catch((e) => console.error(`${LOG} debt payment error:`, e.message));

        // Update debt status
        const debt = await prisma.debt.findUnique({ where: { id: match.id } });
        if (debt) {
          const totalPaid = Number(debt.paidAmount) + txn.amount;
          const newStatus = totalPaid >= Number(debt.amount) ? "CLOSED" : "PARTIAL";
          await prisma.debt.update({
            where: { id: debt.id },
            data: { paidAmount: totalPaid, status: newStatus },
          });
        }

        console.log(`${LOG} auto-paid debt ${match.code}: ${txn.amount.toLocaleString()} VND`);
        results.push({ type: "DEBT", debtCode: match.code, amount: txn.amount });
      }
    }

    return { success: true, message: "Processed", matched: true, results };
  } catch (err) {
    console.error(`${LOG} process error:`, err.message);
    return { success: false, message: err.message };
  }
};

const getPendingTransactions = async ({ orderId, limit = 20 } = {}) => {
  const where = {};
  if (orderId) where.orderId = orderId;
  const payments = await prisma.payment.findMany({
    where,
    orderBy: { paidAt: "desc" },
    take: limit,
    include: { order: { select: { orderCode: true } } },
  });
  return payments;
};

module.exports = {
  processWebhook,
  matchTransaction,
  getPendingTransactions,
};
