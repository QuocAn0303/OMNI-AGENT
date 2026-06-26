/**
 * modules/warehouses/stock-transfer.service.js — Service chuyển kho
 * 
 * Tổng quan:
 * - Quản lý phiếu chuyển kho giữa các warehouse
 * - Khi hoàn thành, tự động xuất kho nguồn và nhập kho đích
 * 
 * Hàm:
 * - generateCode(): Sinh mã phiếu chuyển tự động ST-YYYYMMDD-XXXX
 * - create({fromWarehouseId, toWarehouseId, note, items}, userId): Tạo phiếu chuyển mới, kiểm tra kho nguồn/đích khác nhau, ghi audit log
 * - complete(id, userId): Hoàn thành chuyển kho — kiểm tra tồn kho nguồn, decrement kho nguồn, increment (hoặc tạo mới) kho đích, ghi InventoryTransaction, ghi audit log
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const { findInventory } = require("../../utils/warehouse.helper");

const generateCode = async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.stockTransfer.count({
    where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  return `ST-${today}-${String(count + 1).padStart(4, "0")}`;
};

const create = async (data, userId) => {
  if (data.fromWarehouseId === data.toWarehouseId) {
    throw { status: 400, message: "Kho nguồn và đích phải khác nhau" };
  }
  const transferCode = await generateCode();
  const transfer = await prisma.stockTransfer.create({
    data: {
      transferCode,
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      note: data.note,
      items: {
        create: data.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      },
    },
    include: { items: true, fromWarehouse: true, toWarehouse: true },
  });
  await auditService.log({
    userId,
    action: "CREATE_STOCK_TRANSFER",
    entity: "StockTransfer",
    entityId: transfer.id,
    after: { transferCode },
  });
  return transfer;
};

const complete = async (id, userId) => {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!transfer) throw { status: 404, message: "Không tìm thấy phiếu chuyển" };
  if (transfer.status === "COMPLETED") {
    throw { status: 400, message: "Phiếu đã hoàn thành" };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      const fromInv = await findInventory(
        tx,
        item.productId,
        transfer.fromWarehouseId,
      );
      if (!fromInv || fromInv.quantity - fromInv.reserved < item.quantity) {
        throw {
          status: 400,
          message: `Kho nguồn không đủ tồn cho sản phẩm ${item.productId}`,
        };
      }
      await tx.inventory.update({
        where: { id: fromInv.id },
        data: { quantity: { decrement: item.quantity } },
      });
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: fromInv.id,
          type: "EXPORT",
          quantity: item.quantity,
          note: `Chuyển kho ${transfer.transferCode}`,
          createdById: userId,
        },
      });

      let toInv = await findInventory(
        tx,
        item.productId,
        transfer.toWarehouseId,
      );
      if (!toInv) {
        toInv = await tx.inventory.create({
          data: {
            productId: item.productId,
            warehouseId: transfer.toWarehouseId,
            quantity: 0,
          },
        });
      }
      await tx.inventory.update({
        where: { id: toInv.id },
        data: { quantity: { increment: item.quantity } },
      });
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: toInv.id,
          type: "IMPORT",
          quantity: item.quantity,
          note: `Nhận chuyển kho ${transfer.transferCode}`,
          createdById: userId,
        },
      });
    }
    await tx.stockTransfer.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });

  await auditService.log({
    userId,
    action: "COMPLETE_STOCK_TRANSFER",
    entity: "StockTransfer",
    entityId: id,
  });

  return prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true, fromWarehouse: true, toWarehouse: true },
  });
};

module.exports = { create, complete };
