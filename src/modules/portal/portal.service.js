// src/modules/portal/portal.service.js
// Customer self-service portal: OTP login, view orders/debt/invoices/loyalty
const prisma = require("../../config/prisma");
const crypto = require("crypto");

const OTP_EXPIRY_MINUTES = 5;
const SESSION_EXPIRY_HOURS = 24;

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateToken = () => crypto.randomBytes(32).toString("hex");

// Step 1: Send OTP (in production, integrate FPT/Viettel SMS)
const requestOtp = async (phone) => {
  const customer = await prisma.customer.findFirst({ where: { phone } });
  if (!customer) throw { status: 404, message: "Không tìm thấy khách hàng với số điện thoại này" };

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate previous OTPs for this phone
  await prisma.portalOtp.updateMany({ where: { phone, used: false }, data: { used: true } });

  await prisma.portalOtp.create({ data: { phone, otp, expiresAt } });

  // TODO: send SMS via FPT/Viettel brandname SMS
  console.log(`[portal-otp] Phone: ${phone} OTP: ${otp}`); // dev mode — log only

  return { message: "OTP đã được gửi", expiresIn: OTP_EXPIRY_MINUTES * 60 };
};

// Step 2: Verify OTP and create session
const verifyOtp = async (phone, otp) => {
  const record = await prisma.portalOtp.findFirst({
    where: { phone, otp, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) throw { status: 401, message: "OTP không đúng hoặc đã hết hạn" };

  await prisma.portalOtp.update({ where: { id: record.id }, data: { used: true } });

  const customer = await prisma.customer.findFirst({ where: { phone } });
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 3600 * 1000);

  await prisma.portalSession.create({ data: { customerId: customer.id, token, expiresAt } });
  return { token, expiresAt, customerId: customer.id };
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
    where: { customerId, status: { not: "PAID" } },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 3 } },
    orderBy: { dueDate: "asc" },
  });
  const totalOwed = debts.reduce((s, d) => s + Number(d.remaining || 0), 0);
  return { debts, totalOwed };
};

const getMyProfile = async (customerId) => {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true, email: true, totalSpent: true, orderCount: true, loyaltyPoints: true, createdAt: true },
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

module.exports = { requestOtp, verifyOtp, resolveSession, getMyOrders, getMyDebt, getMyProfile, getMyInvoices };
