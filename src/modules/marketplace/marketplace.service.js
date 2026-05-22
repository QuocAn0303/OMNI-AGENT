// src/modules/marketplace/marketplace.service.js
// Marketplace integration: Shopee / Lazada / TikTok
// Phase 3.3 — adapter stubs ready for real API keys
const prisma = require("../../config/prisma");

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

// ---- Push inventory to marketplace (stub — fill with real SDK per platform) ----
const pushInventory = async (shopId) => {
  const shop = await prisma.marketplaceShop.findUniqueOrThrow({ where: { id: shopId } });
  if (!shop.isActive) throw { status: 400, message: "Shop đang tắt" };

  const listings = await prisma.marketplaceListing.findMany({
    where: { shopId, status: "ACTIVE" },
    include: { product: { include: { inventories: true } } },
  });

  let pushed = 0, errors = [];
  for (const listing of listings) {
    try {
      const stock = listing.product.inventories.reduce((s, i) => s + i.quantity, 0);
      // TODO: call real platform SDK with shop.credentials + listing.externalId + stock
      // await ShopeeAPI.updateStock(shop.credentials, listing.externalId, stock)
      pushed++;
      await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { lastPushedAt: new Date(), syncErrors: null } });
    } catch (e) {
      errors.push({ listingId: listing.id, error: e.message });
      await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { syncErrors: e.message } });
    }
  }

  await logSync(shopId, { direction: "PUSH", entity: "INVENTORY", status: errors.length ? (pushed ? "PARTIAL" : "ERROR") : "SUCCESS", count: pushed, errors: errors.length ? errors : null });
  await prisma.marketplaceShop.update({ where: { id: shopId }, data: { lastSyncAt: new Date() } });
  return { pushed, errors: errors.length };
};

// ---- Pull orders from marketplace (stub) ----
const pullOrders = async (shopId) => {
  const shop = await prisma.marketplaceShop.findUniqueOrThrow({ where: { id: shopId } });
  if (!shop.isActive) throw { status: 400, message: "Shop đang tắt" };

  // TODO: call real platform SDK to fetch new orders since shop.lastSyncAt
  // const externalOrders = await ShopeeAPI.getOrders(shop.credentials, { since: shop.lastSyncAt })
  // For each order: create Order + OrderItems in Aduu with source = platform
  const pulled = 0;

  await logSync(shopId, { direction: "PULL", entity: "ORDER", status: "SUCCESS", count: pulled });
  await prisma.marketplaceShop.update({ where: { id: shopId }, data: { lastSyncAt: new Date() } });
  return { pulled };
};

module.exports = { listShops, createShop, toggleShop, listListings, upsertListing, getSyncLogs, pushInventory, pullOrders };
