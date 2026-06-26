/**
 * modules/accounting/autopost.service.js — Tự động tạo bút toán kế toán
 * 
 * Tổng quan:
 - Cung cấp các hàm build dữ liệu bút toán (journal entry input) và post bút toán
   cho các nghiệp vụ kinh tế phát sinh: bán hàng, thu tiền, trả hàng, chi phí,
   nhập kho, thanh toán PO, lương, góp vốn, sản xuất, công nợ.
 * - Mỗi nghiệp vụ có 2 hàm: build*Entry (tạo payload) và post* (gọi journalService.postEntry).
 * - Dùng trong các service khác để đảm bảo bút toán luôn được ghi khi nghiệp vụ xảy ra.
 * 
 * Hàm:
 * - buildOrderCompletedEntry({order, items, paidAmount, payments, userId}): Tạo bút toán ghi nhận doanh thu, giá vốn, phải thu.
 * - buildPaymentEntry({payment, order, userId}): Tạo bút toán thu tiền khách hàng.
 * - buildOrderReturnEntry({orderReturn, order, items, userId}): Tạo bút toán hoàn tiền trả hàng.
 * - buildExpenseEntry({expense, category, vendor, userId}): Tạo bút toán chi phí (nợ chi phí, có tiền/phải trả).
 * - buildExpensePaymentEntry({expense, vendor, userId}): Tạo bút toán thanh toán chi phí đã accrued.
 * - buildPurchaseReceivedEntry({purchaseOrder, vendor, userId}): Tạo bút toán nhập kho (nợ hàng hóa, có phải trả NCC).
 * - buildPurchasePaymentEntry({purchaseOrder, vendor, amount, method, userId, paymentId}): Tạo bút toán thanh toán PO.
 * - buildPayrollAccrualEntry({payroll, employee, userId}): Tạo bút toán lương (nợ chi phí, có phải trả).
 * - buildCapitalContributionEntry({amount, method, description, userId, contributionId}): Tạo bút toán góp vốn.
 * - buildDebtPaymentEntry({debt, payment, userId}): Tạo bút toán thu/chi công nợ.
 * - buildWorkOrderCompletedEntry({workOrder, items, userId}): Tạo bút toán hoàn thành sản xuất (155 → 156).
 * - postOrderCompleted, postPayment, postOrderReturn, postExpense, postExpensePayment,
 *   postPurchaseReceived, postPurchasePayment, postPayrollAccrual, postCapitalContribution,
 *   postDebtPayment, postWorkOrderCompleted: Wrapper gọi journalService.postEntry với payload tương ứng.
 * - cashAccountByMethod(method): Trả mã tài khoản tiền tương ứng (111: CASH, 112: BANK_TRANSFER/CARD).
 * - paymentLinesForOrder({order, paidAmount, payments}): Tạo dòng thu tiền cho đơn hàng, hỗ trợ partial payments.
 */
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
  const subtotal = toNum(order.subtotal);
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

  // Doanh thu ghi nhận theo subtotal (trước giảm giá)
  lines.push({ accountCode: "511", credit: subtotal, description: `Doanh thu don ${order.orderCode}` });

  // Giảm trừ doanh thu (chiết khấu đơn hàng, khuyến mãi, loyalty)
  const totalDiscount = toNum(order.discount) + toNum(order.promotionDiscount) + toNum(order.loyaltyDiscount);
  if (totalDiscount > 0) {
    lines.push({ accountCode: "521", debit: totalDiscount, description: `Chiet khau/KM don ${order.orderCode}` });
  }

  lines.push({ accountCode: "632", debit: totalCost, description: `Giá vốn don ${order.orderCode}` });
  lines.push({ accountCode: "156", credit: totalCost, description: `Xuat kho don ${order.orderCode}` });

  return {
    date: new Date(),
    description: `Ban hang - don ${order.orderCode}`,
    source: "ORDER",
    sourceId: order.id,
    operation: "PRIMARY",
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
    operation: "PRIMARY",
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
    lines.push({ accountCode: "632", credit: totalCost, description: `Hoan nhap giá vốn - ${orderReturn.returnCode}` });
  }

  return {
    date: new Date(),
    description: `Tra hang ${orderReturn.returnCode} - don ${order.orderCode}`,
    source: "RETURN",
    sourceId: orderReturn.id,
    operation: "PRIMARY",
    userId,
    lines,
  };
};

const buildExpenseEntry = ({ expense, category, vendor, userId }) => {
  const amount = toNum(expense.amount);
  const tax = toNum(expense.taxAmount);
  const total = toNum(expense.totalAmount);
  if (total <= 0) return null;
  if (!category?.accountId) {
    // Defensive: nếu đến đây mà accountId null thì có lỗi schema.
    throw {
      status: 500,
      message: `Danh mục chi phí "${category?.name || "?"}" thiếu tài khoản kế toán liên kết`,
    };
  }

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
    operation: "ACCRUAL",
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
    operation: "PAYMENT",
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
    description: `Nhập hàng tu ${vendor.name} - PO ${purchaseOrder.poCode}`,
    source: "PURCHASE",
    sourceId: purchaseOrder.id,
    operation: "RECEIVE",
    userId,
    lines,
  };
};

