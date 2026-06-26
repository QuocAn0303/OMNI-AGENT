/**
 * modules/inventory/cyclecount.service.js — Service kiểm kê định kỳ
 * 
 * Tổng quan:
 * - Quản lý vòng đời phiếu kiểm kê: tạo → nhập số liệu → hoàn thành/hủy
 * - Khi hoàn thành, tự động điều chỉnh tồn kho theo chênh lệch
 * 
 * Hàm:
 * - generateCode(): Sinh mã phiếu kiểm kê tự động CC-YYYYMMDD-XXXX
 * - create({productIds, note}, userId): Tạo phiếu kiểm kê mới, ghi nhận systemQuantity từ tồn hiện tại
 * - recordCount(id, items): Ghi nhận số lượng thực tế cho từng item, tính variance, chuyển trạng thái IN_PROGRESS
 * - complete(id, userId): Hoàn thành kiểm kê — điều chỉnh tồn kho theo variance, ghi InventoryTransaction, chuyển COMPLETED
 * - cancel(id): Hủy phiếu kiểm kê, chuyển CANCELLED
 * - getAll({page, limit, status}): Danh sách phiếu kiểm kê phân trang, lọc theo trạng thái
 * - getById(id): Chi tiết phiếu kiểm kê kèm items và thông tin sản phẩm
 */
const prisma = require("../../config/prisma");

const generateCode = async () => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await prisma.cycleCount.count({ where: { createdAt: { gte: start } } });
  return `CC-${today}-${String(count + 1).padStart(4, "0")}`;
};

const create = async ({ productIds, note }, userId) => {
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    include: { inventories: true },
  });
  if (products.length !== new Set(productIds).size) {
    throw { status: 400, message: "Một số sản phẩm không tồn tại hoặc đã ngừng kinh doanh" };
  }

  const code = await generateCode();
  return prisma.cycleCount.create({
    data: {
      code,
      note,
      createdById: userId,
      items: {
        create: products.map((product) => ({
          productId: product.id,
          systemQuantity: product.inventories.reduce((sum, inv) => sum + inv.quantity, 0),
        })),
      },
    },
    include: { items: { include: { product: true } }, createdBy: { select: { fullName: true } } },
  });
};

const recordCount = async (id, items) => {
  const cycleCount = await prisma.cycleCount.findUnique({ where: { id } });
  if (!cycleCount) throw { status: 404, message: "Không tìm thấy phiếu kiểm kê" };
  if (!["DRAFT", "IN_PROGRESS"].includes(cycleCount.status)) {
    throw { status: 400, message: "Phiếu kiểm kê không còn được nhập số liệu" };
  }

  return prisma.$transaction(async (tx) => {
    for (const item of items) {
      const existing = await tx.cycleCountItem.findUnique({ where: { id: item.id } });
      if (!existing || existing.cycleCountId !== id) {
        throw { status: 400, message: "Dòng kiểm kê không hợp lệ" };
      }
      await tx.cycleCountItem.update({
        where: { id: item.id },
        data: {
          actualQuantity: item.actualQuantity,
          variance: item.actualQuantity - existing.systemQuantity,
          note: item.note,
        },
      });
    }
    return tx.cycleCount.update({
      where: { id },
      data: { status: "IN_PROGRESS" },
      include: { items: { include: { product: true } } },
    });
  });
};

const complete = async (id, userId) => {
  return prisma.$transaction(async (tx) => {
    const cycleCount = await tx.cycleCount.findUnique({
      where: { id },
      include: { items: { include: { product: { include: { inventories: true } } } } },
    });
    if (!cycleCount) throw { status: 404, message: "Không tìm thấy phiếu kiểm kê" };
    if (cycleCount.status === "COMPLETED") throw { status: 400, message: "Phiếu kiểm kê đã hoàn thành" };
    if (cycleCount.status === "CANCELLED") throw { status: 400, message: "Phiếu kiểm kê đã hủy" };

    for (const item of cycleCount.items) {
      if (item.actualQuantity == null) {
        throw { status: 400, message: "Vui lòng nhập đủ số lượng thực tế trước khi hoàn thành" };
      }
      if (item.variance !== 0) {
        for (const inventory of item.product.inventories) {
          await tx.inventory.update({
            where: { id: inventory.id },
            data: { quantity: item.actualQuantity },
          });
          await tx.inventoryTransaction.create({
            data: {
              inventoryId: inventory.id,
              type: "ADJUSTMENT",
              quantity: item.variance,
              note: `Kiểm kê ${cycleCount.code}`,
              createdById: userId,
            },
          });
        }
      }
    }

    return tx.cycleCount.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
      include: { items: { include: { product: true } } },
    });
  });
};

const cancel = async (id) => {
  return prisma.cycleCount.update({ where: { id }, data: { status: "CANCELLED" } });
};

const getAll = async ({ page = 1, limit = 20, status = "" }) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = { ...(status && { status }) };
  const [cycleCounts, total] = await Promise.all([
    prisma.cycleCount.findMany({
      where,
      skip,
      take: Number(limit),
      include: { createdBy: { select: { id: true, fullName: true } }, items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cycleCount.count({ where }),
  ]);
  return {
    cycleCounts,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const cycleCount = await prisma.cycleCount.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, fullName: true } },
      items: { include: { product: { include: { inventories: true } } } },
    },
  });
  if (!cycleCount) throw { status: 404, message: "Không tìm thấy phiếu kiểm kê" };
  return cycleCount;
};

module.exports = { generateCode, create, recordCount, complete, cancel, getAll, getById };
