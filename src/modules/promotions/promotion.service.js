const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const engine = require("./promotion.engine");

const { toNum, round2 } = engine;

const now = () => new Date();

const activeWhere = () => ({
  status: "ACTIVE",
  startDate: { lte: now() },
  endDate: { gte: now() },
});

const loadProducts = async (items) => {
  const productIds = [...new Set(items.map((i) => i.productId))];
  return prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    include: { category: true },
  });
};

const checkPerUserLimit = async (promotionId, customerId, perUserLimit) => {
  if (!perUserLimit || !customerId) return true;
  const count = await prisma.promotionUsage.count({
    where: { promotionId, customerId },
  });
  return count < perUserLimit;
};

const incrementUsageAtomic = async (tx, promotionId) => {
  const rows = await tx.$executeRaw`
    UPDATE promotions
    SET "usageCount" = "usageCount" + 1
    WHERE id = ${promotionId}
      AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")
  `;
  if (!rows) throw { status: 409, message: "Mã khuyến mãi đã hết lượt sử dụng" };
};

const create = async (data) => {
  if (data.scope === "VOUCHER_CODE" && !data.code) {
    throw { status: 400, message: "Voucher cần mã code" };
  }
  return prisma.promotion.create({
    data: {
      code: data.code?.toUpperCase() || null,
      name: data.name,
      description: data.description,
      type: data.type,
      scope: data.scope || "AUTO",
      status: data.status || "DRAFT",
      value: data.value,
      maxDiscount: data.maxDiscount,
      minOrderValue: data.minOrderValue,
      minQuantity: data.minQuantity,
      buyQuantity: data.buyQuantity,
      getQuantity: data.getQuantity,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      usageLimit: data.usageLimit,
      perUserLimit: data.perUserLimit,
      categoryId: data.categoryId,
      productId: data.productId,
    },
    include: { category: true, product: true },
  });
};

const list = async ({ page = 1, limit = 20, status, type, activeNow } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (activeNow === "true" || activeNow === true) Object.assign(where, activeWhere());

  const [promotions, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      skip,
      take: Number(limit),
      include: { category: true, product: { select: { id: true, name: true, sku: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.promotion.count({ where }),
  ]);
  return {
    promotions,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const promo = await prisma.promotion.findUnique({
    where: { id },
    include: {
      category: true,
      product: true,
      usages: {
        take: 20,
        orderBy: { createdAt: "desc" },
        include: { order: { select: { orderCode: true, total: true } } },
      },
    },
  });
  if (!promo) throw { status: 404, message: "Không tìm thấy khuyến mãi" };
  const stats = await prisma.promotionUsage.aggregate({
    where: { promotionId: id },
    _sum: { discountValue: true },
    _count: true,
  });
  return {
    ...promo,
    stats: {
      usageCount: promo.usageCount,
      totalDiscount: Number(stats._sum.discountValue || 0),
      orderCount: stats._count,
    },
  };
};

const update = async (id, data) => {
  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) throw { status: 404, message: "Không tìm thấy khuyến mãi" };
  if (existing.usageCount > 0 && data.code && data.code !== existing.code) {
    throw { status: 400, message: "Không đổi mã khi đã có lượt dùng" };
  }
  return prisma.promotion.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.value !== undefined && { value: data.value }),
      ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
      ...(data.minOrderValue !== undefined && { minOrderValue: data.minOrderValue }),
      ...(data.startDate && { startDate: new Date(data.startDate) }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.usageLimit !== undefined && { usageLimit: data.usageLimit }),
      ...(data.perUserLimit !== undefined && { perUserLimit: data.perUserLimit }),
    },
  });
};

const setStatus = async (id, status) => {
  return prisma.promotion.update({ where: { id }, data: { status } });
};

const remove = async (id) => {
  const promo = await prisma.promotion.findUnique({ where: { id }, include: { _count: { select: { usages: true } } } });
  if (!promo) throw { status: 404, message: "Không tìm thấy khuyến mãi" };
  if (promo._count.usages > 0) {
    throw { status: 400, message: "Không xóa khuyến mãi đã có lượt sử dụng" };
  }
  await prisma.promotion.delete({ where: { id } });
};

const previewAuto = async ({ items, customerId }) => {
  const products = await loadProducts(items);
  const cart = engine.buildCart(items, products);
  const promos = await prisma.promotion.findMany({
    where: { ...activeWhere(), scope: "AUTO" },
    include: { category: true, product: true },
  });
  const filtered = [];
  for (const p of promos) {
    if (!(await checkPerUserLimit(p.id, customerId, p.perUserLimit))) continue;
    filtered.push(p);
  }
  const { applied, totalDiscount } = engine.applyAutoPromotions(filtered, cart);
  return {
    cart: { subtotal: cart.subtotal },
    promotions: applied.map((a) => ({
      id: a.promotion.id,
      name: a.promotion.name,
      type: a.promotion.type,
      discount: a.discount,
    })),
    totalPromotionDiscount: totalDiscount,
  };
};

