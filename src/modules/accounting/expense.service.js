/**
 * modules/accounting/expense.service.js — Service quản lý chi phí
 * 
 * Tổng quan:
 * - Xử lý toàn bộ logic nghiệp vụ cho module Expense (chi phí doanh nghiệp).
 * - Hỗ trợ luồng: DRAFT → PENDING_APPROVAL → APPROVED → PAID (hoặc REJECTED).
 * - Tích hợp: tự động sinh mã expense, tính thuế, kiểm tra hạn mức duyệt theo role,
 *   cập nhật công nợ vendor, auto-post bút toán kế toán qua autopostService.
 * 
 * Hàm:
 * - generateCode(tx): Sinh mã chi phí dạng EXP-YYYYMMDD-XXXX.
 * - computeAmounts({amount, taxRateId}): Tính taxAmount + totalAmount từ số tiền và thuế suất.
 * - list(query): Danh sách expense có phân trang, lọc theo status/category/vendor/project/ngày.
 * - getById(id): Chi tiết expense.
 * - create(data, userId): Tạo expense mới trong transaction; auto-post nếu APPROVED/PAID.
 * - submit(id, userId): Gửi duyệt — tự động approve nếu dưới ngưỡng auto.
 * - approve(id, userId, {role}): Phê duyệt expense, cập nhật công nợ vendor, auto-post.
 * - markPaid(id, {method, bankAccountId}, userId): Đánh dấu đã thanh toán; auto-post expense hoặc payment entry.
 * - reject(id, userId): Từ chối expense, ghi audit log.
 * - listCategories(): Danh sách danh mục chi phí đang hoạt động.
 * - summary({year, month}): Thống kê tổng chi phí theo danh mục trong kỳ.
 * - requiredRoleForAmount(amount, userRole): Trả danh sách role được duyệt theo hạn mức.
 * - APPROVAL_THRESHOLDS: Ngưỡng duyệt tự động (1tr), quản lý (10tr).
 */
// src/modules/accounting/expense.service.js
const prisma = require("../../config/prisma");
const autopostService = require("./autopost.service");
const postingErrorService = require("./posting-error.service");
const { withUniqueRetry } = require("./journal.service");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const APPROVAL_THRESHOLDS = {
  auto: 1_000_000,
  manager: 10_000_000,
};

const requiredRoleForAmount = (amount, userRole) => {
  const amt = toNum(amount);
  if (amt < APPROVAL_THRESHOLDS.auto) return ["ADMIN", "MANAGER", "CASHIER"];
  if (amt < APPROVAL_THRESHOLDS.manager) return ["ADMIN", "MANAGER"];
  return ["ADMIN"];
};

const generateCode = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await tx.expense.count({ where: { createdAt: { gte: start } } });
  return `EXP-${today}-${String(count + 1).padStart(4, "0")}`;
};

const computeAmounts = async ({ amount, taxRateId }) => {
  const base = round2(toNum(amount));
  let taxAmount = 0;
  if (taxRateId) {
    const tr = await prisma.taxRate.findUnique({ where: { id: taxRateId } });
    if (tr) taxAmount = round2((base * Number(tr.rate)) / 100);
  }
  return { amount: base, taxAmount, totalAmount: round2(base + taxAmount) };
};

const list = async ({ page = 1, limit = 20, status, categoryId, vendorId, projectId, from, to } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (status) where.status = status;
  if (categoryId) where.categoryId = categoryId;
  if (vendorId) where.vendorId = vendorId;
  if (projectId) where.projectId = projectId;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  const [expenses, total, sumAgg] = await Promise.all([
    prisma.expense.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { date: "desc" },
      include: {
        category: { select: { code: true, name: true, accountId: true } },
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        taxRate: true,
        bankAccount: true,
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { totalAmount: true } }),
  ]);
  return {
    expenses,
    summary: { totalAmount: Number(sumAgg._sum.totalAmount || 0) },
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const e = await prisma.expense.findUnique({
    where: { id },
    include: { category: true, vendor: true, taxRate: true, bankAccount: true, createdBy: true, approvedBy: true },
  });
  if (!e) throw { status: 404, message: "Không tìm thấy chi phí" };
  return e;
};

