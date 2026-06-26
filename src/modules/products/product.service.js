/**
 * modules/products/product.service.js — Service quản lý sản phẩm
 * 
 * Tổng quan:
 * - Cung cấp logic CRUD cho sản phẩm + cập nhật tồn kho + upload ảnh
 * - Tích hợp audit log cho mọi thao tác
 * 
 * Hàm:
 * - getAll({page, limit, search, categoryId}): Lấy danh sách sản phẩm phân trang, search theo tên/SKU, lọc theo danh mục
 * - getById(id): Lấy chi tiết sản phẩm kèm tồn kho theo warehouse mặc định
 * - findBySku(sku): Tìm sản phẩm theo SKU (dùng cho POS quét barcode)
 * - create(data, userId): Tạo sản phẩm mới + khởi tạo inventory với số lượng 0, ghi audit log
 * - update(id, data, userId): Cập nhật thông tin sản phẩm, chỉ update các field được gửi lên, ghi audit log
 * - remove(id, userId): Soft delete (isActive = false), ghi audit log
 * - updateInventorySettings(id, {minStock, delta, warehouseId}): Cập nhật minStock và/hoặc điều chỉnh số lượng tồn, ghi InventoryTransaction
 * - updateImage(id, imageUrl): Cập nhật riêng cột imageUrl cho sản phẩm
 */
// src/modules/products/product.service.js
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');
const { getDefaultWarehouseId, findInventory } = require('../../utils/warehouse.helper');

const mapProductInventory = (product, whId) => {
  const inventory =
    product.inventories?.find((i) => i.warehouseId === whId) ||
    product.inventories?.[0] ||
    product.inventory ||
    null;
  return { ...product, inventory };
};

const getAll = async ({ page: rawPage = 1, limit: rawLimit = 20, search = '', categoryId = '' }) => {
  const page = Math.max(1, Number(rawPage) || 1);
  const limit = Math.max(1, Number(rawLimit) || 20);
  const skip = (page - 1) * limit;
  const where = {
    isActive: true,
    ...(search && { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }] }),
    ...(categoryId && { categoryId }),
  };

  const whId = await getDefaultWarehouseId();
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: Number(limit),
      include: {
        category: { select: { id: true, name: true } },
        inventories: {
          where: { warehouseId: whId },
          select: { quantity: true, reserved: true, minStock: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.count({ where }),
  ]);

  const products = rows.map((p) => mapProductInventory(p, whId));
  return { products, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / limit) } };
};

const getById = async (id) => {
  const whId = await getDefaultWarehouseId();
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: true, inventories: { where: { warehouseId: whId } } },
  });
  if (!product) throw { status: 404, message: 'Không tìm thấy sản phẩm' };
  return mapProductInventory(product, whId);
};

const findBySku = async (sku) => {
  const whId = await getDefaultWarehouseId();
  const product = await prisma.product.findFirst({
    where: { sku, isActive: true },
    include: { category: true, inventories: { where: { warehouseId: whId } } },
  });
  if (!product) throw { status: 404, message: 'Không tìm thấy sản phẩm theo SKU' };
  return mapProductInventory(product, whId);
};

const create = async (data, userId = null) => {
  const whId = await getDefaultWarehouseId();
  const product = await prisma.product.create({
    data: {
      name: data.name,
      sku: data.sku,
      price: data.price,
      costPrice: data.costPrice,
      categoryId: data.categoryId,
      inventories: { create: { quantity: data.initialStock ?? 0, warehouseId: whId } },
    },
  });

  if ((data.initialStock ?? 0) > 0) {
    await prisma.inventoryTransaction.create({
      data: {
        inventoryId: (await findInventory(prisma, product.id, whId)).id,
        type: "IMPORT",
        quantity: data.initialStock,
        note: `Nhập kho ban đầu - ${product.name}`,
        createdById: userId,
      },
    });
  }

  auditService.log({
    userId,
    action: 'CREATE_PRODUCT',
    entity: 'Product',
    entityId: product.id,
    after: { sku: product.sku, name: product.name, price: product.price },
  });

  return product;
};

const update = async (id, data, userId = null) => {
  const { name, sku, description, price, costPrice, unit, categoryId, imageUrl } = data;
  const allowedFields = Object.fromEntries(
    Object.entries({ name, sku, description, price, costPrice, unit, categoryId, imageUrl }).filter(([, v]) => v !== undefined)
  );

  const before = await prisma.product.findUnique({ where: { id }, select: { name: true, price: true, costPrice: true, isActive: true } });
  const updated = await prisma.product.update({
    where: { id },
    data: allowedFields,
    include: { category: true, inventories: true },
  });

  auditService.log({
    userId,
    action: 'UPDATE_PRODUCT',
    entity: 'Product',
    entityId: id,
    before,
    after: { name: updated.name, price: updated.price, costPrice: updated.costPrice },
  });

  return updated;
};

const remove = async (id, userId = null) => {
  const before = await prisma.product.findUnique({ where: { id }, select: { name: true, sku: true } });
  const result = await prisma.product.update({ where: { id }, data: { isActive: false } });

  auditService.log({
    userId,
    action: 'DELETE_PRODUCT',
    entity: 'Product',
    entityId: id,
    before,
  });

  return result;
};

const updateInventorySettings = async (id, { minStock, delta, warehouseId }) => {
  const inventory = await findInventory(prisma, id, warehouseId);
  if (!inventory) throw { status: 404, message: 'Không tìm thấy tồn kho' };

  return prisma.$transaction(async (tx) => {
    const updateData = {};
    if (minStock !== undefined) updateData.minStock = minStock;
    if (delta !== undefined && delta !== 0) updateData.quantity = { increment: delta };

    const updated = await tx.inventory.update({ where: { id: inventory.id }, data: updateData });

    if (delta !== undefined && delta !== 0) {
      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: delta > 0 ? 'IMPORT' : 'ADJUSTMENT',
          quantity: Math.abs(delta),
          note: delta > 0 ? 'Nhập hàng qua form sản phẩm' : 'Điều chỉnh giảm qua form sản phẩm',
        },
      });
    }

    return updated;
  });
};

// Hàm mới: Chỉ dùng để cập nhật mỗi cột imageUrl
const updateImage = async (id, imageUrl) => {
  // 1. Kiểm tra xem sản phẩm có tồn tại không trước khi lưu ảnh
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw { status: 404, message: 'Không tìm thấy sản phẩm để cập nhật ảnh' };

  return prisma.product.update({
    where: { id },
    data: { imageUrl },
  });
};

module.exports = { getAll, getById, findBySku, create, update, updateInventorySettings, remove, updateImage };
