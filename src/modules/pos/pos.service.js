const prisma = require("../../config/prisma");

const BASE_SELECT = {
  id: true, sku: true, name: true, imageUrl: true, price: true, unit: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
};

const listProducts = (warehouseId) => {
  const where = { isActive: true };
  if (warehouseId) {
    where.inventories = { some: { warehouseId } };
  }
  return prisma.product.findMany({
    where,
    select: {
      ...BASE_SELECT,
      inventories: {
        select: { quantity: true, reserved: true, minStock: true },
        where: warehouseId ? { warehouseId } : {},
      },
    },
    orderBy: { name: "asc" },
  }).then((products) =>
    products.map((p) => {
      const inv = p.inventories?.[0] || { quantity: 0, reserved: 0, minStock: 0 };
      delete p.inventories;
      return { ...p, inventory: inv };
    })
  );
};

const findBySku = (sku) =>
  prisma.product.findFirst({
    where: { sku, isActive: true },
    select: {
      ...BASE_SELECT,
      inventories: {
        select: { quantity: true, reserved: true, minStock: true },
      },
    },
  }).then((p) => {
    if (!p) return null;
    const inv = p.inventories?.[0] || { quantity: 0, reserved: 0, minStock: 0 };
    delete p.inventories;
    return { ...p, inventory: inv };
  });

const listCategories = () =>
  prisma.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

module.exports = { listProducts, findBySku, listCategories };
