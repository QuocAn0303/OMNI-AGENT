/**
 * modules/portal/portal.service.js — Cổng thông tin khách hàng tự phục vụ
 * 
 * Tổng quan:
 * - Xác thực khách hàng qua OTP (SMS)
 * - Quản lý session portal
 * - Tra cứu đơn hàng, công nợ, hoá đơn điện tử, loyalty
 * 
 * Hàm:
 * - generateOtp(): Sinh mã OTP 6 chữ số
 * - generateToken(): Sinh token session ngẫu nhiên
 * - requestOtp(phone): Gửi OTP đến số điện thoại, invalidate OTP cũ
 * - verifyOtp(phone, otp): Xác thực OTP, tạo session mới
 * - resolveSession(token): Lấy thông tin khách hàng từ token session
 * - getMyOrders(customerId, {page, limit}): Lấy đơn hàng của khách, phân trang
 * - getMyDebt(customerId): Lấy công nợ chưa đóng + tổng nợ
 * - getMyProfile(customerId): Lấy thông tin cá nhân
 * - getMyInvoices(customerId, {page, limit}): Lấy hoá đơn điện tử đã ký
 */
// src/modules/portal/portal.service.js
// Customer self-service portal: OTP login, view orders/debt/invoices/loyalty
const prisma = require("../../config/prisma");
const crypto = require("crypto");
const { sendSms } = require("../../utils/sms");
const { runWithTenant } = require("../../config/tenantContext");
const logger = require("../../utils/logger");
const auditService = require("../audit/audit.service");

const OTP_EXPIRY_MINUTES = 5;
const SESSION_EXPIRY_HOURS = 24;
const OTP_ATTEMPT_LIMIT = 5;
const OTP_BLOCK_MINUTES = 15;

// crypto.randomInt — không dùng Math.random (không an toàn cho OTP)
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();
const generateToken = () => crypto.randomBytes(32).toString("hex");
const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

// Step 1: Send OTP (in production, integrate FPT/Viettel SMS)
const requestOtp = async (phone) => {
  const customer = await prisma.customer.findFirst({ where: { phone } });
  if (!customer) throw { status: 404, message: "Không tìm thấy khách hàng với số điện thoại này" };

  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate previous OTPs for this phone
  await prisma.portalOtp.updateMany({ where: { phone, used: false }, data: { used: true } });

  // Gắn tenantId của khách hàng vào OTP record → verify sau này scope đúng tenant
  await prisma.portalOtp.create({
    data: { phone, otp: otpHash, expiresAt, tenantId: customer.tenantId || null },
  });

  try {
    await sendSms(phone, `Ma OTP đăng nhập Aduu ERP: ${otp}. Co hieu luc ${OTP_EXPIRY_MINUTES} phut.`);
  } catch (e) {
    logger.warn(`[portal-otp] SMS thất bại: ${e.message}`);
    logger.info(`[portal-otp] OTP requested for phone: ${phone.replace(/(\d{3})\d+(\d{2})/, '$1***$2')} (không log OTP)`);
  }

  return { message: "OTP đã được gửi", expiresIn: OTP_EXPIRY_MINUTES * 60 };
};

