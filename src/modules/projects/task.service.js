// src/modules/projects/task.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const notif = require("../notifications/notification.service");

const TASK_SELECT = {
  id: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
};

const ensureProject = async (projectId) => {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!p) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }
  return p;
};

const list = async (projectId, { page = 1, limit = 50, status, priority, assigneeId } = {}) => {
  await ensureProject(projectId);
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 50);

  const where = { projectId };
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (assigneeId) where.assigneeId = assigneeId;

  const [tasks, total] = await Promise.all([
    prisma.projectTask.findMany({
      where,
      select: TASK_SELECT,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.projectTask.count({ where }),
  ]);

  return {
    tasks,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const create = async (projectId, data, userId) => {
  const project = await ensureProject(projectId);

  if (data.assigneeId) {
    const u = await prisma.user.findUnique({
      where: { id: data.assigneeId },
      select: { id: true, isActive: true },
    });
    if (!u || !u.isActive) {
      const err = new Error("Người được giao không hợp lệ");
      err.status = 400;
      throw err;
    }
  }

  const task = await prisma.projectTask.create({
    data: {
      projectId,
      title: data.title,
      description: data.description || null,
      status: data.status || "TODO",
      priority: data.priority || "MEDIUM",
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      assigneeId: data.assigneeId || null,
      createdById: userId,
    },
    select: TASK_SELECT,
  });

  auditService.log({
    userId,
    action: "CREATE_PROJECT_TASK",
    entity: "ProjectTask",
    entityId: task.id,
    after: { projectId, title: task.title, assigneeId: data.assigneeId || null },
  });

  if (data.assigneeId && data.assigneeId !== userId) {
    await notif
      .createOne({
        type: "SYSTEM",
        severity: "INFO",
        title: "Bạn có công việc dự án mới",
        message: `${task.title} — Dự án: ${project.name}`,
        link: `/projects/${projectId}`,
        userId: data.assigneeId,
        meta: { projectTaskId: task.id, projectId },
      })
      .catch(() => null);
  }

  return task;
};

const update = async (taskId, data, userId) => {
  const before = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      project: { select: { name: true } },
    },
  });
  if (!before) {
    const err = new Error("Công việc không tồn tại");
    err.status = 404;
    throw err;
  }

  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.status !== undefined) patch.status = data.status;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.dueDate !== undefined)
    patch.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.assigneeId !== undefined) {
    if (data.assigneeId) {
      const u = await prisma.user.findUnique({
        where: { id: data.assigneeId },
        select: { id: true, isActive: true },
      });
      if (!u || !u.isActive) {
        const err = new Error("Người được giao không hợp lệ");
        err.status = 400;
        throw err;
      }
    }
    patch.assigneeId = data.assigneeId || null;
  }

  const updated = await prisma.projectTask.update({
    where: { id: taskId },
    data: patch,
    select: TASK_SELECT,
  });

  auditService.log({
    userId,
    action: "UPDATE_PROJECT_TASK",
    entity: "ProjectTask",
    entityId: taskId,
    before: {
      status: before.status,
      priority: before.priority,
      assigneeId: before.assigneeId,
    },
    after: {
      status: updated.status,
      priority: updated.priority,
      assigneeId: updated.assignee?.id || null,
    },
  });

  if (
    data.assigneeId &&
    data.assigneeId !== before.assigneeId &&
    data.assigneeId !== userId
  ) {
    await notif
      .createOne({
        type: "SYSTEM",
        severity: "INFO",
        title: "Công việc dự án được chuyển cho bạn",
        message: `${updated.title} — Dự án: ${before.project?.name || ""}`,
        link: `/projects/${before.projectId}`,
        userId: data.assigneeId,
        meta: { projectTaskId: taskId, projectId: before.projectId },
      })
      .catch(() => null);
  }

  return updated;
};

const remove = async (taskId, userId) => {
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, title: true },
  });
  if (!task) {
    const err = new Error("Công việc không tồn tại");
    err.status = 404;
    throw err;
  }

  await prisma.projectTask.delete({ where: { id: taskId } });

  auditService.log({
    userId,
    action: "DELETE_PROJECT_TASK",
    entity: "ProjectTask",
    entityId: taskId,
    before: { projectId: task.projectId, title: task.title },
  });

  return { id: taskId };
};

module.exports = { list, create, update, remove };
