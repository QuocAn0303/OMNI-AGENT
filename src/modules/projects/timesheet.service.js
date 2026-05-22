// src/modules/projects/timesheet.service.js
const prisma = require("../../config/prisma");

const toNum = (v) => Number(v || 0);

const listEntries = async ({ projectId, userId, invoiced, page = 1, limit = 50 } = {}) => {
  const where = {};
  if (projectId) where.projectId = projectId;
  if (userId) where.userId = userId;
  if (invoiced !== undefined) where.invoiced = invoiced === "true" || invoiced === true;

  const [entries, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      include: {
        user: { select: { fullName: true } },
        task: { select: { title: true } },
      },
      orderBy: { startTime: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.timeEntry.count({ where }),
  ]);
  return { entries, pagination: { page: Number(page), limit: Number(limit), total } };
};

const createEntry = async (userId, { projectId, taskId, startTime, endTime, hours, description, billable = true, hourlyRate = 0 }) => {
  if (!projectId || !startTime) throw { status: 400, message: "Cần projectId và startTime" };

  let computedHours = hours;
  if (!computedHours && endTime) {
    const ms = new Date(endTime) - new Date(startTime);
    computedHours = Math.round(ms / 36000) / 100; // hours, 2dp
  }

  return prisma.timeEntry.create({
    data: {
      projectId, taskId: taskId || null, userId,
      startTime: new Date(startTime),
      endTime: endTime ? new Date(endTime) : null,
      hours: computedHours ? Number(computedHours) : null,
      description, billable, hourlyRate: Number(hourlyRate),
    },
    include: { task: { select: { title: true } } },
  });
};

const updateEntry = async (id, userId, data) => {
  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
  if (entry.invoiced) throw { status: 400, message: "Không sửa timesheet đã xuất hóa đơn" };
  return prisma.timeEntry.update({ where: { id }, data });
};

const deleteEntry = async (id) => {
  const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
  if (entry.invoiced) throw { status: 400, message: "Không xóa timesheet đã xuất hóa đơn" };
  return prisma.timeEntry.delete({ where: { id } });
};

// --- Project Invoicing ---
const listInvoices = (projectId) =>
  prisma.projectInvoice.findMany({
    where: { projectId },
    include: { customer: { select: { name: true } }, _count: { select: { timeEntries: true } } },
    orderBy: { createdAt: "desc" },
  });

const generateInvoice = async (projectId, { customerId, dueDate, notes, entryIds, userId }) => {
  const entries = await prisma.timeEntry.findMany({
    where: entryIds ? { id: { in: entryIds } } : { projectId, billable: true, invoiced: false },
  });
  if (!entries.length) throw { status: 400, message: "Không có timesheet billable chưa xuất hóa đơn" };

  const amount = entries.reduce((s, e) => s + toNum(e.hours) * toNum(e.hourlyRate), 0);
  const code = `PINV-${Date.now().toString(36).toUpperCase()}`;

  return prisma.$transaction(async (tx) => {
    const inv = await tx.projectInvoice.create({
      data: {
        invoiceCode: code,
        projectId,
        customerId: customerId || null,
        amount,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes,
        timeEntries: { connect: entries.map((e) => ({ id: e.id })) },
      },
    });
    await tx.timeEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { invoiced: true, invoiceId: inv.id },
    });
    return inv;
  });
};

const updateInvoiceStatus = async (id, status) => {
  if (!["DRAFT", "SENT", "PAID", "CANCELLED"].includes(status)) throw { status: 400, message: "Status không hợp lệ" };
  return prisma.projectInvoice.update({
    where: { id },
    data: { status, issuedAt: status === "SENT" ? new Date() : undefined },
  });
};

module.exports = { listEntries, createEntry, updateEntry, deleteEntry, listInvoices, generateInvoice, updateInvoiceStatus };