const create = async (data, userId) => {
  // Validate category has linked account before creating expense.
  // Tránh trường hợp post bút toán fail vì account null.
  const category = await prisma.expenseCategory.findUnique({
    where: { id: data.categoryId },
    select: { id: true, name: true, accountId: true },
  });
  if (!category) {
    throw { status: 400, message: "Danh mục chi phí không tồn tại" };
  }
  if (!category.accountId) {
    throw {
      status: 400,
      message: `Danh mục "${category.name}" chưa được gán tài khoản kế toán. Vui lòng cập nhật ở phần Cấu hình.`,
    };
  }

  const { amount, taxAmount, totalAmount } = await computeAmounts(data);

  return withUniqueRetry(() => prisma.$transaction(async (tx) => {
    const code = await generateCode(tx);
    const expense = await tx.expense.create({
      data: {
        expenseCode: code,
        date: data.date ? new Date(data.date) : new Date(),
        categoryId: data.categoryId,
        vendorId: data.vendorId || null,
        projectId: data.projectId || null,
        description: data.description,
        amount,
        taxRateId: data.taxRateId || null,
        taxAmount,
        totalAmount,
        paymentMethod: data.paymentMethod || "CASH",
        bankAccountId: data.bankAccountId || null,
        status: data.status || "DRAFT",
        invoiceNumber: data.invoiceNumber || null,
        invoiceUrl: data.invoiceUrl || null,
        paidAt: data.status === "PAID" ? new Date() : null,
        note: data.note || null,
        isRecurring: !!data.isRecurring,
        recurringRule: data.recurringRule || null,
        parentTemplateId: data.parentTemplateId || null,
        sourceType: data.sourceType || null,
        sourceId: data.sourceId || null,
        createdById: userId,
        approvedById: data.status === "APPROVED" || data.status === "PAID" ? userId : null,
      },
      include: { category: true, vendor: true },
    });

    // Cập nhật công nợ vendor nếu chưa trả (vẫn trong tx)
    if (expense.status === "APPROVED" && expense.vendorId) {
      await tx.vendor.update({
        where: { id: expense.vendorId },
        data: { totalDebt: { increment: totalAmount } },
      });
    }

    return expense;
  })).then(async (expense) => {
    // Auto-post SAU commit
    if (["APPROVED", "PAID"].includes(expense.status)) {
      const postingPayload = autopostService.buildExpenseEntry({
        expense,
        category: expense.category,
        vendor: expense.vendor,
        userId,
      });
      await postingErrorService.tryPostOrQueue(
        () =>
          autopostService.postExpense({
            expense,
            category: expense.category,
            vendor: expense.vendor,
            userId,
          }),
        {
          source: "EXPENSE",
          sourceId: expense.id,
          payload: postingPayload,
        },
      );
    }
    if (expense.status === "PENDING_APPROVAL") {
      try {
        const notif = require("../notifications/notification.service");
        await notif.notifyExpensePending(expense);
      } catch (_) {}
    }
    return expense;
  });
};

const submit = async (id, userId) => {
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) throw { status: 404, message: "Không tìm thấy chi phí" };
  if (expense.status !== "DRAFT") throw { status: 400, message: "Chỉ gửi duyệt từ trạng thái DRAFT" };

  const amt = toNum(expense.totalAmount);
  if (amt < APPROVAL_THRESHOLDS.auto) {
    return approve(id, userId, { role: "CASHIER" });
  }

  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "PENDING_APPROVAL" },
  });
  try {
    const notif = require("../notifications/notification.service");
    await notif.notifyExpensePending(updated);
  } catch (_) {}

  // Trigger workflow engine for EXPENSE_ABOVE workflows
  try {
    const workflowService = require("../workflow/workflow.service");
    await workflowService.trigger("EXPENSE_ABOVE", {
      entityType: "Expense",
      entityId: id,
      data: { amount: amt, expenseId: id, categoryId: expense.categoryId },
    });
  } catch (e) {
    console.error("[expense] workflow trigger error:", e.message);
  }

  return updated;
};

