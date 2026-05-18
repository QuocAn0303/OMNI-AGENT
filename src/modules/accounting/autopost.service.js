const journalService = require("./journal.service");

const toNum = (v) => Number(v || 0);

const cashAccountByMethod = (method) => {
  switch (method) {
    case "BANK_TRANSFER":
    case "CARD":
      return "112";
    case "CASH":
    default:
      return "111";
  }
};

const postBuiltEntry = (entryInput, tx) => {
  if (!entryInput) return null;
  return journalService.postEntry(entryInput, tx);
};

const paymentLinesForOrder = ({ order, paidAmount = 0, payments = [] }) => {
  const total = toNum(order.total);
  let remaining = total;
  const lines = [];

  for (const payment of payments || []) {
    if (remaining <= 0) break;
    const amount = Math.min(toNum(payment.amount), remaining);
    if (amount <= 0) continue;
    lines.push({
      accountCode: cashAccountByMethod(payment.method),
      debit: amount,
      description: `Thu ${payment.method} - don ${order.orderCode}`,
    });
    remaining -= amount;
  }

  if (!lines.length && toNum(paidAmount) > 0) {
    const amount = Math.min(toNum(paidAmount), total);
    lines.push({
      accountCode: cashAccountByMethod(order.paymentMethod),
      debit: amount,
      description: `Thu tien don ${order.orderCode}`,
    });
    remaining -= amount;
  }

  return { lines, paidPortion: total - remaining };
};

const buildOrderCompletedEntry = ({ order, items, paidAmount = 0, payments = [], userId }) => {
  const total = toNum(order.total);
  if (total <= 0) return null;

  let totalCost = 0;
  for (const item of items) {
    totalCost += toNum(item.product?.costPrice || 0) * Number(item.quantity || 0);
  }

  const { lines, paidPortion } = paymentLinesForOrder({ order, paidAmount, payments });
  const receivable = total - paidPortion;

  if (receivable > 0) {
    lines.push({
      accountCode: "131",
      debit: receivable,
      description: `Phai thu KH - don ${order.orderCode}`,
      partyType: "CUSTOMER",
      partyId: order.customerId || null,
    });
  }

  lines.push({ accountCode: "511", credit: total, description: `Doanh thu don ${order.orderCode}` });

  if (totalCost > 0) {
    lines.push({ accountCode: "632", debit: totalCost, description: `Gia von don ${order.orderCode}` });
    lines.push({ accountCode: "156", credit: totalCost, description: `Xuat kho don ${order.orderCode}` });
  }

  return {
    date: new Date(),
    description: `Ban hang - don ${order.orderCode}`,
    source: "ORDER",
    sourceId: order.id,
    userId,
    lines,
  };
};

const buildPaymentEntry = ({ payment, order, userId }) => {
  const amount = toNum(payment.amount);
  if (amount <= 0) return null;

  return {
    date: payment.createdAt || new Date(),
    description: `Thu tien KH - don ${order.orderCode}`,
    source: "PAYMENT",
    sourceId: payment.id,
    userId,
    lines: [
      { accountCode: cashAccountByMethod(payment.method), debit: amount, description: `Thu ${payment.method}` },
      {
        accountCode: "131",
        credit: amount,
        description: `Giam phai thu - don ${order.orderCode}`,
        partyType: "CUSTOMER",
        partyId: order.customerId || null,
      },
    ],
  };
};

const buildOrderReturnEntry = ({ orderReturn, order, items, userId }) => {
  const refund = toNum(orderReturn.refundAmount);
  if (refund <= 0) return null;

  const cashCode =
    orderReturn.refundMethod === "BANK_TRANSFER" ? "112" :
    orderReturn.refundMethod === "STORE_CREDIT" ? "131" : "111";

  let totalCost = 0;
  for (const item of items) {
    totalCost += toNum(item.product?.costPrice || 0) * Number(item.quantity || 0);
  }

  const lines = [
    { accountCode: "521", debit: refund, description: `Giam tru doanh thu - tra hang ${orderReturn.returnCode}` },
    {
      accountCode: cashCode,
      credit: refund,
      description: `Hoan tien - ${orderReturn.refundMethod}`,
      partyType: "CUSTOMER",
      partyId: order.customerId || null,
    },
  ];

  if (totalCost > 0) {
    lines.push({ accountCode: "156", debit: totalCost, description: `Nhap lai kho - tra hang ${orderReturn.returnCode}` });
    lines.push({ accountCode: "632", credit: totalCost, description: `Hoan nhap gia von - ${orderReturn.returnCode}` });
  }

  return {
    date: new Date(),
    description: `Tra hang ${orderReturn.returnCode} - don ${order.orderCode}`,
    source: "RETURN",
    sourceId: orderReturn.id,
    userId,
    lines,
  };
};

