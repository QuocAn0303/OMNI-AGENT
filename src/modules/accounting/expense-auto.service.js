/**
 * modules/accounting/expense-auto.service.js — Tự động tạo chi phí từ các nghiệp vụ khác
 * 
 * Tổng quan:
 * - Tự động sinh bản ghi expense (chi phí) từ các sự kiện nghiệp vụ khác như:
 *   trả hàng hoàn tiền, thanh toán công nợ phải trả, chốt lương.
 * - Tránh trùng lặp bằng cách kiểm tra sourceType + sourceId trước khi tạo.
 * - Hỗ trợ tạo chi phí định kỳ (recurring) từ template.
 * 
 * Hàm:
 * - createIfNotExists({sourceType, sourceId, categoryCode, amount, description, paymentMethod, userId, status}, tx):
 *   Tạo expense nếu chưa tồn tại theo sourceType + sourceId. Dùng transaction Prisma.
 * - fromReturnRefund({orderReturn, userId}, tx): Tạo expense cho hoàn tiền trả hàng (categoryCode: REFUND).
 * - fromDebtPayment({debtPayment, debt, userId}): Tạo expense cho thanh toán công nợ phải trả (categoryCode: INVENTORY_COST).
 * - fromPayrollLock({payroll, userId}): Tạo expense cho lương (categoryCode: SALARY).
 * - generateRecurring(): Quét các expense có isRecurring, tạo bản ghi mới cho kỳ hiện tại nếu chưa có.
 */
const prisma = require("../../config/prisma");
const expenseService = require("./expense.service");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const getCategoryByCode = async (code, tx = prisma) => {
  const cat = await tx.expenseCategory.findFirst({ where: { code, isActive: true } });
  if (!cat) throw { status: 500, message: `Thiếu danh mục chi phí: ${code}` };
  return cat;
};

const createIfNotExists = async (
  { sourceType, sourceId, categoryCode, amount, description, paymentMethod, userId, status = "APPROVED" },
  tx = prisma,
) => {
  const existing = await tx.expense.findFirst({ where: { sourceType, sourceId } });
  if (existing) return existing;

  const category = await getCategoryByCode(categoryCode, tx);
  const total = round2(amount);

  return expenseService.create(
    {
      date: new Date(),
      categoryId: category.id,
      description,
      amount: total,
      paymentMethod: paymentMethod || "CASH",
      status,
      sourceType,
      sourceId,
    },
    userId,
  );
};

const fromReturnRefund = async ({ orderReturn, userId }, tx) => {
  if (!["CASH", "BANK_TRANSFER"].includes(orderReturn.refundMethod)) return null;
  const amount = Number(orderReturn.refundAmount);
  if (amount <= 0) return null;
  return createIfNotExists(
    {
      sourceType: "RETURN_REFUND",
      sourceId: orderReturn.id,
      categoryCode: "REFUND",
      amount,
      description: `Hoàn tiền trả hàng ${orderReturn.returnCode}`,
      paymentMethod: orderReturn.refundMethod,
      userId,
      status: "PAID",
    },
    tx,
  );
};

const fromDebtPayment = async ({ debtPayment, debt, userId }) => {
  if (debt.type !== "PAYABLE") return null;
  return createIfNotExists({
    sourceType: "DEBT_PAYMENT",
    sourceId: debtPayment.id,
    categoryCode: "INVENTORY_COST",
    amount: Number(debtPayment.amount),
    description: `Thanh toán công nợ NCC${debt.poId ? ` PO` : ""}`,
    paymentMethod: debtPayment.method,
    userId,
    status: "PAID",
  });
};

const fromPayrollLock = async ({ payroll, userId }) => {
  const amount = Number(payroll.finalSalary);
  if (amount <= 0) return null;
  return createIfNotExists({
    sourceType: "PAYROLL",
    sourceId: payroll.id,
    categoryCode: "SALARY",
    amount,
    description: `Lương T${payroll.month}/${payroll.year}`,
    paymentMethod: "BANK_TRANSFER",
    userId,
    status: "APPROVED",
  });
};

const generateRecurring = async () => {
  const templates = await prisma.expense.findMany({
    where: { isRecurring: true, status: { in: ["APPROVED", "PAID"] } },
    include: { category: true },
  });
  const periodKey = new Date().toISOString().slice(0, 7);
  const created = [];

  for (const tpl of templates) {
    const exists = await prisma.recurringExpenseLog.findUnique({
      where: { templateId_periodKey: { templateId: tpl.id, periodKey } },
    });
    if (exists) continue;

    const expense = await prisma.$transaction(async (tx) => {
      const code = await expenseService.generateCode(tx);
      const e = await tx.expense.create({
        data: {
          expenseCode: code,
          date: new Date(),
          categoryId: tpl.categoryId,
          vendorId: tpl.vendorId,
          description: `${tpl.description} (${periodKey})`,
          amount: tpl.amount,
          taxRateId: tpl.taxRateId,
          taxAmount: tpl.taxAmount,
          totalAmount: tpl.totalAmount,
          paymentMethod: tpl.paymentMethod,
          status: "DRAFT",
          parentTemplateId: tpl.id,
          createdById: tpl.createdById,
        },
      });
      await tx.recurringExpenseLog.create({
        data: { templateId: tpl.id, periodKey, expenseId: e.id },
      });
      return e;
    });
    created.push(expense);
    try {
      const notif = require("../notifications/notification.service");
      await notif.notifyExpensePending(expense);
    } catch (_) {}
  }
  return created;
};

module.exports = {
  createIfNotExists,
  fromReturnRefund,
  fromDebtPayment,
  fromPayrollLock,
  generateRecurring,
};