const approve = async (id, userId, { role } = {}) => {
  const updated = await prisma.$transaction(async (tx) => {
    // updateMany với điều kiện để chống concurrent approve
    const r = await tx.expense.updateMany({
      where: { id, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
      data: { status: "APPROVED", approvedById: userId },
    });
    if (r.count === 0) {
      const existing = await tx.expense.findUnique({ where: { id } });
      if (!existing) throw { status: 404, message: "Không tìm thấy chi phí" };
      throw { status: 400, message: "Chi phí đã được xử lý" };
    }
    const expense = await tx.expense.findUnique({
      where: { id },
      include: { category: true, vendor: true },
    });
    if (role) {
      const allowed = requiredRoleForAmount(expense.totalAmount, role);
      if (!allowed.includes(role)) {
        throw { status: 403, message: "Không đủ quyền duyệt chi phí này" };
      }
    }
    if (expense.vendorId) {
      await tx.vendor.update({
        where: { id: expense.vendorId },
        data: { totalDebt: { increment: Number(expense.totalAmount) } },
      });
    }
    return expense;
  });

  const postingPayload = autopostService.buildExpenseEntry({
    expense: updated,
    category: updated.category,
    vendor: updated.vendor,
    userId,
  });
  await postingErrorService.tryPostOrQueue(
    () =>
      autopostService.postExpense({
        expense: updated,
        category: updated.category,
        vendor: updated.vendor,
        userId,
      }),
    {
      source: "EXPENSE",
      sourceId: updated.id,
      payload: postingPayload,
    },
  );

  return updated;
};

const markPaid = async (id, { method = "CASH", bankAccountId } = {}, userId) => {
  const result = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id }, include: { vendor: true } });
    if (!e) throw { status: 404, message: "Không tìm thấy chi phí" };
    if (e.status === "PAID") throw { status: 400, message: "Chi phí đã thanh toán" };

    const wasUnposted = e.status === "DRAFT" || e.status === "PENDING_APPROVAL";

    const r = await tx.expense.updateMany({
      where: { id, status: { not: "PAID" } },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paymentMethod: method,
        bankAccountId: bankAccountId || e.bankAccountId,
      },
    });
    if (r.count === 0) throw { status: 409, message: "Chi phí đã được xử lý bởi tiến trình khác" };

    const updated = await tx.expense.findUnique({
      where: { id },
      include: { category: true, vendor: true },
    });

    if (!wasUnposted && updated.vendorId) {
      // Đã có bút toán phải trả → giảm công nợ
      await tx.vendor.update({
        where: { id: updated.vendorId },
        data: { totalDebt: { decrement: Number(updated.totalAmount) } },
      });
    }
    return { updated, wasUnposted };
  });

  if (result.wasUnposted) {
    const postingPayload = autopostService.buildExpenseEntry({
      expense: result.updated,
      category: result.updated.category,
      vendor: result.updated.vendor,
      userId,
    });
    await postingErrorService.tryPostOrQueue(
      () =>
        autopostService.postExpense({
          expense: result.updated,
          category: result.updated.category,
          vendor: result.updated.vendor,
          userId,
        }),
      { source: "EXPENSE", sourceId: result.updated.id, payload: postingPayload },
    );
  } else {
    const postingPayload = autopostService.buildExpensePaymentEntry({
      expense: result.updated,
      vendor: result.updated.vendor,
      userId,
    });
    await postingErrorService.tryPostOrQueue(
      () =>
        autopostService.postExpensePayment({
          expense: result.updated,
          vendor: result.updated.vendor,
          userId,
        }),
      { source: "EXPENSE", sourceId: result.updated.id, payload: postingPayload },
    );
  }

  return result.updated;
};

const reject = async (id, userId) => {
  const auditService = require("../audit/audit.service");
  const before = await prisma.expense.findUnique({
    where: { id },
    select: { status: true, expenseCode: true },
  });
  if (!before) throw { status: 404, message: "Không tìm thấy chi phí" };
  if (["PAID", "REJECTED"].includes(before.status)) {
    throw { status: 400, message: "Không thể từ chối chi phí ở trạng thái này" };
  }
  const updated = await prisma.expense.update({
    where: { id },
    data: { status: "REJECTED", approvedById: userId },
  });
  auditService.log({
    userId,
    action: "REJECT_EXPENSE",
    entity: "Expense",
    entityId: id,
    before: { status: before.status, expenseCode: before.expenseCode },
    after: { status: "REJECTED" },
  });
  return updated;
};

const listCategories = async () => {
  return prisma.expenseCategory.findMany({
    where: { isActive: true },
    include: { account: { select: { code: true, name: true, nameVi: true } } },
    orderBy: { code: "asc" },
  });
};

const summary = async ({ year, month } = {}) => {
  const y = Number(year) || new Date().getFullYear();
  const m = month ? Number(month) : null;
  const from = m ? new Date(y, m - 1, 1) : new Date(y, 0, 1);
  const to = m ? new Date(y, m, 0, 23, 59, 59) : new Date(y, 11, 31, 23, 59, 59);

  const rows = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: { date: { gte: from, lte: to }, status: { in: ["APPROVED", "PAID"] } },
    _sum: { totalAmount: true },
    _count: true,
  });
  const cats = await prisma.expenseCategory.findMany({
    where: { id: { in: rows.map((r) => r.categoryId) } },
    select: { id: true, code: true, name: true },
  });
  const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
  return {
    period: { year: y, month: m, from, to },
    byCategory: rows.map((r) => ({
      category: catMap[r.categoryId],
      total: Number(r._sum.totalAmount || 0),
      count: r._count,
    })),
    grandTotal: rows.reduce((s, r) => s + Number(r._sum.totalAmount || 0), 0),
  };
};

module.exports = {
  list,
  getById,
  create,
  submit,
  approve,
  markPaid,
  reject,
  listCategories,
  summary,
  generateCode,
  requiredRoleForAmount,
  APPROVAL_THRESHOLDS,
};