const buildExpenseEntry = ({ expense, category, vendor, userId }) => {
  const amount = toNum(expense.amount);
  const tax = toNum(expense.taxAmount);
  const total = toNum(expense.totalAmount);
  if (total <= 0) return null;

  const lines = [{ accountId: category.accountId, debit: amount, description: expense.description }];
  if (tax > 0) lines.push({ accountCode: "1331", debit: tax, description: `VAT dau vao (${expense.expenseCode})` });

  if (expense.status === "PAID") {
    lines.push({
      accountCode: cashAccountByMethod(expense.paymentMethod),
      credit: total,
      description: `Chi tien cho ${expense.description}`,
      partyType: vendor ? "VENDOR" : null,
      partyId: vendor?.id || null,
    });
  } else {
    lines.push({
      accountCode: "331",
      credit: total,
      description: `Phai tra NCC - ${expense.description}`,
      partyType: "VENDOR",
      partyId: vendor?.id || null,
    });
  }

  return {
    date: expense.date || new Date(),
    description: `Chi phi: ${expense.description}`,
    source: "EXPENSE",
    sourceId: expense.id,
    userId,
    lines,
  };
};

const buildExpensePaymentEntry = ({ expense, vendor, userId }) => {
  const total = toNum(expense.totalAmount);
  if (total <= 0) return null;

  return {
    date: expense.paidAt || new Date(),
    description: `Thanh toan chi phi: ${expense.description}`,
    source: "EXPENSE",
    sourceId: expense.id,
    userId,
    lines: [
      {
        accountCode: "331",
        debit: total,
        description: `Giam phai tra NCC - ${expense.expenseCode}`,
        partyType: "VENDOR",
        partyId: vendor?.id || null,
      },
      { accountCode: cashAccountByMethod(expense.paymentMethod), credit: total, description: `Chi tien - ${expense.expenseCode}` },
    ],
  };
};

const buildPurchaseReceivedEntry = ({ purchaseOrder, vendor, userId }) => {
  const subtotal = toNum(purchaseOrder.subtotal);
  const tax = toNum(purchaseOrder.taxAmount);
  const total = toNum(purchaseOrder.total);
  if (total <= 0) return null;

  const lines = [{ accountCode: "156", debit: subtotal, description: `Nhap kho - PO ${purchaseOrder.poCode}` }];
  if (tax > 0) lines.push({ accountCode: "1331", debit: tax, description: `VAT dau vao - ${purchaseOrder.poCode}` });
  lines.push({
    accountCode: "331",
    credit: total,
    description: `Phai tra NCC - ${vendor.name}`,
    partyType: "VENDOR",
    partyId: vendor.id,
  });

  return {
    date: purchaseOrder.receivedAt || new Date(),
    description: `Nhap hang tu ${vendor.name} - PO ${purchaseOrder.poCode}`,
    source: "PURCHASE",
    sourceId: purchaseOrder.id,
    userId,
    lines,
  };
};

const buildPurchasePaymentEntry = ({ purchaseOrder, vendor, amount, method, userId }) => {
  if (amount <= 0) return null;

  return {
    date: new Date(),
    description: `Thanh toan PO ${purchaseOrder.poCode} cho ${vendor.name}`,
    source: "PURCHASE",
    sourceId: purchaseOrder.id,
    userId,
    lines: [
      {
        accountCode: "331",
        debit: amount,
        description: `Giam phai tra NCC - ${purchaseOrder.poCode}`,
        partyType: "VENDOR",
        partyId: vendor.id,
      },
      { accountCode: cashAccountByMethod(method), credit: amount, description: `Chi tien - ${method}` },
    ],
  };
};

