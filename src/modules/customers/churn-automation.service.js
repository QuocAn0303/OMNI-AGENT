/**
 * modules/customers/churn-automation.service.js — Churn Alert → Voucher Win-Back (Mục 4)
 *
 * Luồng automation (nối vào chuỗi Automation Flows hiện có):
 * 1. Sau khi clv-forecast.service.js cập nhật churnProbability (cron hàng đêm):
 *    nếu churnProbability >= 0.70 (CHURN_THRESHOLD) và KH chưa có alert PENDING/TRIGGERED:
 *    - Tạo ChurnAlert (HIGH nếu 0.70–0.85, CRITICAL nếu > 0.85)
 *    - Tạo Promotion unique-code (scope VOUCHER_CODE) — TÁI DÙNG Promotion Engine,
 *      KHÔNG tạo hệ thống voucher song song. expiresAt = +7 ngày (config được).
 *    - Tạo CustomerTask cho nhân viên CSKH (hạn 24h)
 *    - Notification cho nhân viên được gán
 * 2. Đóng vòng lặp:
 *    - RETAINED: KH có đơn COMPLETED mới áp đúng voucherCode của alert (hook từ
 *      orders/order.service.js hoặc cron quét)
 *    - LOST: quá expiresAt không có đơn mới
 *
 * Giá trị voucher: dùng % giảm mặc định từ env (CHURN_WINBACK_DISCOUNT_PCT, mặc định 10%)
 * — đơn vị kinh doanh tự điều chỉnh theo ngành, hệ thống không tự bịa mức chiết khấu.
 */
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const { runWithTenant } = require("../../config/tenantContext");
const logger = require("../../utils/logger");
const notificationService = require("../notifications/notification.service");
const promotionService = require("../promotions/promotion.service");

const CHURN_THRESHOLD = Number(process.env.CHURN_THRESHOLD || 0.7);
const CHURN_CRITICAL_THRESHOLD = Number(process.env.CHURN_CRITICAL_THRESHOLD || 0.85);
const VOUCHER_VALID_DAYS = Number(process.env.CHURN_VOUCHER_DAYS || 7);
const WINBACK_DISCOUNT_PCT = Number(process.env.CHURN_WINBACK_DISCOUNT_PCT || 10);
const TASK_DUE_HOURS = 24;

const riskLevelOf = (churnProbability) =>
  churnProbability > CHURN_CRITICAL_THRESHOLD ? "CRITICAL" : "HIGH";

/**
 * Sinh mã voucher unique trong tenant.
 * Promotion.code KHÔNG có ràng buộc unique ở DB (không đổi schema cũ), nên phải
 * tự kiểm tra trùng trước khi gọi Promotion Engine (Mục 4.4 — dedupe code).
 */
