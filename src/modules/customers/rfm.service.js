/**
 * modules/customers/rfm.service.js — Phân khúc RFM động (Mục 3.2 đặc tả CRM/SRM)
 *
 * Tổng quan:
 * - Tính Recency / Frequency / Monetary cho Customer và PERSIST vào các field mới
 *   (rfmRecencyDays, rfmFrequency, rfmMonetary, rfmSegment, rfmScoredAt) — khác với
 *   getCustomer360() vốn chỉ tính ad-hoc để hiển thị, không lưu điểm.
 * - Hook được gọi sau mỗi lần Order chuyển COMPLETED (xem orders/order.service.js),
 *   ngoài ra có cron hàng đêm chạy lại toàn bộ tenant (xem jobs/cron.js).
 * - Xếp segment theo ngũ phân vị (quintile) TÍNH RIÊNG theo từng tenant (rank-based),
 *   không dùng ngưỡng cố định toàn hệ thống vì quy mô mỗi shop khác nhau.
 *
 * Hàm:
 * - recalcMetricsForCustomer(customerId, client?): R/F/M từ đơn COMPLETED 12 tháng gần nhất
 * - quintileOf(value, sortedAsc): điểm quintile 1..5 theo rank (robust với tenant < 5 khách)
 * - deriveSegment(r, f, m): Champions | Loyal | Potential | At-Risk | Hibernating
 * - scoreTenantSegments(): chấm segment cho toàn bộ customer trong tenant context
 * - onOrderCompletedForCustomer(customerId): hook fire-and-forget sau đơn COMPLETED
 * - runForTenant() / runAllTenants(): chạy lại toàn bộ (cron hàng đêm)
 */
const prisma = require("../../config/prisma");
const { getTenantId, runWithTenant } = require("../../config/tenantContext");
const logger = require("../../utils/logger");

const DAY_MS = 86_400_000;
const OBSERVATION_DAYS = 365;

// Tính lại R/F/M cho 1 customer từ các đơn COMPLETED trong 12 tháng gần nhất
const recalcMetricsForCustomer = async (customerId, client = prisma) => {
  if (!customerId) return null;
  const since = new Date(Date.now() - OBSERVATION_DAYS * DAY_MS);
  const agg = await client.order.aggregate({
    where: { customerId, status: "COMPLETED", createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { total: true },
    _max: { createdAt: true },
  });
  const frequency = agg?._count?._all ?? 0;
  const monetary = Number(agg?._sum?.total ?? 0);
  const lastAt = agg?._max?.createdAt ? new Date(agg._max.createdAt) : null;
  const recencyDays = lastAt
    ? Math.max(0, Math.floor((Date.now() - lastAt.getTime()) / DAY_MS))
    : null;

  await client.customer.update({
    where: { id: customerId },
    data: {
      rfmFrequency: frequency,
      rfmMonetary: monetary,
      rfmRecencyDays: recencyDays,
      rfmScoredAt: new Date(),
    },
  });
  return { frequency, monetary, recencyDays };
};

// Quintile theo rank: value càng lớn trong tập sortedAsc (tăng dần) → điểm càng cao (1..5)
const quintileOf = (value, sortedAsc) => {
  const n = sortedAsc.length;
  if (n === 0) return 3; // không đủ dữ liệu so sánh → điểm trung tính
  let rank = 1;
  for (const v of sortedAsc) if (v < value) rank += 1;
  return Math.min(5, Math.max(1, Math.ceil((rank / n) * 5)));
};

// Xếp segment từ 3 điểm R/F/M (R đã đảo: recency càng thấp = điểm càng cao)
const deriveSegment = (r, f, m) => {
  if (r >= 4 && f >= 4) return "Champions";
  if (f >= 4) return "Loyal";
  if (m >= 4 || (r >= 3 && f >= 3)) return "Potential";
  if (r <= 2) return "At-Risk";
  return "Hibernating";
};

// Chấm segment cho toàn bộ customer của tenant hiện tại (dựa trên tenant context)
const scoreTenantSegments = async (client = prisma) => {
  const customers = await client.customer.findMany({
    where: { isActive: true, rfmFrequency: { not: null } },
    select: { id: true, rfmRecencyDays: true, rfmFrequency: true, rfmMonetary: true },
  });
  if (!customers.length) return { scored: 0 };

  const recAsc = customers.map((c) => Number(c.rfmRecencyDays ?? 0)).sort((a, b) => a - b);
  const freqAsc = customers.map((c) => Number(c.rfmFrequency ?? 0)).sort((a, b) => a - b);
  const monAsc = customers.map((c) => Number(c.rfmMonetary ?? 0)).sort((a, b) => a - b);

  for (const c of customers) {
    const recency = Number(c.rfmRecencyDays ?? 0);
    const r = 6 - quintileOf(recency, recAsc); // recency thấp → điểm cao
    const f = quintileOf(Number(c.rfmFrequency ?? 0), freqAsc);
    const m = quintileOf(Number(c.rfmMonetary ?? 0), monAsc);
    await client.customer.update({
      where: { id: c.id },
      data: { rfmSegment: deriveSegment(r, f, m) },
    });
  }
  return { scored: customers.length };
};

// Hook gọi sau khi Order COMPLETED — KHÔNG ném lỗi ra luồng order
const onOrderCompletedForCustomer = async (customerId) => {
  try {
    if (!customerId) return null;
    const metrics = await recalcMetricsForCustomer(customerId);
    if (getTenantId()) await scoreTenantSegments();
    return metrics;
  } catch (e) {
    logger.error(`[rfm] recalc customer ${customerId} failed:`, e.message);
    return null;
  }
};

// Chạy lại toàn bộ customer của tenant hiện tại (cron)
const runForTenant = async (client = prisma) => {
  const since = new Date(Date.now() - OBSERVATION_DAYS * DAY_MS);
  const groups = await client.order.groupBy({
    by: ["customerId"],
    where: { status: "COMPLETED", createdAt: { gte: since }, customerId: { not: null } },
    _count: { _all: true },
    _sum: { total: true },
    _max: { createdAt: true },
  });
  for (const g of groups) {
    const lastAt = g._max?.createdAt ? new Date(g._max.createdAt) : null;
    await client.customer.update({
      where: { id: g.customerId },
      data: {
        rfmFrequency: g._count?._all ?? 0,
        rfmMonetary: Number(g._sum?.total ?? 0),
        rfmRecencyDays: lastAt
          ? Math.max(0, Math.floor((Date.now() - lastAt.getTime()) / DAY_MS))
          : null,
        rfmScoredAt: new Date(),
      },
    });
  }
  const seg = await scoreTenantSegments(client);
  return { customers: groups.length, ...seg };
};

// Duyệt toàn bộ tenant (cron — tenant context đúng pattern prisma extension)
const runAllTenants = async () => {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let scored = 0;
  for (const t of tenants) {
    try {
      const res = await runWithTenant(t.id, () => runForTenant());
      scored += res?.scored ?? 0;
    } catch (e) {
      logger.error(`[rfm] tenant ${t.id} failed:`, e.message);
    }
  }
  return { tenants: tenants.length, scored };
};

module.exports = {
  recalcMetricsForCustomer,
  quintileOf,
  deriveSegment,
  scoreTenantSegments,
  onOrderCompletedForCustomer,
  runForTenant,
  runAllTenants,
};