// Step 2: Verify OTP and create session
const verifyOtp = async (phone, otp) => {
  const customer = await prisma.customer.findFirst({ where: { phone } });
  if (!customer) throw { status: 401, message: "OTP không đúng hoặc đã hết hạn" };

  // Scope toàn bộ luồng verify theo tenant của khách hàng
  return runWithTenant(customer.tenantId || null, async () => {
    const record = await prisma.portalOtp.findFirst({
      where: { phone, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!record) throw { status: 401, message: "OTP không đúng hoặc đã hết hạn" };

    // Đang bị khóa do thử sai quá nhiều
    if (record.blockedUntil && new Date(record.blockedUntil) > new Date()) {
      const minutes = Math.ceil((new Date(record.blockedUntil) - new Date()) / 60000);
      throw { status: 429, message: `Quá nhiều lần thử sai. Vui lòng thử lại sau ${minutes} phút` };
    }

    if (record.otp !== hashOtp(otp)) {
      const attempts = Number(record.attempts || 0) + 1;
      if (attempts >= OTP_ATTEMPT_LIMIT) {
        // Đạt ngưỡng → khóa 15 phút + hủy OTP hiện tại
        await prisma.portalOtp.update({
          where: { id: record.id },
          data: {
            attempts,
            used: true,
            blockedUntil: new Date(Date.now() + OTP_BLOCK_MINUTES * 60 * 1000),
          },
        });
        throw { status: 429, message: `Quá nhiều lần thử sai. Vui lòng thử lại sau ${OTP_BLOCK_MINUTES} phút` };
      }
      await prisma.portalOtp.update({ where: { id: record.id }, data: { attempts } });
      throw { status: 401, message: "OTP không đúng hoặc đã hết hạn" };
    }

    await prisma.portalOtp.update({ where: { id: record.id }, data: { used: true } });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 3600 * 1000);

    await prisma.portalSession.create({
      data: { customerId: customer.id, tenantId: customer.tenantId || null, token, expiresAt },
    });
    auditService.log({ action: 'PORTAL_LOGIN', entity: 'PortalSession', entityId: null, after: { customerId: customer.id } });
    return { token, expiresAt, customerId: customer.id, tenantId: customer.tenantId };
  });
};

// Resolve session to customer
const resolveSession = async (token) => {
  const session = await prisma.portalSession.findUnique({
    where: { token },
    include: { customer: true },
  });
  if (!session || session.expiresAt < new Date()) {
    throw { status: 401, message: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại" };
  }
  // Session phải có tenant — dữ liệu khách hàng chỉ truy cập trong scope tenant
  if (!session.customer?.tenantId) {
    throw { status: 401, message: "Phiên không hợp lệ, vui lòng đăng nhập lại" };
  }
  return session.customer;
};

// Customer dashboard data
const getMyOrders = async (customerId, { page = 1, limit = 10 } = {}) => {
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { customerId },
      include: { items: { include: { product: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.order.count({ where: { customerId } }),
  ]);
  return { orders, pagination: { page: Number(page), limit: Number(limit), total } };
};

const getMyDebt = async (customerId) => {
  const debts = await prisma.debt.findMany({
    where: { customerId, status: { not: "CLOSED" } },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 3 } },
    orderBy: { dueDate: "asc" },
  });
  const totalOwed = debts.reduce(
    (s, d) => s + (Number(d.amount) - Number(d.paidAmount)),
    0,
  );
  return { debts, totalOwed };
};

const getMyProfile = async (customerId) => {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true, email: true, totalSpent: true, _count: { select: { orders: true } }, loyaltyPoints: true, createdAt: true },
  });
};

const getMyInvoices = async (customerId, { page = 1, limit = 10 } = {}) => {
  const orders = await prisma.order.findMany({
    where: { customerId },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  return prisma.electronicInvoice.findMany({
    where: { orderId: { in: orderIds }, cqtStatus: { in: ["SIGNED", "ACCEPTED", "SENT"] } },
    orderBy: { issueDate: "desc" },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit),
  });
};

// ════════════════ PHASE E: SELF-SERVICE ════════════════

const createMyOrder = async (customerId, { items, note, paymentMethod = "BANK_TRANSFER" }) => {
  if (!items || !items.length) throw { status: 400, message: "Vui lòng chon it nhat 1 sản phẩm" };

  const orderService = require("../orders/order.service");
  const resolvedItems = [];

  // B5: batch fetch product — trước đây 1 query DB mỗi sản phẩm trong giỏ (N+1)
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: { id: true, name: true, price: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) throw { status: 404, message: `Sản phẩm ${item.productId} không ton tai` };
    resolvedItems.push({
      productId: product.id,
      quantity: Math.max(1, parseInt(item.quantity) || 1),
      price: Number(product.price),
    });
  }

  const order = await orderService.create({
    customerId,
    items: resolvedItems,
    paymentMethod,
    note: note || `[Portal] Khach tu dat hang`,
    status: "PENDING",
  }, null);

  auditService.log({ action: 'PORTAL_CREATE_ORDER', entity: 'Order', entityId: order.id, after: { customerId, total: Number(order.total) } });
  return { orderCode: order.orderCode, total: Number(order.total), items: resolvedItems.length };
};

