/**
 * modules/production/lot.service.js — Service quản lý Lô hàng, tracking hạn dùng & FEFO
 *
 * Tổng quan:
 * - Quản lý lô hàng (InventoryLot), giao dịch lô (LotTransaction)
 * - Hỗ trợ FEFO (First Expiry First Out) để chọn lô khi xuất kho
 * - Theo dõi hạn sử dụng, cảnh báo lô sắp hết hạn
 * - Cho phép nhập lô mới (upsert), tiêu thụ lô
 *
 * Hàm:
 * - listLots({ productId, warehouseId, expiringSoonDays, hasStock }): Danh sách lô, lọc theo sản phẩm/kho/sắp hết hạn
 * - getLot(id): Chi tiết lô kèm product, warehouse, 50 giao dịch gần nhất
 * - receiveLot({ lotCode, productId, warehouseId, quantity, mfgDate, expDate, poId }): Nhập lô — upsert, tạo LotTransaction IN
 * - consumeLot(lotId, quantity, { orderId, workOrderId }): Tiêu thụ lô — decrement, tạo LotTransaction OUT
 * - selectFefo(productId, warehouseId, needed): Chọn lô theo FEFO để đáp ứng số lượng cần, throw nếu thiếu
 * - getExpiringLots(days): Lấy danh sách lô sắp hết hạn trong N ngày để gửi cảnh báo
 */
// src/modules/production/lot.service.js — Lot/Serial/Expiry tracking
const prisma = require("../../config/prisma");

const listLots = async ({ productId, warehouseId, expiringSoonDays, hasStock = true } = {}) => {
  const where = {};
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (hasStock) where.quantity = { gt: 0 };
  if (expiringSoonDays) {
    const future = new Date();
    future.setDate(future.getDate() + Number(expiringSoonDays));
    where.expDate = { lte: future, gte: new Date() };
  }
  return prisma.inventoryLot.findMany({
    where,
    include: {
      product: { select: { name: true, sku: true, unit: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: [{ expDate: "asc" }, { createdAt: "asc" }],
  });
};

const getLot = (id) =>
  prisma.inventoryLot.findUniqueOrThrow({
    where: { id },
    include: {
      product: true, warehouse: true,
      transactions: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

const receiveLot = async ({ lotCode, productId, warehouseId, quantity, mfgDate, expDate, poId }) => {
  if (!lotCode || !productId || !warehouseId || !quantity) {
    throw { status: 400, message: "Cần lotCode, productId, warehouseId, quantity" };
  }
  const lot = await prisma.inventoryLot.upsert({
    where: { lotCode_productId_warehouseId: { lotCode, productId, warehouseId } },
    create: {
      lotCode, productId, warehouseId, quantity: Number(quantity),
      originalQty: Number(quantity),
      mfgDate: mfgDate ? new Date(mfgDate) : null,
      expDate: expDate ? new Date(expDate) : null,
      poId: poId || null,
    },
    update: {
      quantity: { increment: Number(quantity) },
      originalQty: { increment: Number(quantity) },
    },
  });
  await prisma.lotTransaction.create({
    data: { lotId: lot.id, quantity: Number(quantity), type: "IN" },
  });
  return lot;
};

const consumeLot = async (lotId, quantity, { orderId, workOrderId } = {}) => {
  const lot = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: lotId } });
  if (lot.quantity < quantity) throw { status: 400, message: `Không đủ tồn kho lô ${lot.lotCode}` };
  await prisma.$transaction([
    prisma.inventoryLot.update({ where: { id: lotId }, data: { quantity: { decrement: Number(quantity) } } }),
    prisma.lotTransaction.create({ data: { lotId, quantity: Number(quantity), type: "OUT", orderId, workOrderId } }),
  ]);
};

// FEFO selection: find lots for a product sorted by earliest expiry (or creation)
const selectFefo = async (productId, warehouseId, needed) => {
  const lots = await prisma.inventoryLot.findMany({
    where: { productId, warehouseId, quantity: { gt: 0 } },
    orderBy: [{ expDate: "asc" }, { createdAt: "asc" }],
  });
  const selected = [];
  let remaining = Number(needed);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantity, remaining);
    selected.push({ lot, take });
    remaining -= take;
  }
  if (remaining > 0) throw { status: 400, message: "Không đủ tồn kho có lô hàng" };
  return selected;
};

// Cron: notify about lots expiring in 60/30/7 days
const getExpiringLots = (days = 30) => {
  const future = new Date();
  future.setDate(future.getDate() + days);
  return prisma.inventoryLot.findMany({
    where: { expDate: { lte: future, gte: new Date() }, quantity: { gt: 0 } },
    include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } },
    orderBy: { expDate: "asc" },
  });
};

module.exports = { listLots, getLot, receiveLot, consumeLot, selectFefo, getExpiringLots };
