/**
 * modules/warehouses/warehouse.service.js — Service quản lý kho hàng
 * 
 * Tổng quan:
 * - CRUD kho hàng, quản lý kho mặc định, clear cache khi thay đổi
 * 
 * Hàm:
 * - list(): Lấy danh sách kho đang hoạt động, ưu tiên kho mặc định lên đầu
 * - create(data, userId): Tạo kho mới, nếu isDefault thì reset các kho khác, ghi audit log
 * - update(id, data, userId): Cập nhật kho, nếu isDefault thì reset các kho khác, clear cache, ghi audit log
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const { clearWarehouseCache } = require("../../utils/warehouse.helper");
const { getTenantId } = require("../../config/tenantContext");

const list = async () =>
  prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

const resetOtherDefault = async (excludeId) => {
  const tenantId = getTenantId();
  if (!tenantId) return;
  await prisma.warehouse.updateMany({
    where: { tenantId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    data: { isDefault: false },
  });
  clearWarehouseCache();
};

const create = async (data, userId) => {
  if (data.isDefault) {
    await resetOtherDefault();
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
    await resetOtherDefault(id);
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
