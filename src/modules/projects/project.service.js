/**
 * modules/projects/project.service.js — Service quản lý Dự án
 *
 * Tổng quan:
 * - Cung cấp logic nghiệp vụ CRUD dự án, thống kê, báo cáo tài chính
 * - State machine: DRAFT → ACTIVE → ON_HOLD → COMPLETED → ARCHIVED
 * - Tích hợp auditService để ghi log
 * - Hỗ trợ phân trang, tìm kiếm, lọc theo trạng thái
 *
 * Hàm:
 * - generateCode(): Sinh mã dự án PRJ- + timestamp + random
 * - list({ page, limit, status, search }): Liệt kê dự án phân trang, tìm theo name/code
 * - overview(): Thống kê total, active, completed, overdue
 * - getById(id): Chi tiết dự án kèm members
 * - getStats(id): Thống kê tasks: total, done, inProgress, overdue, byPriority, progress%
 * - getFinancial(id, { page, limit }): Budget vs Actual, paid/pending, variance, danh sách expenses
 * - create(data, userId): Tạo dự án, thêm creator làm OWNER member
 * - update(id, data, userId): Cập nhật, kiểm tra state machine khi đổi status
 * - remove(id, userId): Xóa dự án (hard delete)
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

// State machine — chỉ cho phép các chuyển đổi trạng thái hợp lý
const ALLOWED_TRANSITIONS = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "ARCHIVED"],
  ON_HOLD: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [], // terminal
};

const PROJECT_LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  status: true,
  startDate: true,
  endDate: true,
  budget: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { tasks: true, members: true } },
};

const PROJECT_DETAIL_SELECT = {
  ...PROJECT_LIST_SELECT,
  members: {
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
    orderBy: { createdAt: "asc" },
  },
};

const generateCode = () => {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `PRJ-${ts}${rand}`;
};

const list = async ({ page = 1, limit = 20, status, search } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  const where = {};
  if (status) where.status = status;
  if (search && search.trim()) {
    const s = search.trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      { code: { contains: s, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: PROJECT_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    items,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const overview = async () => {
  const now = new Date();
  const [total, active, completed, overdue] = await Promise.all([
    prisma.project.count(),
    prisma.project.count({ where: { status: "ACTIVE" } }),
    prisma.project.count({ where: { status: "COMPLETED" } }),
    prisma.project.count({
      where: {
        status: { in: ["DRAFT", "ACTIVE", "ON_HOLD"] },
        endDate: { lt: now, not: null },
      },
    }),
  ]);
  return { total, active, completed, overdue };
};

const getById = async (id) => {
  const project = await prisma.project.findUnique({
    where: { id },
    select: PROJECT_DETAIL_SELECT,
  });
  if (!project) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }
  return project;
};

const getStats = async (id) => {
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!project) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }

  const now = new Date();
  const [total, done, inProgress, overdue, byPriority] = await Promise.all([
    prisma.projectTask.count({ where: { projectId: id } }),
    prisma.projectTask.count({ where: { projectId: id, status: "DONE" } }),
    prisma.projectTask.count({ where: { projectId: id, status: "IN_PROGRESS" } }),
    prisma.projectTask.count({
      where: {
        projectId: id,
        status: { notIn: ["DONE", "CANCELLED"] },
        dueDate: { lt: now, not: null },
      },
    }),
    prisma.projectTask.groupBy({
      by: ["priority"],
      where: { projectId: id },
      _count: { _all: true },
    }),
  ]);

  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  return {
    totalTasks: total,
    doneTasks: done,
    inProgressTasks: inProgress,
    overdueTasks: overdue,
    progress,
    byPriority: byPriority.reduce((acc, x) => {
      acc[x.priority] = x._count._all;
      return acc;
    }, {}),
  };
};

const create = async (data, userId) => {
  const project = await prisma.project.create({
    data: {
      code: generateCode(),
      name: data.name,
      description: data.description || null,
      status: data.status || "DRAFT",
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      budget: data.budget != null ? data.budget : null,
      createdById: userId,
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
    select: PROJECT_DETAIL_SELECT,
  });

  auditService.log({
    userId,
    action: "CREATE_PROJECT",
    entity: "Project",
    entityId: project.id,
    after: { code: project.code, name: project.name, status: project.status },
  });

  return project;
};

const update = async (id, data, userId) => {
  const before = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, startDate: true, endDate: true, budget: true },
  });
  if (!before) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }

  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.status !== undefined) {
    if (data.status !== before.status) {
      const allowed = ALLOWED_TRANSITIONS[before.status] || [];
      if (!allowed.includes(data.status)) {
        const err = new Error(
          `Không thể chuyển dự án từ ${before.status} sang ${data.status}`
        );
        err.status = 400;
        throw err;
      }
    }
    patch.status = data.status;
  }
  if (data.startDate !== undefined)
    patch.startDate = data.startDate ? new Date(data.startDate) : null;
  if (data.endDate !== undefined)
    patch.endDate = data.endDate ? new Date(data.endDate) : null;
  if (data.budget !== undefined) patch.budget = data.budget;

  const updated = await prisma.project.update({
    where: { id },
    data: patch,
    select: PROJECT_DETAIL_SELECT,
  });

  auditService.log({
    userId,
    action: "UPDATE_PROJECT",
    entity: "Project",
    entityId: id,
    before: { name: before.name, status: before.status },
    after: { name: updated.name, status: updated.status },
  });

  return updated;
};

const remove = async (id, userId) => {
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, code: true, name: true },
  });
  if (!project) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }

  await prisma.project.delete({ where: { id } });

  auditService.log({
    userId,
    action: "DELETE_PROJECT",
    entity: "Project",
    entityId: id,
    before: { code: project.code, name: project.name },
  });

  return { id };
};

/**
 * Báo cáo tài chính của dự án: Budget vs Actual + danh sách expense
 *
 * @param {string} id - projectId
 * @param {object} opts - { page=1, limit=20 } cho danh sách expense
 */
const getFinancial = async (id, { page = 1, limit = 20 } = {}) => {
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, budget: true, status: true },
  });
  if (!project) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }

  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  // Tổng chi phí thực tế (tính cả DRAFT/APPROVED/PAID, chỉ trừ CANCELLED)
  const agg = await prisma.expense.aggregate({
    where: { projectId: id, status: { not: "CANCELLED" } },
    _sum: { totalAmount: true },
    _count: { _all: true },
  });
  const actualCost = Number(agg._sum.totalAmount || 0);

  // Tách thành 2 nhóm: đã chi (PAID) và chưa chi
  const paidAgg = await prisma.expense.aggregate({
    where: { projectId: id, status: "PAID" },
    _sum: { totalAmount: true },
  });
  const paidCost = Number(paidAgg._sum.totalAmount || 0);

  // Danh sách expense paginated
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where: { projectId: id },
      select: {
        id: true,
        expenseCode: true,
        date: true,
        description: true,
        amount: true,
        taxAmount: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        category: { select: { id: true, code: true, name: true } },
        vendor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { date: "desc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.expense.count({ where: { projectId: id } }),
  ]);

  const budget = Number(project.budget || 0);
  const variance = budget - actualCost; // dương = còn budget, âm = vượt
  const utilization = budget > 0 ? Math.round((actualCost / budget) * 100) : 0;

  return {
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
    },
    summary: {
      budget,
      actualCost,
      paidCost,
      pendingCost: actualCost - paidCost,
      variance,
      utilization,
      isOverBudget: budget > 0 && actualCost > budget,
      expenseCount: agg._count._all,
    },
    expenses,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

module.exports = { list, overview, getById, getStats, getFinancial, create, update, remove };