const buildPayrollAccrualEntry = ({ payroll, employee, userId }) => {
  const total = toNum(payroll.finalSalary);
  if (total <= 0) return null;
  const expenseCode = employee?.position === "SALES" ? "6411" : "6421";

  return {
    date: new Date(payroll.year, payroll.month - 1, 28),
    description: `Luong ${payroll.month}/${payroll.year} - ${employee?.user?.fullName || "NV"}`,
    source: "PAYROLL",
    sourceId: payroll.id,
    userId,
    lines: [
      { accountCode: expenseCode, debit: total, description: "Chi phi luong" },
      {
        accountCode: "334",
        credit: total,
        description: "Luong phai tra",
        partyType: "EMPLOYEE",
        partyId: employee?.id || null,
      },
    ],
  };
};

const buildDebtPaymentEntry = ({ debt, payment, userId }) => {
  const amt = toNum(payment.amount);
  if (amt <= 0) return null;
  const method = payment.method || "CASH";
  const cashCode = cashAccountByMethod(method);
  if (debt.type === "RECEIVABLE") {
    return {
      date: payment.paidAt || new Date(),
      description: `Thu công nợ khách hàng (${debt.id.slice(0, 8)})`,
      source: "DEBT",
      sourceId: payment.id,
      userId,
      lines: [
        { accountCode: cashCode, debit: amt, description: `Thu tiền công nợ` },
        {
          accountCode: "131",
          credit: amt,
          description: "Giảm phải thu",
          partyType: "CUSTOMER",
          partyId: debt.customerId || undefined,
        },
      ],
    };
  }
  return {
    date: payment.paidAt || new Date(),
    description: `Thanh toán công nợ NCC (${debt.id.slice(0, 8)})`,
    source: "DEBT",
    sourceId: payment.id,
    userId,
    lines: [
      {
        accountCode: "331",
        debit: amt,
        description: "Giảm phải trả",
        partyType: "VENDOR",
        partyId: debt.vendorId || undefined,
      },
      { accountCode: cashCode, credit: amt, description: `Chi tiền ${method}` },
    ],
  };
};

const postDebtPayment = (input, tx) => postBuiltEntry(buildDebtPaymentEntry(input), tx);

const buildCapitalContributionEntry = ({ amount, method = "CASH", description = "Gop von chu so huu", userId }) => {
  if (amount <= 0) return null;
  return {
    description,
    source: "MANUAL",
    userId,
    lines: [
      { accountCode: cashAccountByMethod(method), debit: amount, description },
      { accountCode: "411", credit: amount, description: "Tang von chu" },
    ],
  };
};

const postOrderCompleted = (input, tx) => postBuiltEntry(buildOrderCompletedEntry(input), tx);
const postPayment = (input, tx) => postBuiltEntry(buildPaymentEntry(input), tx);
const postOrderReturn = (input, tx) => postBuiltEntry(buildOrderReturnEntry(input), tx);
const postExpense = (input, tx) => postBuiltEntry(buildExpenseEntry(input), tx);
const postExpensePayment = (input, tx) => postBuiltEntry(buildExpensePaymentEntry(input), tx);
const postPurchaseReceived = (input, tx) => postBuiltEntry(buildPurchaseReceivedEntry(input), tx);
const postPurchasePayment = (input, tx) => postBuiltEntry(buildPurchasePaymentEntry(input), tx);
const postPayrollAccrual = (input, tx) => postBuiltEntry(buildPayrollAccrualEntry(input), tx);
const postCapitalContribution = (input, tx) => postBuiltEntry(buildCapitalContributionEntry(input), tx);

module.exports = {
  buildOrderCompletedEntry,
  buildPaymentEntry,
  buildOrderReturnEntry,
  buildExpenseEntry,
  buildExpensePaymentEntry,
  buildPurchaseReceivedEntry,
  buildPurchasePaymentEntry,
  buildPayrollAccrualEntry,
  buildCapitalContributionEntry,
  buildDebtPaymentEntry,
  postOrderCompleted,
  postPayment,
  postOrderReturn,
  postExpense,
  postExpensePayment,
  postPurchaseReceived,
  postPurchasePayment,
  postPayrollAccrual,
  postCapitalContribution,
  postDebtPayment,
};
