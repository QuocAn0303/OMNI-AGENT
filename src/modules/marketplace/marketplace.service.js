/**
 * modules/marketplace/marketplace.service.js — Tích hợp sàn thương mại điện tử
 * 
 * Tổng quan:
 * - Quản lý shop trên các sàn (Shopee, Lazada, TikTok)
 * - Quản lý listings (sản phẩm niêm yết)
 * - Đồng bộ tồn kho và đơn hàng (stub — sẵn sàng cho real API)
 * - Ghi log đồng bộ
 * 
 * Hàm:
 * - listShops(): Danh sách shop marketplace
 * - createShop({platform, shopName, shopId, credentials}): Tạo shop mới
 * - toggleShop(id, isActive): Bật/tắt shop
 * - listListings(shopId): Danh sách listing của shop
 * - upsertListing(shopId, productId, {externalId, externalSku, status}): Tạo/cập nhật listing
 * - logSync(shopId, {direction, entity, status, count, errors}): Ghi log đồng bộ
 * - getSyncLogs(shopId, limit): Lấy log đồng bộ
 * - pushInventory(shopId): Đẩy tồn kho lên sàn (stub)
 * - pullOrders(shopId): Kéo đơn hàng từ sàn (stub)
 */
// src/modules/marketplace/marketplace.service.js
// Marketplace integration: Shopee / Lazada / TikTok
const prisma = require("../../config/prisma");
const adapters = require("./adapters");

const PLATFORMS = ["SHOPEE", "LAZADA", "TIKTOK"];

// ---- Shop management ----
const listShops = () =>
  prisma.marketplaceShop.findMany({ orderBy: { platform: "asc" } });

const createShop = async ({ platform, shopName, shopId, credentials }) => {
  if (!PLATFORMS.includes(platform)) throw { status: 400, message: `Platform không hợp lệ. Chọn: ${PLATFORMS.join(", ")}` };
  return prisma.marketplaceShop.create({
    data: { platform, shopName, shopId, credentials: credentials || null },
  });
};

const toggleShop = async (id, isActive) =>
  prisma.marketplaceShop.update({ where: { id }, data: { isActive } });

const updateCredentials = async (id, credentials) =>
  prisma.marketplaceShop.update({ where: { id }, data: { credentials } });

// ---- Listings ----
const listListings = (shopId) =>
  prisma.marketplaceListing.findMany({
    where: { shopId },
    include: { product: { select: { name: true, sku: true, price: true } } },
    orderBy: { createdAt: "desc" },
  });

const upsertListing = async (shopId, productId, { externalId, externalSku, status = "ACTIVE" } = {}) => {
  return prisma.marketplaceListing.upsert({
    where: { shopId_productId: { shopId, productId } },
    create: { shopId, productId, platform: (await prisma.marketplaceShop.findUniqueOrThrow({ where: { id: shopId } })).platform, externalId, externalSku, status },
    update: { externalId, externalSku, status },
  });
};

// ---- Sync logs ----
const logSync = async (shopId, { direction, entity, status, count = 0, errors = null, startedAt, endedAt }) => {
  return prisma.marketplaceSyncLog.create({
    data: { shopId, direction, entity, status, count, errors, startedAt: startedAt || new Date(), endedAt: endedAt || new Date() },
  });
};

const getSyncLogs = (shopId, limit = 50) =>
  prisma.marketplaceSyncLog.findMany({
    where: { shopId },
    orderBy: { startedAt: "desc" },
    take: Number(limit),
  });

// ---- Push inventory to marketplace ----
const pushInventory = async (shopId) => {
  const shop = await prisma.marketplaceShop.findUniqueOrThrow({ where: { id: shopId } });
  if (!shop.isActive) throw { status: 400, message: "Shop đang tắt" };
  if (!shop.credentials) throw { status: 400, message: "Shop chưa có credentials — nhập API key trước" };

  const listings = await prisma.marketplaceListing.findMany({
    where: { shopId, status: "ACTIVE" },
    include: { product: { include: { inventories: true } } },
  });

  if (!listings.length) throw { status: 400, message: "Không có listing nào để push" };

  const results = await adapters.pushInventory(shop.platform, shop.credentials, listings);
  const pushed = results.filter((r) => r.status === "ok").length;
  const errors = results.filter((r) => r.status === "error").map((r) => ({ listingId: r.listingId, error: r.error }));

  for (const r of results) {
    await prisma.marketplaceListing.update({
      where: { id: r.listingId },
      data: { lastPushedAt: new Date(), syncErrors: r.status === "error" ? r.error : null },
    });
  }

  await logSync(shopId, {
    direction: "PUSH", entity: "INVENTORY",
    status: errors.length ? (pushed ? "PARTIAL" : "ERROR") : "SUCCESS",
    count: pushed, errors: errors.length ? errors : null,
  });
  await prisma.marketplaceShop.update({ where: { id: shopId }, data: { lastSyncAt: new Date() } });
  return { pushed, errors: errors.length };
};

// ---- Pull orders from marketplace ----
const pullOrders = async (shopId) => {
  const shop = await prisma.marketplaceShop.findUniqueOrThrow({ where: { id: shopId } });
  if (!shop.isActive) throw { status: 400, message: "Shop đang tắt" };
  if (!shop.credentials) throw { status: 400, message: "Shop chưa có credentials — nhập API key trước" };

  const externalOrders = await adapters.pullOrders(shop.platform, shop.credentials, shop.lastSyncAt);

  const pulled = externalOrders.length;
  await logSync(shopId, {
    direction: "PULL", entity: "ORDER",
    status: pulled ? "SUCCESS" : "SUCCESS",
    count: pulled,
    errors: null,
    endedAt: new Date(),
  });
  await prisma.marketplaceShop.update({ where: { id: shopId }, data: { lastSyncAt: new Date() } });
  return { pulled, orders: externalOrders };
};

module.exports = { listShops, createShop, toggleShop, updateCredentials, listListings, upsertListing, getSyncLogs, pushInventory, pullOrders };
