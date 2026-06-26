/**
 * modules/loyalty/loyalty.service.js — Service quản lý điểm thưởng (Loyalty)
 *
 * Tổng quan:
 * - Quản lý chương trình khách hàng thân thiết: tích điểm, đổi điểm, hạng thành viên
 * - Xác định hạng (tier) dựa trên tổng chi tiêu: BRONZE → SILVER → GOLD → PLATINUM
 * - Mỗi hạng có % giảm giá riêng (0% / 3% / 5% / 8%)
 * - Tự động tích điểm khi đơn hoàn thành, rollback khi huỷ
 * - Cron job xử lý điểm hết hạn sau 12 tháng
 * - Hỗ trợ điều chỉnh điểm thủ công
 *
 * Hàm:
 * - computeTier(totalSpent): Xác định hạng thành viên dựa trên tổng chi tiêu
 * - pointsFromAmount(amount): Tính số điểm tích luỹ từ số tiền (cấu hình POINTS_PER_1000)
 * - getTierDiscountPercent(tier): Lấy % giảm giá theo hạng
 * - applyTierDiscount(subtotal, tier): Tính số tiền giảm giá theo hạng thành viên
 * - redeemValueFromPoints(points): Tính giá trị quy đổi từ số điểm (cấu hình REDEEM_POINTS / REDEEM_VALUE)
 * - recordTx(tx, { customerId, points, type, orderId, note, expiresAt }): Ghi giao dịch loyalty và cập nhật loyaltyPoints trong transaction
 * - earnOnOrderCompleted(tx, order): Tích điểm cho khách khi đơn hoàn thành, kiểm tra và cập nhật tier
 * - rollbackOnCancel(tx, order): Hoàn điểm khi huỷ đơn — rollback điểm đã tích và điểm đã đổi, cập nhật lại tier
 * - getLoyaltySummary(customerId): Trả về tổng quan loyalty của khách: tier, điểm, lịch sử 50 giao dịch, tỷ lệ quy đổi
 * - redeemInTx(tx, customerId, points, orderId): Đổi điểm trong transaction, kiểm tra điểm tối thiểu và số dư, trả về discount và points
 * - redeemForOrder(customerId, points, orderId): Wrapper public gọi redeemInTx trong transaction riêng
 * - adjustPoints(customerId, points, note, userId): Điều chỉnh điểm thủ công (ADMIN), trả về customer sau khi cập nhật
 * - expirePoints(): Cron job đánh dấu điểm hết hạn (sau 12 tháng), tạo giao dịch EXPIRE, cập nhật lại tier cho tất cả khách hàng
 */

const prisma = require("../../config/prisma");
const POINTS_PER_1000 = Number(process.env.LOYALTY_POINTS_PER_1000 || 1);
const REDEEM_POINTS = Number(process.env.LOYALTY_REDEEM_POINTS || 100);
const REDEEM_VALUE = Number(process.env.LOYALTY_REDEEM_VALUE || 10000);

const TIER_LABEL = {
  BRONZE: "Đồng",
  SILVER: "Bạc",
  GOLD: "Vàng",
  PLATINUM: "Kim cương",
};

const TIER_THRESHOLDS = {
  SILVER: 1_000_000,
  GOLD: 5_000_000,
  PLATINUM: 10_000_000,
};

const TIER_DISCOUNT = {
  BRONZE: 0,
  SILVER: 3,
  GOLD: 5,
  PLATINUM: 8,
};

const computeTier = (totalSpent) => {
  const spent = Number(totalSpent || 0);
  if (spent >= TIER_THRESHOLDS.PLATINUM) return "PLATINUM";
  if (spent >= TIER_THRESHOLDS.GOLD) return "GOLD";
  if (spent >= TIER_THRESHOLDS.SILVER) return "SILVER";
  return "BRONZE";
};

const pointsFromAmount = (amount) =>
  Math.floor((Number(amount) / 1000) * POINTS_PER_1000);

const getTierDiscountPercent = (tier) => TIER_DISCOUNT[tier] || 0;

const applyTierDiscount = (subtotal, tier) => {
  const pct = getTierDiscountPercent(tier);
  if (!pct) return 0;
  return Math.round((Number(subtotal) * pct) / 100);
};

const redeemValueFromPoints = (points) =>
  Math.floor(points / REDEEM_POINTS) * REDEEM_VALUE;

const recordTx = async (
  tx,
  { customerId, points, type, orderId, note, expiresAt },
) => {
  await tx.loyaltyTransaction.create({
    data: { customerId, points, type, orderId, note, expiresAt },
  });
  await tx.customer.update({
    where: { id: customerId },
    data: { loyaltyPoints: { increment: points } },
  });
};

