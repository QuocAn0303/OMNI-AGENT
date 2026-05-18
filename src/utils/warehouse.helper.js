const prisma = require("../config/prisma");

let cachedDefaultWarehouseId = null;

const getDefaultWarehouseId = async (tx = prisma) => {
  if (process.env.DEFAULT_WAREHOUSE_ID) return process.env.DEFAULT_WAREHOUSE_ID;
  if (cachedDefaultWarehouseId) return cachedDefaultWarehouseId;
  const wh = await tx.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (!wh) throw { status: 500, message: "Chưa cấu hình kho mặc định" };
  cachedDefaultWarehouseId = wh.id;
  return wh.id;
};

const resolveWarehouseId = async (warehouseId, tx = prisma) =>
  warehouseId || (await getDefaultWarehouseId(tx));

const findInventory = async (tx, productId, warehouseId) => {
  const whId = await resolveWarehouseId(warehouseId, tx);
  return tx.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId: whId } },
  });
};

const attachDefaultInventory = (product, inventory) => ({
  ...product,
  inventory: inventory || null,
});

module.exports = {
  getDefaultWarehouseId,
  resolveWarehouseId,
  findInventory,
  attachDefaultInventory,
  clearWarehouseCache: () => {
    cachedDefaultWarehouseId = null;
  },
};