const validateVoucher = async ({ code, items, customerId }) => {
  const products = await loadProducts(items);
  const cart = engine.buildCart(items, products);
  const promo = await prisma.promotion.findFirst({
    where: { code: code.toUpperCase(), scope: "VOUCHER_CODE", ...activeWhere() },
  });
  if (!promo) throw { status: 404, message: "Mã voucher không hợp lệ hoặc đã hết hạn" };
  if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) {
    throw { status: 400, message: "Mã voucher đã hết lượt sử dụng" };
  }
  if (!(await checkPerUserLimit(promo.id, customerId, promo.perUserLimit))) {
    throw { status: 400, message: "Bạn đã dùng hết lượt voucher này" };
  }
  const min = promo.minOrderValue ? toNum(promo.minOrderValue) : 0;
  if (cart.subtotal < min) {
    throw {
      status: 400,
      message: `Đơn tối thiểu ${min.toLocaleString("vi-VN")}đ để dùng mã này`,
    };
  }
  const { discount, eligible } = engine.applyVoucher(promo, cart);
  if (!eligible) throw { status: 400, message: "Đơn hàng không đủ điều kiện áp voucher" };
  return { promotionId: promo.id, code: promo.code, name: promo.name, discount };
};

const recordUsagesInTx = async (tx, { orderId, customerId, applied, voucher }) => {
  const all = [...applied];
  if (voucher) all.push(voucher);
  for (const entry of all) {
    await incrementUsageAtomic(tx, entry.promotion.id);
    await tx.promotionUsage.create({
      data: {
        promotionId: entry.promotion.id,
        orderId,
        customerId: customerId || null,
        discountValue: entry.discount,
      },
    });
  }
};

const rollbackOrderPromotions = async (tx, orderId) => {
  const usages = await tx.promotionUsage.findMany({ where: { orderId } });
  for (const u of usages) {
    await tx.promotion.update({
      where: { id: u.promotionId },
      data: { usageCount: { decrement: 1 } },
    });
    await tx.promotionUsage.delete({ where: { id: u.id } });
  }
};

const resolveForOrder = async ({ items, customerId, voucherCode }) => {
  const products = await loadProducts(items);
  const cart = engine.buildCart(items, products);

  const autoPromos = await prisma.promotion.findMany({
    where: { ...activeWhere(), scope: "AUTO" },
  });
  const eligibleAuto = [];
  for (const p of autoPromos) {
    if (await checkPerUserLimit(p.id, customerId, p.perUserLimit)) eligibleAuto.push(p);
  }
  const { applied, totalDiscount: autoDiscount } = engine.applyAutoPromotions(eligibleAuto, cart);

  let voucher = null;
  let voucherDiscount = 0;
  if (voucherCode) {
    const v = await validateVoucher({ code: voucherCode, items, customerId });
    const promo = await prisma.promotion.findUnique({ where: { id: v.promotionId } });
    const afterAuto = { ...cart, subtotal: round2(cart.subtotal - autoDiscount) };
    const { discount } = engine.applyVoucher(promo, afterAuto);
    voucherDiscount = discount;
    voucher = { promotion: promo, discount };
  }

  return {
    promotionDiscount: round2(autoDiscount + voucherDiscount),
    applied,
    voucher,
    voucherCode: voucherCode?.toUpperCase() || null,
  };
};

const expirePromotions = async () => {
  const r = await prisma.promotion.updateMany({
    where: { status: "ACTIVE", endDate: { lt: now() } },
    data: { status: "EXPIRED" },
  });
  return r.count;
};

const reportEffectiveness = async ({ from, to } = {}) => {
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  const byPromo = await prisma.promotionUsage.groupBy({
    by: ["promotionId"],
    where,
    _sum: { discountValue: true },
    _count: true,
  });
  const promos = await prisma.promotion.findMany({
    where: { id: { in: byPromo.map((b) => b.promotionId) } },
    select: { id: true, code: true, name: true, type: true },
  });
  const map = Object.fromEntries(promos.map((p) => [p.id, p]));
  return byPromo
    .map((b) => ({
      promotion: map[b.promotionId],
      totalDiscount: Number(b._sum.discountValue || 0),
      usageCount: b._count,
    }))
    .sort((a, b) => b.totalDiscount - a.totalDiscount);
};

module.exports = {
  create,
  list,
  getById,
  update,
  setStatus,
  remove,
  previewAuto,
  validateVoucher,
  resolveForOrder,
  recordUsagesInTx,
  rollbackOrderPromotions,
  expirePromotions,
  reportEffectiveness,
};
