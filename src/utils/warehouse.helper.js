/**
 * utils/warehouse.helper.js — Helper xử lý kho hàng mặc định & inventory
 * 
 * Tổng quan:
 * - Quản lý kho mặc định (có cache in-memory) để các module khác không cần truyền warehouseId
 * - Hỗ trợ resolveWarehouseId: nếu không có warehouseId → dùng kho mặc định
 * - Hỗ trợ transaction-aware: nhận tx (Prisma transaction client) để dùng trong $transaction
 * 
 * Hàm:
 * - getDefaultWarehouseId(tx): Lấy ID kho mặc định (env > cache > DB query)
 * - resolveWarehouseId(warehouseId, tx): Nếu null → trả về kho mặc định
 * - findInventory(tx, productId, warehouseId): Tìm inventory theo product + warehouse
 * - attachDefaultInventory(product, inventory): Gắn inventory vào product object
 * - clearWarehouseCache(): Reset cache (dùng sau khi đổi cấu hình kho)
 */

const prisma = require("../config/prisma");
const { getTenantId } = require("../config/tenantContext");

// Cache per-tenant (trước đây là 1 slot global → tenant A làm tenant B dùng nhầm kho).
// Key: tenantId (hoặc "GLOBAL" khi không có context) — TTL 60s để tránh data cũ
// khi kho mặc định bị đổi qua instance khác.
const cache = new Map();
const DEFAULT_TTL_MS = 60 * 1000;

const getCacheKey = () => getTenantId() || "GLOBAL";

const getDefaultWarehouseId = async (tx = prisma) => {
  if (process.env.DEFAULT_WAREHOUSE_ID) return process.env.DEFAULT_WAREHOUSE_ID;
  const key = getCacheKey();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < DEFAULT_TTL_MS) return hit.id;
  const wh = await tx.warehouse.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (!wh) throw { status: 500, message: "Chưa cấu hình kho mặc định" };
  cache.set(key, { id: wh.id, fetchedAt: Date.now() });
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
  clearWarehouseCache: (tenantId) => {
    if (tenantId) cache.delete(String(tenantId));
    else cache.clear();
  },
};
