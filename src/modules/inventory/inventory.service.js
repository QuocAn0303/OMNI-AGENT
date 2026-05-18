const prisma = require('../../config/prisma');
const { findInventory, resolveWarehouseId } = require('../../utils/warehouse.helper');

const inventoryService = {
  getByProduct: async (productId, warehouseId) => {
    const inventory = await findInventory(prisma, productId, warehouseId);
    if (!inventory) throw { status: 404, message: "Không tìm thấy thông tin kho của sản phẩm này." };
    const full = await prisma.inventory.findUnique({
      where: { id: inventory.id },
      include: { product: { select: { name: true, sku: true } }, warehouse: true },
    });
    return full;
  },

  listByWarehouse: async (warehouseId) => {
    const whId = await resolveWarehouseId(warehouseId);
    return prisma.inventory.findMany({
      where: { warehouseId: whId, product: { isActive: true } },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });
  },

  importStock: async (data, userId) => {
    const { productId, quantity, note, warehouseId } = data;
    if (!quantity || quantity <= 0) throw { status: 400, message: "Số lượng nhập phải lớn hơn 0" };

    return await prisma.$transaction(async (tx) => {
      const inventory = await findInventory(tx, productId, warehouseId);
      if (!inventory) throw { status: 404, message: "Không tìm thấy thông tin kho của sản phẩm này." };

      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: { increment: quantity } }
      });

      //Ghi nhận chính xác ai nhập kho
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: updatedInventory.id,
          type: "IMPORT",
          quantity: quantity,
          note: note,
          createdById: userId 
        }
      });

      return updatedInventory;
    });
  },

  exportStock: async (data, userId) => {
    const { productId, quantity, note, warehouseId } = data;
    if (!quantity || quantity <= 0) throw { status: 400, message: "Số lượng xuất phải lớn hơn 0" };

    const updatedInventory = await prisma.$transaction(async (tx) => {
      const inventory = await findInventory(tx, productId, warehouseId);
      if (!inventory) throw { status: 404, message: "Không tìm thấy thông tin kho của sản phẩm này." };
      if (inventory.quantity - (inventory.reserved || 0) < quantity) {
        throw { status: 400, message: "Tồn kho không đủ để xuất." };
      }

      const inv = await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: { decrement: quantity } },
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inv.id,
          type: "EXPORT",
          quantity,
          note,
          createdById: userId,
        },
      });

      return inv;
    });

    try {
      const notif = require("../notifications/notification.service");
      await notif.checkAfterExport(productId);
    } catch (_) {}

    return updatedInventory;
  },

  // Truyền thêm userId vào để tracking
  adjustment: async (data, userId) => {
    const { productId, actualQuantity, note, warehouseId } = data;
    if (actualQuantity == null || actualQuantity < 0) throw { status: 400, message: "Số lượng thực tế không được âm" };

    return await prisma.$transaction(async (tx) => {
      const inventory = await findInventory(tx, productId, warehouseId);
      if (!inventory) throw { status: 404, message: "Không tìm thấy thông tin kho của sản phẩm này." };
      if (actualQuantity < (inventory.reserved || 0)) {
        throw { status: 400, message: "Số lượng thực tế không được nhỏ hơn số đang giữ hàng" };
      }

      const diff = actualQuantity - inventory.quantity;

      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: actualQuantity }
      });

      //Ghi nhận chính xác ai kiểm kho
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: 'ADJUSTMENT',
          quantity: diff, 
          note: note,
          createdById: userId 
        }
      });

      return updatedInventory;
    });
  },

  getLowStock: async (threshold = 10) => {
    const inventories = await prisma.inventory.findMany({
      where: { product: { isActive: true } },
      include: { product: { select: { name: true, sku: true, isActive: true } } },
      orderBy: { quantity: 'asc' }
    });
    return inventories
      .map((item) => ({ ...item, available: item.quantity - (item.reserved || 0) }))
      .filter((item) => item.available <= threshold)
      .sort((a, b) => a.available - b.available);
  },

  checkAlerts: async () => {
    const inventories = await prisma.inventory.findMany({
      where: { product: { isActive: true } },
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    const alerts = inventories.map((inv) => ({
      productId: inv.productId,
      name: inv.product?.name,
      sku: inv.product?.sku,
      quantity: inv.quantity,
      reserved: inv.reserved,
      available: inv.quantity - inv.reserved,
      minStock: inv.minStock,
    }));
    return {
      critical: alerts.filter((item) => item.available <= 0),
      warning: alerts.filter((item) => item.available > 0 && item.available <= item.minStock),
    };
  },

  getTransactions: async (query) => {
    const { inventoryId, type } = query;
    // Fix: Ép kiểu an toàn, nếu truyền character (NaN) thì lấy mặc định là 1 và 20
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 20);
    const skip = (page - 1) * limit;
    
    const where = {
      ...(inventoryId && { inventoryId }),
      ...(type && { type })
    };

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        skip,
        take: Number(limit),
        include: { 
          inventory: { include: { product: { select: { name: true, sku: true } } } },
          createdBy: { select: { fullName: true, role: true } } // 👉 Kéo ra tên và quyền của người thao tác
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.inventoryTransaction.count({ where })
    ]);

    return {
      transactions,
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / limit) }
    };
  }
};

module.exports = inventoryService;
