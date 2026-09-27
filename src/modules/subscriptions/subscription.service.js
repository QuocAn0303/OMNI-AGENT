/**
 * modules/subscriptions/subscription.service.js — Quản lý gói dịch vụ & đăng ký
 * 
 * Tổng quan:
 * - CRUD gói dịch vụ (subscription plans)
 * - Gán/huỷ gói cho tenant
 * - Quản lý hoá đơn subscription
 * - Xử lý nâng cấp gói qua PAYOS
 * - Xử lý webhook thanh toán
 * - Kiểm tra và đánh dấu subscription hết hạn
 * 
 * Hàm:
 * - getPlans(activeOnly): Danh sách gói dịch vụ
 * - getPlanById(id): Chi tiết gói
 * - createPlan(data, userId): Tạo gói mới + audit
 * - updatePlan(id, data, userId): Cập nhật gói + audit
 * - deletePlan(id, userId): Xoá mềm gói + audit
 * - getTenantSubscription(tenantId): Subscription hiện tại của tenant
 * - getAllTenantSubscriptions(): Tất cả subscription (admin)
 * - assignPlanToTenant(tenantId, planId, userId, extras): Gán gói, cancel subscription cũ, ghi audit
 * - generateInvoice(subscriptionId, userId): Tạo hoá đơn cho subscription
 * - updateInvoiceStatus(id, status, userId, extras): Cập nhật trạng thái hoá đơn
 * - getTenantInvoices(tenantId): Hoá đơn của tenant
 * - getAllInvoices(filters): Tất cả hoá đơn (admin)
 * - getMyPlanFeatures(tenantId): Lấy features của gói đang dùng + helper isAllowed(moduleKey)
 * - requestUpgrade(tenantId, planId, userId): Yêu cầu nâng gói, tạo link thanh toán PAYOS
 * - generateInvoiceForUpgrade(tenantId, plan, userId, subscriptionId): Tạo hoá đơn tạm cho upgrade
 * - handlePaymentWebhook(webhookBody): Xử lý webhook PAYOS, cập nhật invoice + subscription
 * - checkExpiredSubscriptions(): Đánh dấu subscription hết hạn thành EXPIRED
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");
const { createPaymentLink, verifyWebhook } = require("../../config/payos");
const { invalidatePlanCache } = require("../../middleware/plan.middleware");

const getPlans = async (activeOnly = true) => {
  const where = activeOnly ? { isActive: true } : {};
  return prisma.subscriptionPlan.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });
};

const getPlanById = async (id) => {
  return prisma.subscriptionPlan.findUnique({ where: { id } });
};

const createPlan = async (data, userId) => {
  const plan = await prisma.subscriptionPlan.create({ data });

  auditService.log({
    userId,
    action: "CREATE_SUBSCRIPTION_PLAN",
    entity: "SubscriptionPlan",
    entityId: plan.id,
    after: { name: plan.name, key: plan.key, price: plan.price },
  });

  return plan;
};

const updatePlan = async (id, data, userId) => {
  const before = await prisma.subscriptionPlan.findUnique({ where: { id } });
  const plan = await prisma.subscriptionPlan.update({ where: { id }, data });

  auditService.log({
    userId,
    action: "UPDATE_SUBSCRIPTION_PLAN",
    entity: "SubscriptionPlan",
    entityId: id,
    before: { name: before?.name, price: before?.price },
    after: { name: plan.name, price: plan.price },
  });

  return plan;
};

const deletePlan = async (id, userId) => {
  const plan = await prisma.subscriptionPlan.update({
    where: { id },
    data: { isActive: false },
  });

  auditService.log({
    userId,
    action: "DELETE_SUBSCRIPTION_PLAN",
    entity: "SubscriptionPlan",
    entityId: id,
  });

  return plan;
};

const getTenantSubscription = async (tenantId) => {
  if (!tenantId) {
    return null;
  }
  return prisma.tenantSubscription.findFirst({
    where: { tenantId },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
};

const getAllTenantSubscriptions = async () => {
  return prisma.tenantSubscription.findMany({
    include: {
      tenant: true,
      plan: true,
      _count: { select: { invoices: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

const assignPlanToTenant = async (tenantId, planId, userId, extras = {}) => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw { status: 404, message: "Không tìm thấy gói" };

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw { status: 404, message: "Không tìm thấy tenant" };

  // Cancel active subscriptions
  await prisma.tenantSubscription.updateMany({
    where: { tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + plan.durationDays);

  const sub = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId,
      status: "ACTIVE",
      startDate,
      endDate,
      createdById: userId,
      note: extras.note || null,
      autoRenew: extras.autoRenew ?? true,
    },
  });

  invalidatePlanCache(tenantId);

  auditService.log({
    userId,
    action: "ASSIGN_PLAN",
    entity: "TenantSubscription",
    entityId: sub.id,
    after: { tenantId, planId: plan.id, planName: plan.name, endDate },
  });

  return sub;
};

const generateInvoice = async (subscriptionId, userId) => {
  const sub = await prisma.tenantSubscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, tenant: true },
  });
  if (!sub) throw { status: 404, message: "Không tìm thấy subscription" };

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.subscriptionInvoice.count({
    where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  const invoiceCode = `INV-${dateStr}-${String(count + 1).padStart(4, "0")}`;

  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      invoiceCode,
      subscriptionId: sub.id,
      tenantId: sub.tenantId,
      amount: sub.plan.price,
      currency: sub.plan.currency,
      status: "PENDING",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  auditService.log({
    userId,
    action: "GENERATE_INVOICE",
    entity: "SubscriptionInvoice",
    entityId: invoice.id,
    after: { invoiceCode, amount: sub.plan.price, tenantId: sub.tenantId },
  });

  return invoice;
};

const updateInvoiceStatus = async (id, status, userId, extras = {}) => {
  const data = { status };
  if (status === "PAID") {
    data.paidAt = new Date();
    data.paidById = userId;
    data.paymentMethod = extras.paymentMethod || null;
  }

  return prisma.subscriptionInvoice.update({
    where: { id },
    data,
  });
};

const getTenantInvoices = async (tenantId) => {
  return prisma.subscriptionInvoice.findMany({
    where: { tenantId },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
  });
};

const getAllInvoices = async (filters = {}) => {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.tenantId) where.tenantId = filters.tenantId;

  return prisma.subscriptionInvoice.findMany({
    where,
    include: { tenant: true, subscription: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
  });
};

const getMyPlanFeatures = async (tenantId) => {
  const sub = await getTenantSubscription(tenantId);
  // M10: tenant chưa đăng ký gói → fallback gói FREE (key "free" trong seed)
  // Đồng bộ với plan.middleware.js/getEffectivePlan
  const freePlan = !sub
    ? await prisma.subscriptionPlan.findUnique({ where: { key: "free" } }).catch(() => null)
    : null;
  if (!sub && !freePlan) return null;
  return {
    plan: sub?.plan || freePlan,
    subscription: sub || null,
    features: (sub?.plan || freePlan).features || {},
    isExpired: sub?.status === "EXPIRED",
    isAllowed: (moduleKey) => {
      const allowed = (sub?.plan || freePlan).features?.allowedModules || [];
      return allowed.includes("*") || allowed.includes(moduleKey);
    },
  };
};

const requestUpgrade = async (tenantId, planId, userId) => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw { status: 404, message: "Không tìm thấy gói" };

  const currentSub = await getTenantSubscription(tenantId);
  if (currentSub && currentSub.planId === planId) {
    throw { status: 400, message: "Bạn đang sử dụng gói này" };
  }
  if (!currentSub) {
    throw { status: 400, message: "Chưa có gói dịch vụ nào. Vui lòng đăng ký gói trước." };
  }

  const invoice = await generateInvoiceForUpgrade(tenantId, plan, userId, currentSub.id);

  const amount = Number(plan.price);
  const orderCode = Number(`${Date.now()}${String(invoice.id).slice(0, 4)}`.slice(0, 15));
  const description = `Nang goi ${plan.name}`;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  const returnUrl = process.env.PAYOS_RETURN_URL ||
    `http://localhost:5173/subscription/success?tenantId=${tenantId}&planId=${planId}`;
  const cancelUrl = process.env.PAYOS_CANCEL_URL ||
    `http://localhost:5173/subscription/cancel`;

  const paymentLink = await createPaymentLink({
    orderCode,
    amount,
    description,
    returnUrl,
    cancelUrl,
  });

  await prisma.subscriptionInvoice.update({
    where: { id: invoice.id },
    data: { checkoutSessionId: String(paymentLink.id || orderCode) },
  });

  auditService.log({
    userId,
    action: "UPGRADE_REQUEST",
    entity: "TenantSubscription",
    entityId: invoice.id,
    after: { tenantId, planId: plan.id, planName: plan.name, amount: plan.price, checkoutUrl: paymentLink.checkoutUrl },
  });

  return { checkoutUrl: paymentLink.checkoutUrl, invoice };
};

const generateInvoiceForUpgrade = async (tenantId, plan, userId, subscriptionId) => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const count = await prisma.subscriptionInvoice.count({
    where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  const invoiceCode = `UPG-${dateStr}-${String(count + 1).padStart(4, "0")}`;

  return prisma.subscriptionInvoice.create({
    data: {
      invoiceCode,
      subscriptionId,
      tenantId,
      amount: plan.price,
      currency: plan.currency,
      status: "PENDING",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
};

const handlePaymentWebhook = async (webhookBody) => {
  const data = verifyWebhook(webhookBody);
  if (!data || !data.id) {
    throw { status: 400, message: "Webhook không hợp lệ" };
  }

  const checkoutSessionId = String(data.id);

  const invoice = await prisma.subscriptionInvoice.findUnique({
    where: { checkoutSessionId },
    include: { subscription: true, tenant: true },
  });
  if (!invoice) {
    throw { status: 404, message: "Không tìm thấy hóa đơn tương ứng" };
  }
  if (invoice.status === "PAID") {
    return { success: true, message: "Hóa đơn đã được thanh toán trước đó" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paymentMethod: "PAYOS",
      },
    });

    const subscription = await tx.tenantSubscription.findFirst({
      where: { tenantId: invoice.tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    if (subscription && subscription.planId !== invoice.subscription?.planId) {
      await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }

    const plan = await tx.subscriptionPlan.findUnique({
      where: { id: invoice.subscription?.planId },
    });
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (plan?.durationDays || 30));

    await tx.tenantSubscription.upsert({
      where: { id: invoice.subscriptionId || "" },
      create: {
        tenantId: invoice.tenantId,
        planId: invoice.subscription?.planId || plan?.id || "",
        status: "ACTIVE",
        startDate,
        endDate,
      },
      update: {
        status: "ACTIVE",
        startDate,
        endDate,
        cancelledAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: null,
        action: "PAYMENT_SUCCESS",
        entity: "SubscriptionInvoice",
        entityId: invoice.id,
        after: { invoiceCode: invoice.invoiceCode, amount: invoice.amount, planId: invoice.subscription?.planId },
      },
    });
  });

  invalidatePlanCache(invoice.tenantId);

  return { success: true, message: "Thanh toán thành công" };
};

const checkExpiredSubscriptions = async () => {
  const now = new Date();
  const expiredRows = await prisma.tenantSubscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, endDate: { lte: now } },
    select: { tenantId: true },
    take: 500,
  });
  const expired = await prisma.tenantSubscription.updateMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, endDate: { lte: now } },
    data: { status: "EXPIRED" },
  });

  // Xoá cache plan của tenant vừa hết hạn (plan enforcement áp dụng ngay)
  for (const row of expiredRows) invalidatePlanCache(row.tenantId);

  return expired.count;
};

module.exports = {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  getTenantSubscription,
  getAllTenantSubscriptions,
  assignPlanToTenant,
  generateInvoice,
  updateInvoiceStatus,
  getTenantInvoices,
  getAllInvoices,
  getMyPlanFeatures,
  requestUpgrade,
  handlePaymentWebhook,
  checkExpiredSubscriptions,
};
