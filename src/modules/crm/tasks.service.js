// src/modules/crm/tasks.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const notif = require("../notifications/notification.service");

const TASK_SELECT = {
  id: true,
  customerId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, phone: true } },
  assignedTo: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
};

const list = async ({
  page = 1,
  limit = 20,
  status,
  priority,
  assignedTo,
  customerId,
  overdue,
} = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (assignedTo) where.assignedToId = assignedTo;
  if (customerId) where.customerId = customerId;
  if (overdue === "1" || overdue === true || overdue === "true") {
    where.dueAt = { lt: new Date() };
    where.status = where.status || { notIn: ["DONE", "CANCELLED"] };
  }

  const [tasks, total] = await Promise.all([
    prisma.customerTask.findMany({
      where,
      select: TASK_SELECT,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.customerTask.count({ where }),
  ]);

  return {
    tasks,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const create = async (data, userId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
    select: { id: true },
  });
  if (!customer) {
    const err = new Error("Khách hàng không tồn tại");
    err.status = 404;
    throw err;
  }
  const assignee = await prisma.user.findUnique({
    where: { id: data.assignedToId },
    select: { id: true, isActive: true },
  });
  if (!assignee || !assignee.isActive) {
    const err = new Error("Người được giao không hợp lệ");
    err.status = 400;
    throw err;
  }

  const task = await prisma.customerTask.create({
    data: {
      customerId: data.customerId,
      title: data.title,
      description: data.description || null,
      priority: data.priority || "NORMAL",
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      assignedToId: data.assignedToId,
      createdById: userId,
    },
    select: TASK_SELECT,
  });

  auditService.log({
    userId,
    action: "CREATE_CUSTOMER_TASK",
    entity: "CustomerTask",
    entityId: task.id,
    after: { customerId: task.customerId, title: task.title, assignedToId: data.assignedToId },
  });

  // Thông báo realtime cho người được giao
  if (data.assignedToId !== userId) {
    await notif.createOne({
      type: "SYSTEM",
      severity: "INFO",
      title: "Bạn có nhiệm vụ CSKH mới",
      message: `${task.title} — KH: ${task.customer?.name || ""}`,
      link: `/crm/tasks`,
      userId: data.assignedToId,
      meta: { taskId: task.id, customerId: task.customerId },
    }).catch(() => null);
  }

  return task;
};

const update = async (id, data, userId) => {
  const before = await prisma.customerTask.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assignedToId: true,
      dueAt: true,
    },
  });
  if (!before) {
    const err = new Error("Nhiệm vụ không tồn tại");
    err.status = 404;
    throw err;
  }

  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.dueAt !== undefined) patch.dueAt = data.dueAt ? new Date(data.dueAt) : null;
  if (data.assignedToId !== undefined) patch.assignedToId = data.assignedToId;
  if (data.status !== undefined) {
    patch.status = data.status;
    if (data.status === "DONE" && before.status !== "DONE") {
      patch.completedAt = new Date();
    }
    if (data.status !== "DONE" && before.status === "DONE") {
      patch.completedAt = null;
    }
  }

  const updated = await prisma.customerTask.update({
    where: { id },
    data: patch,
    select: TASK_SELECT,
  });

  auditService.log({
    userId,
    action: "UPDATE_CUSTOMER_TASK",
    entity: "CustomerTask",
    entityId: id,
    before: {
      status: before.status,
      priority: before.priority,
      assignedToId: before.assignedToId,
    },
    after: {
      status: updated.status,
      priority: updated.priority,
      assignedToId: updated.assignedTo?.id,
    },
  });

  // Khi chuyển người được giao -> báo người mới
  if (
    data.assignedToId &&
    data.assignedToId !== before.assignedToId &&
    data.assignedToId !== userId
  ) {
    await notif.createOne({
      type: "SYSTEM",
      severity: "INFO",
      title: "Nhiệm vụ CSKH được chuyển cho bạn",
      message: `${updated.title} — KH: ${updated.customer?.name || ""}`,
      link: `/crm/tasks`,
      userId: data.assignedToId,
      meta: { taskId: id },
    }).catch(() => null);
  }

  return updated;
};

const remove = async (id, userId) => {
  const task = await prisma.customerTask.findUnique({
    where: { id },
    select: { id: true, customerId: true, title: true },
  });
  if (!task) {
    const err = new Error("Nhiệm vụ không tồn tại");
    err.status = 404;
    throw err;
  }
  await prisma.customerTask.delete({ where: { id } });

  auditService.log({
    userId,
    action: "DELETE_CUSTOMER_TASK",
    entity: "CustomerTask",
    entityId: id,
    before: { customerId: task.customerId, title: task.title },
  });
  return { id };
};

const myTasks = async (userId, opts = {}) =>
  list({ ...opts, assignedTo: userId });

const overdueCountForUser = async (userId) => {
  const n = await prisma.customerTask.count({
    where: {
      assignedToId: userId,
      status: { notIn: ["DONE", "CANCELLED"] },
      dueAt: { lt: new Date() },
    },
  });
  return { count: n };
};

// Cron job: nhắc nhiệm vụ tới hạn / quá hạn
const cronRemindUpcoming = async () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await prisma.customerTask.findMany({
    where: {
      status: { notIn: ["DONE", "CANCELLED"] },
      dueAt: { not: null, lte: tomorrow },
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      assignedToId: true,
      customer: { select: { name: true } },
    },
    take: 500,
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let sent = 0;
  for (const t of tasks) {
    const exists = await prisma.notification.findFirst({
      where: {
        type: "SYSTEM",
        userId: t.assignedToId,
        createdAt: { gte: startOfDay },
        meta: { path: ["taskId"], equals: t.id },
      },
    });
    if (exists) continue;
    const overdue = t.dueAt && t.dueAt < now;
    await notif.createOne({
      type: "SYSTEM",
      severity: overdue ? "WARNING" : "INFO",
      title: overdue ? "Nhiệm vụ quá hạn" : "Nhiệm vụ sắp tới hạn",
      message: `${t.title} — KH: ${t.customer?.name || ""}`,
      link: `/crm/tasks`,
      userId: t.assignedToId,
      meta: { taskId: t.id, reminder: true },
    }).catch(() => null);
    sent += 1;
  }
  return sent;
};

module.exports = {
  list,
  create,
  update,
  remove,
  myTasks,
  overdueCountForUser,
  cronRemindUpcoming,
};
