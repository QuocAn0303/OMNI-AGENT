const prisma = require('../../config/prisma');

const list = async ({ productId, warehouseId, status, search, page = 1, limit = 20 }) => {
  const where = {};
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (status) where.status = status;
  if (search) where.serialCode = { contains: search, mode: 'insensitive' };

  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.serialNumber.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        order: { select: { id: true, code: true } },
      },
    }),
    prisma.serialNumber.count({ where }),
  ]);
  return {
    serialNumbers: rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

const getById = async (id) => {
  const serial = await prisma.serialNumber.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      order: { select: { id: true, code: true } },
    },
  });
  if (!serial) {
    const err = new Error('Serial number không tồn tại');
    err.status = 404;
    throw err;
  }
  return serial;
};

const findBySerialCode = async (serialCode, productId) => {
  const serial = await prisma.serialNumber.findFirst({
    where: { serialCode, productId },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      warehouse: { select: { id: true, name: true } },
    },
  });
  return serial;
};

const register = async ({ serialCodes, productId, warehouseId, purchaseOrderId, note }, userId) => {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    const err = new Error('Sản phẩm không tồn tại');
    err.status = 404;
    throw err;
  }

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) {
    const err = new Error('Kho không tồn tại');
    err.status = 404;
    throw err;
  }

  // B5: 1 query tìm số đã tồn tại (trước đây findFirst per code — N+1),
  // bỏ trùng trong batch, rồi create từng cái còn thiếu
  const existingRows = await prisma.serialNumber.findMany({
    where: { productId, serialCode: { in: serialCodes } },
    select: { serialCode: true },
  });
  const existing = new Set(existingRows.map((r) => r.serialCode));

  const created = [];
  for (const code of new Set(serialCodes)) {
    if (existing.has(code)) continue;
    const serial = await prisma.serialNumber.create({
      data: {
        serialCode: code,
        productId,
        warehouseId,
        purchaseOrderId,
        note,
        status: 'IN_STOCK',
      },
    });
    created.push(serial);
  }

  return created;
};

const updateStatus = async (id, status, orderId) => {
  const serial = await prisma.serialNumber.findUnique({ where: { id } });
  if (!serial) {
    const err = new Error('Serial number không tồn tại');
    err.status = 404;
    throw err;
  }

  return prisma.serialNumber.update({
    where: { id },
    data: {
      status,
      ...(orderId ? { orderId } : {}),
    },
  });
};

const bulkUpdateStatus = async (serialIds, status, orderId) => {
  return prisma.serialNumber.updateMany({
    where: { id: { in: serialIds } },
    data: {
      status,
      ...(orderId ? { orderId } : {}),
    },
  });
};

module.exports = { list, getById, findBySerialCode, register, updateStatus, bulkUpdateStatus };