const generateUniqueVoucherCode = async (client = prisma) => {
  for (let i = 0; i < 5; i += 1) {
    const code = `WINBACK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const dup = await client.promotion.findFirst({ where: { code }, select: { id: true } });
    if (!dup) return code;
  }
  throw { status: 500, message: "Không sinh được mã voucher không trùng — thử lại sau" };
};

// Tạo alert + voucher + task + notification cho 1 customer đã được chấm điểm
const processCustomer = async (customer, userId = null) => {
  const p = customer?.churnProbability;
  if (p == null || p < CHURN_THRESHOLD) return null;

  // Dedupe: không tạo trùng alert khi còn PENDING/TRIGGERED
  const existing = await prisma.churnAlert.findFirst({
    where: { customerId: customer.id, status: { in: ["PENDING", "TRIGGERED"] } },
  });
  if (existing) return { alert: existing, created: false };

  const now = new Date();
  const expiresAt = new Date(now.getTime() + VOUCHER_VALID_DAYS * 86_400_000);
  const code = await generateUniqueVoucherCode();

  const promotion = await promotionService.create(
    {
      code,
      name: `Win-back ${customer.name || customer.id}`,
      description: `Voucher giữ chân khách hàng — churn ${Math.round(p * 100)}%`,
      type: "PERCENTAGE",
      scope: "VOUCHER_CODE",
      status: "ACTIVE",
      value: WINBACK_DISCOUNT_PCT,
      startDate: now,
      endDate: expiresAt,
      usageLimit: 1,
      perUserLimit: 1,
    },
    userId,
  );

  const alert = await prisma.churnAlert.create({
    data: {
      customerId: customer.id,
      riskLevel: riskLevelOf(p),
      churnScore: p,
      voucherCode: code,
      promotionId: promotion.id,
      status: "TRIGGERED",
      expiresAt,
    },
  });

  // Gán task cho nhân viên CSKH (MANAGER/ADMIN active đầu tiên của tenant)
  const assignee = await prisma.user.findFirst({
    where: { role: { in: ["MANAGER", "ADMIN"] }, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (assignee) {
    await prisma.customerTask.create({
      data: {
        customerId: customer.id,
        title: `Giữ chân KH ${customer.name || customer.id} (churn ${Math.round(p * 100)}%)`,
        description: `Liên hệ + gửi voucher ${code} (hết hạn ${expiresAt.toISOString().slice(0, 10)})`,
        priority: "HIGH",
        dueAt: new Date(now.getTime() + TASK_DUE_HOURS * 3_600_000),
        assignedToId: assignee.id,
        createdById: userId || assignee.id,
      },
    });
  }

  await notificationService
    .createOne({
      type: "SYSTEM",
      severity: alert.riskLevel === "CRITICAL" ? "CRITICAL" : "WARNING",
      title: `Cảnh báo rời bỏ: ${customer.name || customer.id}`,
      message: `Churn ${(p * 100).toFixed(0)}% — đã phát hành voucher ${code}, hạn ${expiresAt.toISOString().slice(0, 10)}`,
      link: `/customers?phone=${encodeURIComponent(customer.phone || "")}`,
      meta: { churnAlertId: alert.id, customerId: customer.id, promotionId: promotion.id },
      userId: assignee?.id ?? null,
    })
    .catch((e) => logger.error("[churn] notification failed:", e.message));

  return { alert, created: true };
};

// Đóng vòng lặp: đơn COMPLETED áp đúng voucher của alert → RETAINED (Mục 4.3)
const checkRetainedForOrder = async (order) => {
  try {
    if (!order?.customerId || !order?.voucherCode) return null;
    const alert = await prisma.churnAlert.findFirst({
      where: {
        customerId: order.customerId,
        voucherCode: order.voucherCode,
        status: { in: ["PENDING", "TRIGGERED"] },
      },
    });
    if (!alert) return null;
    return prisma.churnAlert.update({
      where: { id: alert.id },
      data: { status: "RETAINED", resolvedAt: new Date() },
    });
  } catch (e) {
    logger.error("[churn] checkRetainedForOrder failed:", e.message);
    return null;
  }
};

// Cron đóng vòng lặp: RETAINED theo đơn mới / LOST theo expiresAt
const closeLoopForTenant = async (client = prisma) => {
  const now = new Date();
  const alerts = await client.churnAlert.findMany({
    where: { status: { in: ["PENDING", "TRIGGERED"] } },
    select: { id: true, customerId: true, voucherCode: true, expiresAt: true, createdAt: true },
  });
  let retained = 0;
  let lost = 0;
  for (const a of alerts) {
    let done = false;
    if (a.voucherCode) {
      const used = await client.order.findFirst({
        where: {
          customerId: a.customerId,
          voucherCode: a.voucherCode,
          status: "COMPLETED",
          createdAt: { gte: a.createdAt },
        },
        select: { id: true },
      });
      if (used) {
        await client.churnAlert.update({
          where: { id: a.id },
          data: { status: "RETAINED", resolvedAt: now },
        });
        retained += 1;
        done = true;
      }
    }
    if (!done && a.expiresAt && a.expiresAt < now) {
      await client.churnAlert.update({
        where: { id: a.id },
        data: { status: "LOST", resolvedAt: now },
      });
      lost += 1;
    }
  }
  return { checked: alerts.length, retained, lost };
};

// API: danh sách alert (filter riskLevel/status) — MANAGER/ADMIN xem toàn tenant
const listAlerts = async ({ riskLevel, status, page = 1, limit = 20 } = {}) => {
  const where = {};
  if (riskLevel) where.riskLevel = riskLevel;
  if (status) where.status = status;
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    prisma.churnAlert.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { id: true, name: true, phone: true, rfmSegment: true } } },
    }),
    prisma.churnAlert.count({ where }),
  ]);
  return {
    alerts: items,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
};

const getAlertById = async (id) => {
  const alert = await prisma.churnAlert.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, rfmSegment: true, churnProbability: true } },
      promotion: true,
    },
  });
  if (!alert) throw { status: 404, message: "Không tìm thấy cảnh báo churn" };
  return alert;
};

// Cron hàng đêm: CLV score → tạo alert → đóng vòng lặp, duyệt toàn bộ tenant
const runAllTenants = async () => {
  const clvForecast = require("./clv-forecast.service"); // lazy require tránh circular
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  const summary = { tenants: tenants.length, scored: 0, alertsCreated: 0, retained: 0, lost: 0 };
  for (const t of tenants) {
    try {
      await runWithTenant(t.id, async () => {
        const res = await clvForecast.runForTenant();
        summary.scored += res?.scored?.length ?? 0;
        for (const c of res?.scored || []) {
          const full = await prisma.customer.findUnique({
            where: { id: c.customerId },
            select: { id: true, name: true, phone: true, churnProbability: true },
          });
          if (!full) continue;
          const out = await processCustomer(full);
          if (out?.created) summary.alertsCreated += 1;
        }
        const closed = await closeLoopForTenant();
        summary.retained = (summary.retained || 0) + closed.retained;
        summary.lost = (summary.lost || 0) + closed.lost;
      });
    } catch (e) {
      logger.error(`[churn] tenant ${t.id} failed:`, e.message);
    }
  }
  return summary;
};

module.exports = {
  processCustomer,
  checkRetainedForOrder,
  closeLoopForTenant,
  listAlerts,
  getAlertById,
  runAllTenants,
  riskLevelOf,
  generateUniqueVoucherCode,
  CHURN_THRESHOLD,
  CHURN_CRITICAL_THRESHOLD,
};