const payMyDebt = async (customerId) => {
  const debts = await prisma.debt.findMany({
    where: { customerId, status: { not: "CLOSED" } },
    orderBy: { dueDate: "asc" },
    include: { payments: true },
  });

  if (!debts.length) return { totalOwed: 0, message: "Không có công nợ", qrCode: null };

  const totalOwed = debts.reduce((s, d) => s + (Number(d.amount) - Number(d.paidAmount)), 0);
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { isDefault: true },
    select: { accountNumber: true, bankName: true, accountName: true },
  });

  const description = `Thanh toan công nợ — KH ${customerId.slice(0, 8)}`;
  let qrCode = null;

  if (bankAccount) {
    try {
      const { buildVietQRString } = require("../../utils/vietqr");
      const BANK_BINS = {
        VCB: "970436", TCB: "970407", MB: "970422", BIDV: "970418",
        ACB: "970416", VPBank: "970432", VietinBank: "970415", Sacombank: "970403",
      };
      const bankBin = BANK_BINS[bankAccount.bankName] || "970436";
      qrCode = buildVietQRString({
        bankBin,
        accountNumber: bankAccount.accountNumber,
        amount: totalOwed,
        description,
        accountName: bankAccount.accountName,
      });
    } catch (e) {
      logger.warn("[portal] VietQR generation failed:", e.message);
    }
  }

  return {
    totalOwed,
    debts: debts.map((d) => ({
      id: d.id,
      amount: Number(d.amount),
      paid: Number(d.paidAmount),
      remaining: Number(d.amount) - Number(d.paidAmount),
      dueDate: d.dueDate,
      type: d.type,
    })),
    qrCode,
    bankInfo: bankAccount ? {
      bankName: bankAccount.bankName,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountName,
      description,
    } : null,
  };
};

const getMyRewards = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { loyaltyPoints: true, tier: true, totalSpent: true },
  });

  const promotions = await prisma.promotion.findMany({
    where: {
      status: "ACTIVE",
      isActive: true,
      scope: { not: "PRODUCT" },
      OR: [
        { minOrderValue: { lte: customer.totalSpent } },
        { minOrderValue: null },
      ],
    },
    take: 10,
  });

  const pointsHistory = await prisma.loyaltyTransaction.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { points: true, type: true, description: true, createdAt: true },
  });

  // Simple rewards based on points
  const rewards = [];
  if (customer.loyaltyPoints >= 100) {
    rewards.push({ id: "reward_10k", name: "Giam gia 10,000 VND", points: 100, type: "DISCOUNT" });
  }
  if (customer.loyaltyPoints >= 500) {
    rewards.push({ id: "reward_50k", name: "Giam gia 50,000 VND", points: 500, type: "DISCOUNT" });
  }
  if (customer.loyaltyPoints >= 1000) {
    rewards.push({ id: "reward_100k", name: "Giam gia 100,000 VND", points: 1000, type: "DISCOUNT" });
  }

  return {
    points: customer.loyaltyPoints,
    tier: customer.tier,
    totalSpent: Number(customer.totalSpent),
    availableRewards: rewards.map((r) => ({
      ...r,
      canRedeem: customer.loyaltyPoints >= r.points,
    })),
    pointsHistory,
    activePromotions: promotions.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      value: p.value,
      scope: p.scope,
    })),
  };
};

const redeemReward = async (customerId, rewardId) => {
  const rewards = {
    reward_10k: { points: 100, name: "Giam gia 10,000 VND" },
    reward_50k: { points: 500, name: "Giam gia 50,000 VND" },
    reward_100k: { points: 1000, name: "Giam gia 100,000 VND" },
  };

  const reward = rewards[rewardId];
  if (!reward) throw { status: 404, message: "Phan thuong không ton tai" };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (customer.loyaltyPoints < reward.points) {
    throw { status: 400, message: `Không du diem. Can ${reward.points}, hien co ${customer.loyaltyPoints}` };
  }

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: { decrement: reward.points } },
    }),
    prisma.loyaltyTransaction.create({
      data: {
        customerId,
        points: -reward.points,
        type: "REDEEM",
        description: `Doi ${reward.name}`,
      },
    }),
  ]);

  auditService.log({ action: 'PORTAL_REDEEM_REWARD', entity: 'LoyaltyTransaction', entityId: null, after: { customerId, rewardId, points: reward.points } });
  return {
    success: true,
    redeemed: reward,
    remainingPoints: customer.loyaltyPoints - reward.points,
  };
};

module.exports = {
  requestOtp, verifyOtp, resolveSession,
  getMyOrders, getMyDebt, getMyProfile, getMyInvoices,
  createMyOrder, payMyDebt, getMyRewards, redeemReward,
};
