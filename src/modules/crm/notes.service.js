/**
 * modules/crm/notes.service.js — Service ghi chú khách hàng
 * 
 * Tổng quan:
 * - CRUD ghi chú (CustomerNote) cho từng khách hàng.
 * - Hỗ trợ nhiều loại ghi chú: NOTE, CALL, EMAIL, MEETING, ZALO.
 * - Ghi audit log cho mọi thao tác.
 * 
 * Hàm:
 * - ensureCustomer(customerId): Kiểm tra khách hàng tồn tại và đang active.
 * - listByCustomer(customerId, {page, limit}): Danh sách ghi chú của khách hàng (phân trang).
 * - create(customerId, data, userId): Tạo ghi chú mới.
 * - update(noteId, data, userId): Cập nhật nội dung/loại ghi chú.
 * - remove(noteId, userId): Xóa ghi chú.
 */
// src/modules/crm/notes.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const NOTE_SELECT = {
  id: true,
  customerId: true,
  content: true,
  type: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true, email: true } },
};

const ensureCustomer = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, isActive: true },
  });
  if (!customer) {
    const err = new Error("Khách hàng không tồn tại");
    err.status = 404;
    throw err;
  }
  return customer;
};

const listByCustomer = async (customerId, { page = 1, limit = 20 } = {}) => {
  await ensureCustomer(customerId);
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  const [notes, total] = await Promise.all([
    prisma.customerNote.findMany({
      where: { customerId },
      select: NOTE_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.customerNote.count({ where: { customerId } }),
  ]);

  return {
    notes,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const create = async (customerId, data, userId) => {
  await ensureCustomer(customerId);
  const note = await prisma.customerNote.create({
    data: {
      customerId,
      content: data.content,
      type: data.type || "NOTE",
      createdById: userId,
    },
    select: NOTE_SELECT,
  });

  await auditService.log({
    userId,
    action: "CREATE_CUSTOMER_NOTE",
    entity: "CustomerNote",
    entityId: note.id,
    after: { customerId, type: note.type },
  });

  return note;
};

const update = async (noteId, data, userId) => {
  const before = await prisma.customerNote.findUnique({
    where: { id: noteId },
    select: { id: true, content: true, type: true, createdById: true },
  });
  if (!before) {
    const err = new Error("Ghi chú không tồn tại");
    err.status = 404;
    throw err;
  }
  const updated = await prisma.customerNote.update({
    where: { id: noteId },
    data: {
      ...(data.content !== undefined && { content: data.content }),
      ...(data.type !== undefined && { type: data.type }),
    },
    select: NOTE_SELECT,
  });

  await auditService.log({
    userId,
    action: "UPDATE_CUSTOMER_NOTE",
    entity: "CustomerNote",
    entityId: noteId,
    before: { content: before.content, type: before.type },
    after: { content: updated.content, type: updated.type },
  });

  return updated;
};

const remove = async (noteId, userId) => {
  const note = await prisma.customerNote.findUnique({
    where: { id: noteId },
    select: { id: true, customerId: true, type: true },
  });
  if (!note) {
    const err = new Error("Ghi chú không tồn tại");
    err.status = 404;
    throw err;
  }

  await prisma.customerNote.delete({ where: { id: noteId } });

  await auditService.log({
    userId,
    action: "DELETE_CUSTOMER_NOTE",
    entity: "CustomerNote",
    entityId: noteId,
    before: { customerId: note.customerId, type: note.type },
  });

  return { id: noteId };
};

module.exports = { listByCustomer, create, update, remove };