const earnOnOrderCompleted = async (tx, order) => {
  if (!order.customerId) return;
  const points = pointsFromAmount(order.total);
  if (points <= 0) return;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 12);
  await recordTx(tx, {
    customerId: order.customerId,
    points,
    type: "EARN",
    orderId: order.id,
    note: `Tích điểm đơn ${order.orderCode}`,
    expiresAt,
  });
  const customer = await tx.customer.findUnique({
    where: { id: order.customerId },
  });
  const tier = computeTier(customer.totalSpent);
  if (tier !== customer.tier) {
    await tx.customer.update({
      where: { id: order.customerId },
      data: { tier },
    });
  }
};

const rollbackOnCancel = async (tx, order) => {
  if (!order.customerId) return;
  const earned = await tx.loyaltyTransaction.findFirst({
    where: { orderId: order.id, type: "EARN" },
  });
  if (earned && earned.points > 0) {
    await recordTx(tx, {
      customerId: order.customerId,
      points: -earned.points,
      type: "ADJUST",
      orderId: order.id,
      note: `Hoàn điểm hủy đơn ${order.orderCode}`,
    });
  }
  const redeemed = order.loyaltyPointsUsed || 0;
  if (redeemed > 0) {
    await recordTx(tx, {
      customerId: order.customerId,
      points: redeemed,
      type: "ADJUST",
      orderId: order.id,
      note: `Hoàn điểm đã đổi — đơn ${order.orderCode}`,
    });
  }
  const customer = await tx.customer.findUnique({
    where: { id: order.customerId },
  });
  if (customer) {
    await tx.customer.update({
      where: { id: order.customerId },
      data: { tier: computeTier(customer.totalSpent) },
    });
  }
};

const getLoyaltySummary = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      tier: true,
      loyaltyPoints: true,
      totalSpent: true,
    },
  });
  if (!customer) throw { status: 404, message: "Không tìm thấy khách hàng" };
  const history = await prisma.loyaltyTransaction.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    ...customer,
    tierDiscountPercent: getTierDiscountPercent(customer.tier),
    redeemRate: { points: REDEEM_POINTS, value: REDEEM_VALUE },
    history,
  };
};

const redeemInTx = async (tx, customerId, points, orderId) => {
  if (points < REDEEM_POINTS) {
    throw { status: 400, message: `Tối thiểu ${REDEEM_POINTS} điểm để đổi` };
  }
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.loyaltyPoints < points) {
    throw { status: 400, message: "Không đủ điểm" };
  }
  await recordTx(tx, {
    customerId,
    points: -points,
    type: "REDEEM",
    orderId,
    note: `Đổi ${points} điểm`,
  });
  return { discount: redeemValueFromPoints(points), points };
};

const redeemForOrder = async (customerId, points, orderId) =>
  prisma.$transaction((tx) => redeemInTx(tx, customerId, points, orderId));

const adjustPoints = async (customerId, points, note, userId) => {
  return prisma.$transaction(async (tx) => {
    await recordTx(tx, {
      customerId,
      points,
      type: "ADJUST",
      note: note || "Điều chỉnh thủ công",
    });
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
    });
    return customer;
  });
};

const expirePoints = async () => {
  const now = new Date();
  const expired = await prisma.loyaltyTransaction.findMany({
    where: { type: "EARN", expiresAt: { lte: now }, points: { gt: 0 } },
  });
  let count = 0;
  for (const tx of expired) {
    const already = await prisma.loyaltyTransaction.findFirst({
      where: { orderId: tx.orderId, type: "EXPIRE" },
    });
    if (already) continue;
    const customer = await prisma.customer.findUnique({
      where: { id: tx.customerId },
    });
    if (!customer || customer.loyaltyPoints < tx.points) continue;
    await prisma.$transaction(async (inner) => {
      await recordTx(inner, {
        customerId: tx.customerId,
        points: -tx.points,
        type: "EXPIRE",
        orderId: tx.orderId,
        note: "Điểm hết hạn",
      });
    });
    count += 1;
  }
  const customers = await prisma.customer.findMany({
    select: { id: true, totalSpent: true },
  });
  for (const c of customers) {
    const tier = computeTier(c.totalSpent);
    await prisma.customer.update({ where: { id: c.id }, data: { tier } });
  }
  return count;
};

module.exports = {
  POINTS_PER_1000,
  REDEEM_POINTS,
  REDEEM_VALUE,
  TIER_LABEL,
  computeTier,
  getTierDiscountPercent,
  applyTierDiscount,
  pointsFromAmount,
  redeemValueFromPoints,
  earnOnOrderCompleted,
  rollbackOnCancel,
  getLoyaltySummary,
  redeemInTx,
  redeemForOrder,
  adjustPoints,
  expirePoints,
};