const buildPurchasePaymentEntry = ({ purchaseOrder, vendor, amount, method, userId, paymentId }) => {
  if (amount <= 0) return null;

  return {
    date: new Date(),
    description: `Thanh toan PO ${purchaseOrder.poCode} cho ${vendor.name}`,
    source: "PURCHASE",
    sourceId: purchaseOrder.id,
    // Mỗi payment là một sự kiện riêng → operation phải unique theo paymentId.
    // Nếu không có paymentId, fall back timestamp để allow nhiều partial payments.
    operation: `PAYMENT:${paymentId || Date.now()}`,
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
    operation: "PRIMARY",
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
      operation: "PRIMARY",
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
    operation: "PRIMARY",
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

/**
 * Bút toán khi Lệnh sản xuất (Work Order) hoàn thành
 *
 * Luồng nghiệp vụ đúng:
 *   - DR 154 (WIP)     = totalCost   — tập hợp chi phí SX dở dang
 *   - CR 156 (Hàng hóa) = totalCost  — xuất nguyên liệu
 *   - DR 155 (TP)      = totalCost   — nhập kho thành phẩm
 *   - CR 154 (WIP)     = totalCost   — kết chuyển WIP
 *
 * totalCost = SUM(component.costPrice × requiredQty)
 *
 * Nếu totalCost = 0 (nguyên liệu chưa có giá vốn), không ghi bút toán.
 */
const buildWorkOrderCompletedEntry = ({ workOrder, items, userId }) => {
  const totalCost = toNum(workOrder.totalCost);
  if (totalCost <= 0) return null;

  return {
    date: workOrder.actualEndDate || new Date(),
    description: `Hoàn thành sản xuất WO ${workOrder.code} - ${workOrder.product?.name || ""}`,
    source: "INVENTORY",
    sourceId: workOrder.id,
    operation: "WORK_ORDER",
    userId,
    lines: [
      {
        accountCode: "154",
        debit: totalCost,
        description: `Tập hợp CPSX - WO ${workOrder.code}`,
      },
      {
        accountCode: "156",
        credit: totalCost,
        description: `Xuất nguyên liệu cho SX - WO ${workOrder.code}`,
      },
      {
        accountCode: "155",
        debit: totalCost,
        description: `Nhập kho thành phẩm - WO ${workOrder.code} (SL: ${workOrder.quantity})`,
      },
      {
        accountCode: "154",
        credit: totalCost,
        description: `KC CPSX - WO ${workOrder.code}`,
      },
    ],
  };
};

const buildCapitalContributionEntry = ({ amount, method = "CASH", description = "Gop von chu so huu", userId, contributionId }) => {
  if (amount <= 0) return null;
  return {
    description,
    source: "MANUAL",
    sourceId: contributionId || null,
    operation: "PRIMARY",
    userId,
    lines: [
      { accountCode: cashAccountByMethod(method), debit: amount, description },
      { accountCode: "411", credit: amount, description: "Tang von chu" },
    ],
  };
};

/**
 * Bút toán điều chỉnh tồn kho (Inventory ADJUSTMENT)
 *
 * Khi diff > 0 (thiếu): DR 632 (giá vốn), CR 156 (hàng hóa)
 * Khi diff < 0 (thừa):  DR 156 (hàng hóa), CR 711 (thu nhập khác)
 * (diff = actualQuantity - systemQuantity)
 *
 * Note: diff là chênh lệch dương = tồn thực tế > tồn sổ sách => thừa kho
 *       diff âm = tồn thực tế < tồn sổ sách => thiếu kho
 */
const buildInventoryAdjustmentEntry = ({ diff, product, userId }) => {
  const absDiff = Math.abs(diff);
  if (absDiff <= 0) return null;
  const productName = product?.name || "SP";

  const lines = [];
  if (diff > 0) {
    // Thừa kho: nhập thêm hàng, ghi nhận thu nhập khác
    lines.push({ accountCode: "156", debit: absDiff, description: `Điều chỉnh tăng kho - ${productName}` });
    lines.push({ accountCode: "711", credit: absDiff, description: `Thừa kho - ${productName}` });
  } else {
    // Thiếu kho: xuất bớt hàng, ghi nhận giá vốn
    lines.push({ accountCode: "632", debit: absDiff, description: `Thiếu kho - ${productName}` });
    lines.push({ accountCode: "156", credit: absDiff, description: `Điều chỉnh giảm kho - ${productName}` });
  }

  return {
    date: new Date(),
    description: `Điều chỉnh tồn kho - ${productName} (${diff > 0 ? "+" : ""}${diff})`,
    source: "INVENTORY",
    sourceId: null,
    operation: `ADJUSTMENT:${Date.now()}`,
    userId,
    lines,
  };
};

/**
 * Bút toán mua tài sản cố định
 * DR 211 (Nguyên giá TSCĐ), CR 111/112/331
 */
const buildAssetAcquisitionEntry = ({ asset, userId }) => {
  const cost = toNum(asset.cost);
  if (cost <= 0) return null;

  return {
    date: new Date(asset.purchaseDate),
    description: `Mua TSCĐ: ${asset.name} - ${asset.code}`,
    source: "INVENTORY",
    sourceId: asset.id,
    operation: `ACQUISITION:${asset.code}`,
    userId,
    lines: [
      { accountCode: "211", debit: cost, description: `Nguyên giá TSCĐ - ${asset.name}` },
      { accountCode: "331", credit: cost, description: `Phải trả người bán - ${asset.name}` },
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
const postWorkOrderCompleted = (input, tx) => postBuiltEntry(buildWorkOrderCompletedEntry(input), tx);
const postInventoryAdjustment = (input, tx) => postBuiltEntry(buildInventoryAdjustmentEntry(input), tx);
const postAssetAcquisition = (input, tx) => postBuiltEntry(buildAssetAcquisitionEntry(input), tx);

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
  buildWorkOrderCompletedEntry,
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
  postWorkOrderCompleted,
  buildInventoryAdjustmentEntry,
  postInventoryAdjustment,
  buildAssetAcquisitionEntry,
  postAssetAcquisition,
};
