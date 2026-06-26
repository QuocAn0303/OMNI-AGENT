/**
 * modules/analytics/analytics.service.js — Phân tích dữ liệu bán hàng
 * 
 * Tổng quan:
 * - Thống kê doanh thu, đơn hàng, AOV, khách hàng mới theo khoảng thời gian
 * - So sánh với kỳ trước (trend)
 * - Time series theo ngày/tuần/tháng
 * - Top sản phẩm và top khách hàng
 * 
 * Hàm:
 * - buildPeriods(from, to, groupBy): Xây dựng mảng period keys (day/week/month) giữa from..to
 * - dateToPeriod(date, groupBy): Map một ngày vào period key tương ứng
 * - getAnalytics(from, to, groupBy): Tổng hợp analytics: summary KPIs, time series, topProducts, topCustomers
 * - salesInsights(): Legacy — gọi getAnalytics với 30 ngày gần nhất
 */
const prisma = require("../../config/prisma");

// ── helpers ──────────────────────────────────────────────────────────────────

const startOfDay = (d) => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};

const isoDate = (d) => d.toISOString().slice(0, 10);

// Build an ordered array of period keys between from..to
const buildPeriods = (from, to, groupBy) => {
  const keys = [];
  const cur = startOfDay(from);
  const end = startOfDay(to);

  if (groupBy === "month") {
    // iterate month by month
    cur.setDate(1);
    while (cur <= end) {
      keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      cur.setMonth(cur.getMonth() + 1);
    }
  } else if (groupBy === "week") {
    // week starting on Monday (ISO)
    const monday = new Date(cur);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - ((day + 6) % 7));
    while (monday <= end) {
      keys.push(isoDate(monday));
      monday.setDate(monday.getDate() + 7);
    }
  } else {
    // day
    while (cur <= end) {
      keys.push(isoDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  return keys;
};

// Map a createdAt date to the correct period key
const dateToPeriod = (date, groupBy) => {
  if (groupBy === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  } else if (groupBy === "week") {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - ((day + 6) % 7));
    return isoDate(d);
  }
  return isoDate(date);
};

// ── main exported function ────────────────────────────────────────────────────

/**
 * Returns analytics data shaped for Analytics.jsx
 * @param {Date}   from
 * @param {Date}   to
 * @param {string} groupBy  'day' | 'week' | 'month'
 */
const getAnalytics = async (from, to, groupBy = "day") => {
  const fromDate = startOfDay(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  // -- build comparison period (same length, immediately before) --
  const rangeMs = toDate - fromDate;
  const prevTo = new Date(fromDate.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - rangeMs);

  // ── fetch orders in window ────────────────────────────────────────────────
  const [orders, prevOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        createdAt: { gte: fromDate, lte: toDate },
        status: { in: ["COMPLETED", "SHIPPING", "CONFIRMED"] },
      },
      select: {
        id: true,
        total: true,
        createdAt: true,
        customerId: true,
        items: {
          select: { productId: true, quantity: true, subtotal: true, product: { select: { name: true } } },
        },
        customer: { select: { id: true, createdAt: true } },
      },
    }),
    prisma.order.findMany({
      where: {
        createdAt: { gte: prevFrom, lte: prevTo },
        status: { in: ["COMPLETED", "SHIPPING", "CONFIRMED"] },
      },
      select: { total: true },
    }),
  ]);

  // ── summary KPIs ─────────────────────────────────────────────────────────
  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
  const orderCount = orders.length;
  const aov = orderCount > 0 ? revenue / orderCount : 0;

  // new customers = customers whose first order falls in this window
  const customerIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))];
  const newCustomers =
    customerIds.length > 0
      ? await prisma.customer.count({
          where: {
            id: { in: customerIds },
            createdAt: { gte: fromDate, lte: toDate },
          },
        })
      : 0;

  // trend vs previous period
  const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total), 0);
  const prevOrderCount = prevOrders.length;

  const pct = (cur, prev) => {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  };
  const trendObj = (cur, prev) => {
    const p = pct(cur, prev);
    return { direction: p >= 0 ? "up" : "down", label: `${p >= 0 ? "+" : ""}${p}%` };
  };

  const summary = {
    revenue,
    orders: orderCount,
    aov,
    newCustomers,
    revenueTrend: trendObj(revenue, prevRevenue),
    ordersTrend: trendObj(orderCount, prevOrderCount),
  };

  // ── time series ───────────────────────────────────────────────────────────
  const periods = buildPeriods(fromDate, toDate, groupBy);
  const periodMap = new Map(periods.map((p) => [p, { period: p, revenue: 0, orders: 0 }]));

  for (const o of orders) {
    const key = dateToPeriod(o.createdAt, groupBy);
    if (periodMap.has(key)) {
      const entry = periodMap.get(key);
      entry.revenue += Number(o.total);
      entry.orders += 1;
    }
  }
  const timeSeries = Array.from(periodMap.values());

  // ── top products ──────────────────────────────────────────────────────────
  const productMap = new Map();
  for (const o of orders) {
    for (const item of o.items) {
      const id = item.productId;
      const prev = productMap.get(id) || { id, name: item.product?.name || id, revenue: 0, qty: 0 };
      prev.revenue += Number(item.subtotal);
      prev.qty += item.quantity;
      productMap.set(id, prev);
    }
  }
  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ── top customers ─────────────────────────────────────────────────────────
  const custMap = new Map();
  for (const o of orders) {
    if (!o.customerId) continue;
    const prev = custMap.get(o.customerId) || {
      id: o.customerId,
      name: o.customer?.name || "Khách lẻ",
      totalSpent: 0,
      orderCount: 0,
    };
    prev.totalSpent += Number(o.total);
    prev.orderCount += 1;
    custMap.set(o.customerId, prev);
  }
  const topCustomers = Array.from(custMap.values())
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  return { summary, timeSeries, topProducts, topCustomers };
};

// ── legacy sales-insights (kept for backward compat) ─────────────────────────
const salesInsights = async () => {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return getAnalytics(from, now, "day");
};

module.exports = { getAnalytics, salesInsights };
