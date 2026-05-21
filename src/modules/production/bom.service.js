// src/modules/production/bom.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const BOM_LIST_SELECT = {
  id: true,
  code: true,
  version: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { id: true, sku: true, name: true, unit: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: { select: { items: true, workOrders: true } },
};

const BOM_DETAIL_SELECT = {
  ...BOM_LIST_SELECT,
  items: {
    select: {
      id: true,
      quantity: true,
      notes: true,
      component: {
        select: { id: true, sku: true, name: true, unit: true, costPrice: true },
      },
    },
    orderBy: { createdAt: "asc" },
  },
};

const generateCode = () => {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `BOM-${ts}${rand}`;
};

const list = async ({ page = 1, limit = 20, productId, status, search } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Number(limit) || 20);

  const where = {};
  if (productId) where.productId = productId;
  if (status) where.status = status;
  if (search && search.trim()) {
    const s = search.trim();
    where.OR = [
      { code: { contains: s, mode: "insensitive" } },
      { product: { name: { contains: s, mode: "insensitive" } } },
      { product: { sku: { contains: s, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.bom.findMany({
      where,
      select: BOM_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * l,
      take: l,
    }),
    prisma.bom.count({ where }),
  ]);

  return {
    items,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

const getById = async (id) => {
  const bom = await prisma.bom.findUnique({
    where: { id },
    select: BOM_DETAIL_SELECT,
  });
  if (!bom) {
    const err = new Error("BOM không tồn tại");
    err.status = 404;
    throw err;
  }
  return bom;
};

const validateItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("BOM phải có ít nhất 1 nguyên liệu");
    err.status = 400;
    throw err;
  }
  const seen = new Set();
  for (const it of items) {
    if (!it.componentId) {
      const err = new Error("componentId không được trống");
      err.status = 400;
      throw err;
    }
    if (seen.has(it.componentId)) {
      const err = new Error("Nguyên liệu bị trùng trong BOM");
      err.status = 400;
      throw err;
    }
    seen.add(it.componentId);
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
      const err = new Error("Số lượng phải là số nguyên dương");
      err.status = 400;
      throw err;
    }
  }
};

const create = async (data, userId) => {
  validateItems(data.items);

  const product = await prisma.product.findUnique({
    where: { id: data.productId },
    select: { id: true, isActive: true },
  });
  if (!product) {
    const err = new Error("Sản phẩm không tồn tại");
    err.status = 404;
    throw err;
  }

  const componentIds = data.items.map((x) => x.componentId);
  if (componentIds.includes(data.productId)) {
    const err = new Error("Thành phẩm không thể là nguyên liệu của chính nó");
    err.status = 400;
    throw err;
  }
  const components = await prisma.product.findMany({
    where: { id: { in: componentIds } },
    select: { id: true },
  });
  if (components.length !== componentIds.length) {
    const err = new Error("Có nguyên liệu không tồn tại");
    err.status = 400;
    throw err;
  }

  const bom = await prisma.bom.create({
    data: {
      code: generateCode(),
      productId: data.productId,
      version: data.version || "v1",
      status: data.status || "DRAFT",
      notes: data.notes || null,
      createdById: userId,
      items: {
        create: data.items.map((it) => ({
          componentId: it.componentId,
          quantity: it.quantity,
          notes: it.notes || null,
        })),
      },
    },
    select: BOM_DETAIL_SELECT,
  });

  auditService.log({
    userId,
    action: "CREATE_BOM",
    entity: "Bom",
    entityId: bom.id,
    after: { code: bom.code, productId: data.productId, itemsCount: data.items.length },
  });

  return bom;
};

const update = async (id, data, userId) => {
  const before = await prisma.bom.findUnique({
    where: { id },
    select: { id: true, status: true, version: true, notes: true },
  });
  if (!before) {
    const err = new Error("BOM không tồn tại");
    err.status = 404;
    throw err;
  }
  if (before.status !== "DRAFT") {
    const err = new Error("Chỉ có thể sửa BOM ở trạng thái DRAFT");
    err.status = 400;
    throw err;
  }

  const patch = {};
  if (data.version !== undefined) patch.version = data.version;
  if (data.notes !== undefined) patch.notes = data.notes;

  let itemsAfter;
  const result = await prisma.$transaction(async (tx) => {
    if (data.items !== undefined) {
      validateItems(data.items);
      // Replace all items
      await tx.bomItem.deleteMany({ where: { bomId: id } });
      await tx.bomItem.createMany({
        data: data.items.map((it) => ({
          bomId: id,
          componentId: it.componentId,
          quantity: it.quantity,
          notes: it.notes || null,
        })),
      });
      itemsAfter = data.items.length;
    }
    if (Object.keys(patch).length > 0) {
      await tx.bom.update({ where: { id }, data: patch });
    }
    return tx.bom.findUnique({ where: { id }, select: BOM_DETAIL_SELECT });
  });

  auditService.log({
    userId,
    action: "UPDATE_BOM",
    entity: "Bom",
    entityId: id,
    before: { version: before.version },
    after: { version: result.version, itemsCount: itemsAfter ?? result.items.length },
  });

  return result;
};

const changeStatus = async (id, status, userId) => {
  const bom = await prisma.bom.findUnique({
    where: { id },
    select: { id: true, status: true, items: { select: { id: true } } },
  });
  if (!bom) {
    const err = new Error("BOM không tồn tại");
    err.status = 404;
    throw err;
  }
  if (status === "ACTIVE" && bom.items.length === 0) {
    const err = new Error("BOM cần có ít nhất 1 nguyên liệu trước khi kích hoạt");
    err.status = 400;
    throw err;
  }

  const updated = await prisma.bom.update({
    where: { id },
    data: { status },
    select: BOM_DETAIL_SELECT,
  });

  auditService.log({
    userId,
    action: `CHANGE_BOM_STATUS`,
    entity: "Bom",
    entityId: id,
    before: { status: bom.status },
    after: { status: updated.status },
  });

  return updated;
};

const remove = async (id, userId) => {
  const bom = await prisma.bom.findUnique({
    where: { id },
    select: { id: true, code: true, _count: { select: { workOrders: true } } },
  });
  if (!bom) {
    const err = new Error("BOM không tồn tại");
    err.status = 404;
    throw err;
  }
  if (bom._count.workOrders > 0) {
    const err = new Error("Không thể xóa BOM đã có lệnh sản xuất");
    err.status = 400;
    throw err;
  }

  await prisma.bom.delete({ where: { id } });

  auditService.log({
    userId,
    action: "DELETE_BOM",
    entity: "Bom",
    entityId: id,
    before: { code: bom.code },
  });

  return { id };
};

module.exports = { list, getById, create, update, changeStatus, remove };
