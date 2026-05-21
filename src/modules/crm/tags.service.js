// src/modules/crm/tags.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const TAG_SELECT = {
  id: true,
  name: true,
  color: true,
  createdAt: true,
  _count: { select: { customers: true } },
};

const list = async () => {
  return prisma.customerTag.findMany({
    select: TAG_SELECT,
    orderBy: { name: "asc" },
  });
};

const create = async (data, userId) => {
  const name = data.name.trim();
  const existed = await prisma.customerTag.findUnique({ where: { name } });
  if (existed) {
    const err = new Error("Tên tag đã tồn tại");
    err.status = 400;
    throw err;
  }
  const tag = await prisma.customerTag.create({
    data: { name, color: data.color || "#0f766e" },
    select: TAG_SELECT,
  });

  auditService.log({
    userId,
    action: "CREATE_CUSTOMER_TAG",
    entity: "CustomerTag",
    entityId: tag.id,
    after: { name: tag.name, color: tag.color },
  });

  return tag;
};

const update = async (id, data, userId) => {
  const before = await prisma.customerTag.findUnique({ where: { id } });
  if (!before) {
    const err = new Error("Tag không tồn tại");
    err.status = 404;
    throw err;
  }
  if (data.name) {
    const dup = await prisma.customerTag.findFirst({
      where: { name: data.name.trim(), NOT: { id } },
    });
    if (dup) {
      const err = new Error("Tên tag đã tồn tại");
      err.status = 400;
      throw err;
    }
  }
  const updated = await prisma.customerTag.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.color !== undefined && { color: data.color }),
    },
    select: TAG_SELECT,
  });

  auditService.log({
    userId,
    action: "UPDATE_CUSTOMER_TAG",
    entity: "CustomerTag",
    entityId: id,
    before: { name: before.name, color: before.color },
    after: { name: updated.name, color: updated.color },
  });

  return updated;
};

const remove = async (id, userId) => {
  const tag = await prisma.customerTag.findUnique({ where: { id } });
  if (!tag) {
    const err = new Error("Tag không tồn tại");
    err.status = 404;
    throw err;
  }
  await prisma.customerTag.delete({ where: { id } });

  auditService.log({
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
  await ensureCustomer(customerId);
  const tag = await prisma.customerTag.findUnique({ where: { id: tagId } });
  if (!tag) {
    const err = new Error("Tag không tồn tại");
    err.status = 404;
    throw err;
  }

  await prisma.customerTagOnCustomer.upsert({
    where: { customerId_tagId: { customerId, tagId } },
    create: { customerId, tagId },
    update: {},
  });

  auditService.log({
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

  auditService.log({
    userId,
    action: "UNASSIGN_CUSTOMER_TAG",
    entity: "Customer",
    entityId: customerId,
    before: { tagId },
  });

  return { customerId, tagId };
};

const listByCustomer = async (customerId) => {
  return prisma.customerTagOnCustomer.findMany({
    where: { customerId },
    select: { tag: { select: { id: true, name: true, color: true } } },
  }).then((rows) => rows.map((r) => r.tag));
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
