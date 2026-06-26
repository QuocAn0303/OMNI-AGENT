/**
 * modules/inventory/inventory.service.js — Service quản lý tồn kho
 * 
 * Tổng quan:
 * - Quản lý nhập/xuất/kiểm kho, cảnh báo tồn thấp, xem lịch sử giao dịch
 * - Mọi thao tác đều ghi InventoryTransaction kèm userId
 * 
 * Hàm:
 * - getByProduct(productId, warehouseId): Lấy thông tin tồn kho của 1 sản phẩm theo warehouse
 * - listByWarehouse(warehouseId): Liệt kê tồn kho theo warehouse, chỉ lấy sản phẩm đang active
 * - importStock({productId, quantity, note, warehouseId}, userId): Nhập kho — tăng quantity, ghi giao dịch IMPORT trong transaction
 * - exportStock({productId, quantity, note, warehouseId}, userId): Xuất kho — kiểm tra tồn khả dụng, giảm quantity, ghi giao dịch EXPORT, kiểm tra ngưỡng cảnh báo sau xuất
 * - adjustment({productId, actualQuantity, note, warehouseId}, userId): Kiểm kho/điều chỉnh — tính diff, cập nhật quantity, ghi giao dịch ADJUSTMENT
 * - getLowStock(threshold): Lọc danh sách sản phẩm có tồn khả dụng <= threshold, sắp xếp tăng dần
 * - checkAlerts(): Phân loại tồn kho thành critical (available <= 0) và warning (available <= minStock nhưng > 0)
 * - getTransactions(query): Lấy lịch sử giao dịch phân trang, lọc theo inventoryId và type
 */
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');
const postingErrorService = require('../accounting/posting-error.service');
const autopostService = require('../accounting/autopost.service');
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
    const { productId, quantity, unitCost, note, warehouseId, lotCode, expDate, mfgDate } = data;
    if (!quantity || quantity <= 0) throw { status: 400, message: "Số lượng nhập phải lớn hơn 0" };

    return await prisma.$transaction(async (tx) => {
      const inventory = await findInventory(tx, productId, warehouseId);
      if (!inventory) throw { status: 404, message: "Không tìm thấy thông tin kho của sản phẩm này." };

      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: { increment: quantity } }
      });

      if (unitCost != null) {
        const product = await tx.product.findUnique({ where: { id: productId }, select: { costPrice: true } });
        if (product) {
          const oldQty = inventory.quantity;
          const oldCost = Number(product.costPrice || 0);
          const newQty = oldQty + quantity;
          const newCost = newQty > 0 ? Math.round(((oldQty * oldCost + quantity * unitCost) / newQty) * 100) / 100 : unitCost;
          await tx.product.update({
            where: { id: productId },
            data: { costPrice: newCost },
          });
        }
      }

      if (lotCode) {
        const existingLot = await tx.inventoryLot.findFirst({
          where: { lotCode, productId, warehouseId: inventory.warehouseId },
        });
        if (existingLot) {
          await tx.inventoryLot.update({
            where: { id: existingLot.id },
            data: { quantity: { increment: quantity } },
          });
        } else {
          await tx.inventoryLot.create({
            data: {
              lotCode,
              productId,
              warehouseId: inventory.warehouseId,
              quantity,
              originalQty: quantity,
              mfgDate: mfgDate ? new Date(mfgDate) : null,
              expDate: expDate ? new Date(expDate) : null,
            },
          });
        }
      }

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: updatedInventory.id,
          type: "IMPORT",
          quantity: quantity,
          note: note,
          unitCost: unitCost ? Math.round(unitCost * 100) / 100 : null,
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

  adjustment: async (data, userId) => {
    const { productId, actualQuantity, note, warehouseId } = data;
    if (actualQuantity == null || actualQuantity < 0) throw { status: 400, message: "Số lượng thực tế không được âm" };

    const result = await prisma.$transaction(async (tx) => {
      const inventory = await findInventory(tx, productId, warehouseId);
      if (!inventory) throw { status: 404, message: "Không tìm thấy thông tin kho của sản phẩm này." };
      if (actualQuantity < (inventory.reserved || 0)) {
        throw { status: 400, message: "Số lượng thực tế không được nhỏ hơn số đang giữ hàng" };
      }

      const diff = actualQuantity - inventory.quantity;

      const updated = await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: actualQuantity }
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: 'ADJUSTMENT',
          quantity: diff, 
          note: note,
          createdById: userId 
        }
      });

      return updated;
    });

    auditService.log({
      userId,
      action: "INVENTORY_ADJUST",
      entity: "Inventory",
      entityId: productId,
      before: null,
      after: { actualQuantity, note, warehouseId },
    }).catch(() => {});

    if (diff !== 0) {
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } }).catch(() => null);
      postingErrorService.tryPostOrQueue(
        () => autopostService.postInventoryAdjustment({ diff, productId, inventoryId: result.id, product, userId }),
        { source: "INVENTORY", sourceId: result.id, payload: { operation: "INVENTORY_ADJUSTMENT", diff, productId, inventoryId: result.id } },
      );
    }

    return result;
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
