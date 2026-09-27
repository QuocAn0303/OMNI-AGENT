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
const { encrypt, decrypt } = require("../../utils/crypto");
const adapters = require("./adapters");

const PLATFORMS = ["SHOPEE", "LAZADA", "TIKTOK"];

// ---- Shop management ----
const listShops = () =>
  prisma.marketplaceShop.findMany({ orderBy: { platform: "asc" } });

const createShop = async ({ platform, shopName, shopId, credentials }) => {
  if (!PLATFORMS.includes(platform)) throw { status: 400, message: `Nền tảng không hợp lệ. Chọn: ${PLATFORMS.join(", ")}` };
  const data = { platform, shopName, shopId };
  if (credentials) {
    const enc = encrypt(JSON.stringify(credentials));
    data.credentials = enc.valueEnc;
    data.credentialsIv = enc.iv;
  }
  return prisma.marketplaceShop.create({ data });
};

const toggleShop = async (id, isActive) =>
  prisma.marketplaceShop.update({ where: { id }, data: { isActive } });

const updateCredentials = async (id, credentials) => {
  const data = {};
  if (credentials) {
    const enc = encrypt(JSON.stringify(credentials));
    data.credentials = enc.valueEnc;
    data.credentialsIv = enc.iv;
  }
  return prisma.marketplaceShop.update({ where: { id }, data });
};

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
  if (!shop.credentials) throw { status: 400, message: "Shop chưa có thông tin xác thực — nhập khóa API trước" };

  const creds = JSON.parse(decrypt(shop.credentials, shop.credentialsIv) || '{}');

  const listings = await prisma.marketplaceListing.findMany({
    where: { shopId, status: "ACTIVE" },
    include: { product: { include: { inventories: true } } },
  });

  if (!listings.length) throw { status: 400, message: "Không có listing nào để push" };

  const results = await adapters.pushInventory(shop.platform, creds, listings);
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
  if (!shop.credentials) throw { status: 400, message: "Shop chưa có thông tin xác thực — nhập khóa API trước" };

  const creds = JSON.parse(decrypt(shop.credentials, shop.credentialsIv) || '{}');

  // Purge any leaked negative lastSyncAt values from previous bugs
  const externalOrders = await adapters.pullOrders(shop.platform, creds, 
    shop.lastSyncAt && shop.lastSyncAt > new Date('2020-01-01') && shop.lastSyncAt <= new Date()
      ? shop.lastSyncAt : new Date(Date.now() - 24 * 3600 * 1000));

  let created = 0;
  let skipped = 0;
  const errors = [];

  // Find or create a default "marketplace" customer for anonymous orders
  let marketplaceCustomer = await prisma.customer.findFirst({
    where: { name: 'Khách sàn TMĐT', phone: '0000000000' },
  });
  if (!marketplaceCustomer) {
    marketplaceCustomer = await prisma.customer.create({
      data: { name: 'Khách sàn TMĐT', phone: '0000000000' },
    });
  }

  // Find a default warehouse
  const defaultWarehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } });
  const warehouseId = defaultWarehouse?.id || null;

  // Get admin user for createdById
  const adminUser = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
  });
  const createdById = adminUser?.id || null;

  for (const extOrder of externalOrders) {
    try {
      // Check deduplication by external order ID stored in note
      const existing = await prisma.order.findFirst({
        where: { note: { contains: `[TMĐT:${shop.platform}:${extOrder.externalId}]` } },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // Map external items to ERP products by SKU
      const extItems = extOrder.items || [];
      const productMap = {};
      const skus = extItems.map((i) => i.sku).filter(Boolean);
      if (skus.length > 0) {
        const products = await prisma.product.findMany({
          where: { sku: { in: skus }, isActive: true },
        });
        for (const p of products) productMap[p.sku] = p;
      }

      // Build order items
      const orderItems = [];
      let subtotal = 0;
      for (const item of extItems) {
        const product = productMap[item.sku];
        if (!product) continue; // skip unknown SKUs

        const price = product.price || Number(item.price || 0);
        const qty = Number(item.quantity || 1);
        const lineTotal = price * qty;
        subtotal += lineTotal;

        orderItems.push({
          productId: product.id,
          quantity: qty,
          price,
          subtotal: lineTotal,
        });
      }

      if (orderItems.length === 0) {
        errors.push({ externalId: extOrder.externalId, error: 'Không tìm thấy sản phẩm ERP khớp SKU' });
        continue;
      }

      // Generate order code
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count = await prisma.order.count({
        where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      });
      const orderCode = `ORD-${today}-${String(count + 1).padStart(4, '0')}`;

      // Customer name from external order
      let customerId = marketplaceCustomer.id;
      if (extOrder.customerName || extOrder.customerPhone) {
        // Try to find existing customer by phone
        if (extOrder.customerPhone) {
          const existingCust = await prisma.customer.findFirst({
            where: { phone: extOrder.customerPhone },
          });
          if (existingCust) customerId = existingCust.id;
        }
      }

      // Create ERP Order
      try {
        await prisma.$transaction(async (tx) => {
          const order = await tx.order.create({
            data: {
              orderCode,
              customerId,
              warehouseId,
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              paymentMethod: 'BANK_TRANSFER',
              subtotal,
              total: extOrder.totalAmount || subtotal,
              note: `[TMĐT:${shop.platform}:${extOrder.externalId}] Nhập từ sàn ${shop.platform}. Tên KH: ${extOrder.customerName || 'Không rõ'}`,
              createdById: createdById || 'system',
              items: { create: orderItems },
              payments: {
                create: [{
                  amount: extOrder.totalAmount || subtotal,
                  method: 'BANK_TRANSFER',
                  note: `Thanh toán qua ${shop.platform}`,
                  createdById: createdById || 'system',
                }],
              },
            },
          });

          // Update inventory (reserve stock)
          for (const item of orderItems) {
            await tx.inventory.updateMany({
              where: { productId: item.productId, warehouseId: warehouseId || undefined },
              data: { quantity: { decrement: item.quantity } },
            });
          }
        });

        created++;
      } catch (txErr) {
        // Order creation failed — rollback happened automatically via transaction
        errors.push({ externalId: extOrder.externalId, error: txErr.message });
      }
    } catch (err) {
      errors.push({ externalId: extOrder.externalId, error: err.message });
    }
  }

  await logSync(shopId, {
    direction: "PULL", entity: "ORDER",
    status: errors.length ? (created ? "PARTIAL" : "ERROR") : "SUCCESS",
    count: created + skipped,
    errors: errors.length ? errors : null,
    endedAt: new Date(),
  });
  await prisma.marketplaceShop.update({ where: { id: shopId }, data: { lastSyncAt: new Date() } });
  return { created, skipped, errors: errors.length, orders: externalOrders };
};

module.exports = { listShops, createShop, toggleShop, updateCredentials, listListings, upsertListing, getSyncLogs, pushInventory, pullOrders };
