const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const { clearWarehouseCache } = require("../../utils/warehouse.helper");

const list = async () =>
  prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

const create = async (data, userId) => {
  if (data.isDefault) {
    await prisma.warehouse.updateMany({ data: { isDefault: false } });
    clearWarehouseCache();
  }
  const wh = await prisma.warehouse.create({ data });
  await auditService.log({
    userId,
    action: "CREATE_WAREHOUSE",
    entity: "Warehouse",
    entityId: wh.id,
    after: { code: wh.code, name: wh.name },
  });
  return wh;
};

const update = async (id, data, userId) => {
  if (data.isDefault) {
    await prisma.warehouse.updateMany({
      where: { id: { not: id } },
      data: { isDefault: false },
    });
    clearWarehouseCache();
  }
  const wh = await prisma.warehouse.update({ where: { id }, data });
  await auditService.log({
    userId,
    action: "UPDATE_WAREHOUSE",
    entity: "Warehouse",
    entityId: id,
    after: data,
  });
  return wh;
};

module.exports = { list, create, update };
