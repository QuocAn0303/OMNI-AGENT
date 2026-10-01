/**
 * modules/crm/tags.service.js — Service thẻ khách hàng
 * 
 * Tổng quan:
 * - CRUD thẻ (CustomerTag) và quản lý gán/gỡ thẻ cho khách hàng (CustomerTagOnCustomer).
 * - Hỗ trợ phân tách tenant (cách ly dữ liệu giữa các cửa hàng).
 * - Ghi audit log cho mọi thao tác.
 * 
 * Hàm:
 * - getTenantId(userId): Lấy tenantId từ user để cách ly dữ liệu.
 * - list(userId): Danh sách tag thuộc tenant của user.
 * - create(data, userId): Tạo tag mới; kiểm tra trùng tên trong cùng tenant.
 * - update(id, data, userId): Cập nhật tag; kiểm tra trùng tên.
 * - remove(id, userId): Xóa tag (kiểm tra tenant).
 * - ensureCustomer(customerId): Kiểm tra khách hàng tồn tại.
 * - assign(customerId, tagId, userId): Gán tag cho khách hàng (upsert, tránh trùng).
 * - unassign(customerId, tagId, userId): Gỡ tag khỏi khách hàng.
 * - listByCustomer(customerId): Danh sách tag của một khách hàng.
 */
// src/modules/crm/tags.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const TAG_SELECT = {
  id: true,
  name: true,
  color: true,
  category: true,
  createdAt: true,
  _count: { select: { customers: true } },
};

// Helper: Tự động lấy tenantId từ userId để cách ly dữ liệu giữa các cửa hàng
const getTenantId = async (userId) => {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true },
  });
  return user?.tenantId || null;
};

const list = async (userId) => {
  const tenantId = await getTenantId(userId);
  return prisma.customerTag.findMany({
    where: { tenantId },
    select: TAG_SELECT,
    orderBy: { name: "asc" },
  });
};

const create = async (data, userId) => {
  const tenantId = await getTenantId(userId);
  const name = data.name.trim();

  // Dùng findFirst an toàn hơn findUnique đối với key kết hợp có thể chứa giá trị null
  const existed = await prisma.customerTag.findFirst({
    where: { name, tenantId },
  });

  if (existed) {
    const err = new Error("Tên tag đã tồn tại trong hệ thống của bạn");
    err.status = 400;
    throw err;
  }

  const tag = await prisma.customerTag.create({
    data: {
      name,
      color: data.color || "#0f766e",
      category: data.category || "GENERAL",
      tenantId,
    },
    select: TAG_SELECT,
  });

  await auditService.log({
    userId,
    action: "CREATE_CUSTOMER_TAG",
    entity: "CustomerTag",
    entityId: tag.id,
    after: { name: tag.name, color: tag.color, category: tag.category },
  });

  return tag;
};

const update = async (id, data, userId) => {
  const tenantId = await getTenantId(userId);

  const before = await prisma.customerTag.findFirst({
    where: { id, tenantId },
  });

  if (!before) {
    const err = new Error("Tag không tồn tại hoặc bạn không có quyền sửa");
    err.status = 404;
    throw err;
  }

  if (data.name) {
    const name = data.name.trim();
    const dup = await prisma.customerTag.findFirst({
      where: { name, tenantId, NOT: { id } },
    });
    if (dup) {
      const err = new Error("Tên tag đã tồn tại trong hệ thống của bạn");
      err.status = 400;
      throw err;
    }
  }

  const updated = await prisma.customerTag.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.category !== undefined && { category: data.category }),
    },
    select: TAG_SELECT,
  });

  await auditService.log({
    userId,
    action: "UPDATE_CUSTOMER_TAG",
    entity: "CustomerTag",
    entityId: id,
    before: {
      name: before.name,
      color: before.color,
      category: before.category,
    },
    after: {
      name: updated.name,
      color: updated.color,
      category: updated.category,
    },
  });

  return updated;
};

const remove = async (id, userId) => {
  const tenantId = await getTenantId(userId);

  const tag = await prisma.customerTag.findFirst({
    where: { id, tenantId },
  });

  if (!tag) {
    const err = new Error("Tag không tồn tại hoặc bạn không có quyền xóa");
    err.status = 404;
    throw err;
  }

  await prisma.customerTag.delete({ where: { id } });

  await auditService.log({
    userId,
    action: "DELETE_CUSTOMER_TAG",
    entity: "CustomerTag",
    entityId: id,
    before: { name: tag.name },
  });

  return { id };
};

const ensureCustomer = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) {
    const err = new Error("Khách hàng không tồn tại");
    err.status = 404;
    throw err;
  }
};

const assign = async (customerId, tagId, userId) => {
  const tenantId = await getTenantId(userId);
  await ensureCustomer(customerId);

  // Đảm bảo tag này thực sự thuộc về hệ thống của user đang thao tác
  const tag = await prisma.customerTag.findFirst({
    where: { id: tagId, tenantId },
  });

  if (!tag) {
    const err = new Error("Tag không hợp lệ hoặc không thuộc hệ thống của bạn");
    err.status = 404;
    throw err;
  }

  await prisma.customerTagOnCustomer.upsert({
    where: { customerId_tagId: { customerId, tagId } },
    create: { customerId, tagId },
    update: {},
  });

  await auditService.log({
    userId,
    action: "ASSIGN_CUSTOMER_TAG",
    entity: "Customer",
    entityId: customerId,
    after: { tagId, tagName: tag.name },
  });

  return { customerId, tagId };
};

const unassign = async (customerId, tagId, userId) => {
  await prisma.customerTagOnCustomer
    .delete({ where: { customerId_tagId: { customerId, tagId } } })
    .catch(() => null);

  await auditService.log({
    userId,
    action: "UNASSIGN_CUSTOMER_TAG",
    entity: "Customer",
    entityId: customerId,
    before: { tagId },
  });

  return { customerId, tagId };
};

const listByCustomer = async (customerId) => {
  return prisma.customerTagOnCustomer
    .findMany({
      where: { customerId },
      select: {
        tag: { select: { id: true, name: true, color: true, category: true } },
      },
    })
    .then((rows) => rows.map((r) => r.tag));
};

module.exports = {
  list,
  create,
  update,
  remove,
  assign,
  unassign,
  listByCustomer,
};
