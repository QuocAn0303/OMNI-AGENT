/**
 * modules/analytics/analytics.service.js — Phân tích dữ liệu bán hàng
 * 
 * Tổng quan:
 * - Thống kê doanh thu, đơn hàng, AOV, khách hàng mới theo khoảng thời gian
 * - So sánh với kỳ trước (trend)
 * - Time series theo ngày/tuần/tháng
 * - Top sản phẩm và top khách hàng
 * 
 * - CRM Phase 4 (mục 1): thêm `getCustomerInsights()` — RFM / CLV / churn / tier.
 *   Trước đó các cột này đã có sẵn trên `Customer` (do `rfm.service.js` +
 *   `clv-forecast.service.js` ghi) nhưng **không API nào đọc** → dữ liệu có,
 *   không ai vẽ. Hàm này chỉ đọc lại, KHÔNG tự tính RFM/CLV (tránh 2 nguồn sự
 *   thật với `rfm.service.js`).
 *
 * Hàm:
 * - buildPeriods(from, to, groupBy): Xây dựng mảng period keys (day/week/month) giữa from..to
 * - dateToPeriod(date, groupBy): Map một ngày vào period key tương ứng
 * - getAnalytics(from, to, groupBy): Tổng hợp analytics: summary KPIs, time series, topProducts, topCustomers
 * - getCustomerInsights(): RFM/CLV/churn/tier + danh sách khách rủi ro
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

// ── CRM Phase 4: RFM / CLV / churn / tier ─────────────────────────────────────

// Ngưỡng phân rã sẵn có ở `rfm.service.js` — giữ nguyên nhãn để FE map 1:1,
// không tự đặt tên mới (tránh 2 hệ thống tên cho cùng 1 phân khúc).
const RFM_ORDER = ["Champions", "Loyal", "Potential", "At-Risk", "Hibernating"];

// Ngưỡng "rủi ro" của phân tích = ngưỡng SÀNG LỌC (xem danh sách theo dõi),
// thấp hơn ngưỡng HÀNH ĐỘNG của automation (0.70) một cách có chủ đích: người
// dùng cần thấy cả nhóm "sắp rời bỏ" trước khi automation kịp xử lý.
//
// HAI NGƯỠNG NÀY KHÁC NHAU VÀ PHẢI GIỮ RIÊNG — nhập nhằng là bug. Xem
// `retentionKpi()` trả cả hai ra payload để UI không tự nhầm.
const CHURN_RISK_THRESHOLD = 0.5;
const CHURN_ACTION_THRESHOLD = Number(process.env.CHURN_THRESHOLD || 0.7);

/**
 * Tổng hợp chỉ số CRM khách hàng từ dữ liệu ĐÃ TÍNH SẴN trên `Customer`.
 *
 * Cố ý KHÔNG tính lại RFM/CLV ở đây:
 * - `rfm.service.js` (cron sau mỗi đơn) và `clv-forecast.service.js` là nguồn
 *   duy nhất. Nếu `getCustomerInsights` tự tính bằng công thức khác thì dashboard
 *   hiện số khác số CRM báo cáo → mất niềm tin, khó truy nguyên.
 * - Khách chưa được chấm điểm (`rfmSegment = NULL`) không đếm vào phân khúc
 *   nhưng VẪN vào mẫu số tổng số khách — hiển thị `unscored` để người dùng thấy
 *   "còn N khách chưa chấm", thay vì âm thầm loại khỏi tổng.
 *
 * @param {Object} opts
 * @param {number} opts.riskLimit  số khách rủi ro trả về (mặc định 20)
 * @param {number} opts.clvLimit   số khách CLV cao nhất (mặc định 20)
 */
const getCustomerInsights = async ({ riskLimit = 20, clvLimit = 20 } = {}) => {
  const [totalActive, scoredSegments, tierRows, clvAgg, churnAgg, atRisk, topClv] = await Promise.all([
    prisma.customer.count({ where: { isActive: true } }),
    prisma.customer.groupBy({
      by: ["rfmSegment"],
      where: { rfmSegment: { not: null } },
      _count: { _all: true },
      _avg: { rfmMonetary: true, rfmFrequency: true },
    }),
    prisma.customer.groupBy({
      by: ["tier"],
      where: { isActive: true },
      _count: { _all: true },
      _sum: { totalSpent: true },
    }),
    prisma.customer.aggregate({
      where: { clvPredicted: { not: null } },
      _sum: { clvPredicted: true },
      _avg: { clvPredicted: true },
      _count: { clvPredicted: true },
    }),
    prisma.customer.aggregate({
      where: { churnProbability: { not: null } },
      _avg: { churnProbability: true },
      _max: { churnProbability: true },
      _count: { churnProbability: true },
    }),
    prisma.customer.findMany({
      where: { isActive: true, churnProbability: { gte: CHURN_RISK_THRESHOLD } },
      select: {
        id: true, name: true, phone: true, email: true, tier: true,
        rfmSegment: true, churnProbability: true, clvPredicted: true, totalSpent: true,
      },
      orderBy: { churnProbability: "desc" },
      take: riskLimit,
    }),
    prisma.customer.findMany({
      where: { isActive: true, clvPredicted: { not: null } },
      select: { id: true, name: true, tier: true, clvPredicted: true, totalSpent: true, rfmSegment: true },
      orderBy: { clvPredicted: "desc" },
      take: clvLimit,
    }),
  ]);

  // Chuẩn hoá phân khúc: luôn trả đủ 5 nhóm (kể cả 0 khách) để biểu đồ không
  // nhảy layout giữa 2 lần tải; nhóm lạ (do cũ) gom vào `other`.
  const known = new Map(
    scoredSegments
      .filter((r) => RFM_ORDER.includes(r.rfmSegment))
      .map((r) => [r.rfmSegment, r]),
  );
  const otherCount = scoredSegments
    .filter((r) => !RFM_ORDER.includes(r.rfmSegment))
    .reduce((s, r) => s + r._count._all, 0);

  const scoredTotal = scoredSegments.reduce((s, r) => s + r._count._all, 0);
  const rfmSegments = RFM_ORDER.map((name) => {
    const row = known.get(name);
    return {
      segment: name,
      count: row?._count._all ?? 0,
      avgMonetary: row?._avg?.rfmMonetary != null ? Number(row._avg.rfmMonetary) : null,
      avgFrequency: row?._avg?.rfmFrequency != null ? Number(row._avg.rfmFrequency) : null,
    };
  });
  if (otherCount > 0) {
    rfmSegments.push({ segment: "Other", count: otherCount, avgMonetary: null, avgFrequency: null });
  }

  const tiers = tierRows.map((r) => ({
    tier: r.tier,
    count: r._count._all,
    totalSpent: Number(r._sum?.totalSpent ?? 0),
  }));

  const churnScored = churnAgg._count?.churnProbability ?? 0;
  const atRiskTotal = await prisma.customer.count({
    where: { isActive: true, churnProbability: { gte: CHURN_RISK_THRESHOLD } },
  });

  return {
    totals: {
      activeCustomers: totalActive,
      scoredCustomers: scoredTotal,
      unscoredCustomers: Math.max(0, totalActive - scoredTotal),
      clvScored: clvAgg._count?.clvPredicted ?? 0,
      churnScored,
    },
    rfmSegments,
    tiers,
    clv: {
      total: clvAgg._sum?.clvPredicted != null ? Number(clvAgg._sum.clvPredicted) : 0,
      average: clvAgg._avg?.clvPredicted != null ? Number(clvAgg._avg.clvPredicted) : 0,
    },
    churn: {
      threshold: CHURN_RISK_THRESHOLD,
      average: churnAgg._avg?.churnProbability != null ? Number(churnAgg._avg.churnProbability) : null,
      max: churnAgg._max?.churnProbability != null ? Number(churnAgg._max.churnProbability) : null,
      atRiskTotal,
    },
    atRisk: atRisk.map((c) => ({
      ...c,
      // Cột Decimal của Prisma serialize ra JSON thành STRING ("5192000").
      // Để nguyên sẽ khiến FE so sánh/sắp xếp sai và MoneyDisplay phải tự parse.
      // Chuyển hết về number ở biên service — 1 nguồn, không rải Number() ở FE.
      churnProbability: Number(c.churnProbability),
      clvPredicted: c.clvPredicted != null ? Number(c.clvPredicted) : null,
      totalSpent: Number(c.totalSpent),
    })),
    topClv: topClv.map((c) => ({
      ...c,
      // Giữ null thay vì Number(null) = 0 — "chưa đủ dữ liệu" và "CLV bằng 0" là 2
      // thông tin khác nhau, FE cần phân biệt để không vẽ 0₫ cho khách chưa có dữ liệu.
      clvPredicted: c.clvPredicted != null ? Number(c.clvPredicted) : null,
      totalSpent: Number(c.totalSpent),
    })),
  };
};

// ── legacy sales-insights (kept for backward compat) ─────────────────────────
const salesInsights = async () => {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return getAnalytics(from, now, "day");
};

// ── KPI giữ chân (AN.4) ──────────────────────────────────────────────────────
/**
 * Bộ KPI mà đề bài R4 yêu cầu, gom về một chỗ để trả lời câu hỏi "giữ được
 * khách không" thay vì chỉ nhìn doanh thu:
 *   1. Tỷ lệ giữ chân theo cohort tháng mua đầu tiên.
 *   2. Khách rủi ro theo ngưỡng cảnh báo.
 *   3. Hiệu quả win-back: cảnh báo → voucher → đã dùng.
 *
 * Cohort dùng `customers.createdAt` (tháng tạo khách) vì đó là mốc duy nhất có
 * ở mọi khách; cohort theo tháng mua đầu tiên cần dựng thêm bảng trung gian.
 * Giới hạn này ghi rõ trong tài liệu 3.5 thay vì giấu.
 *
 * @param {{months?:number}} opts số tháng cohort (mặc định 6)
 */
const retentionKpi = async ({ months = 6 } = {}) => {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  // ---- 1. Cohort: nhóm theo tháng tạo khách, đo còn hoạt động sau N ngày
  const cohortRows = [];
  for (let i = 0; i < months; i += 1) {
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const [total, active] = await Promise.all([
      prisma.customer.count({
        where: { createdAt: { gte: start, lt: end }, isActive: true },
      }),
      prisma.customer.count({
        where: {
          createdAt: { gte: start, lt: end },
          isActive: true,
          rfmRecencyDays: { lte: 90 },
        },
      }),
    ]);
    cohortRows.push({
      month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      customers: total,
      // "Còn hoạt động" = có đơn trong 90 ngày gần nhất (rfmRecencyDays).
      active,
      retentionRate: total > 0 ? Number(((active / total) * 100).toFixed(1)) : null,
    });
  }

  // ---- 2. Khách rủi ro
  const [totalCustomers, scored, atRisk, avgChurn] = await Promise.all([
    prisma.customer.count({ where: { isActive: true } }),
    prisma.customer.count({ where: { churnProbability: { not: null } } }),
    prisma.customer.count({ where: { churnProbability: { gte: CHURN_RISK_THRESHOLD } } }),
    prisma.customer.aggregate({
      where: { churnProbability: { not: null } },
      _avg: { churnProbability: true },
    }),
  ]);

  // ---- 3. Hiệu quả win-back
  const alertsByStatus = await prisma.churnAlert.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const statusMap = Object.fromEntries(alertsByStatus.map((r) => [r.status, r._count._all]));
  const totalAlerts = alertsByStatus.reduce((s, r) => s + r._count._all, 0);

  // Voucher được dùng: `PromotionUsage` nối promotion ↔ customer.
  const voucherIds = (
    await prisma.churnAlert.findMany({
      where: { promotionId: { not: null } },
      select: { promotionId: true },
      distinct: ["promotionId"],
    })
  ).map((a) => a.promotionId);
  const usageCount = voucherIds.length
    ? await prisma.promotionUsage.count({ where: { promotionId: { in: voucherIds } } })
    : 0;

  const resolved = (statusMap.RETAINED ?? 0) + (statusMap.LOST ?? 0);
  const resolvedAtRisk = atRisk > 0 ? Number(((resolved / atRisk) * 100).toFixed(1)) : null;

  return {
    generatedAt: now.toISOString(),
    thresholds: {
      // Ngưỡng SÀNG LỌC — dùng cho `customers.atRisk` và danh sách theo dõi.
      churnRisk: CHURN_RISK_THRESHOLD,
      // Ngưỡng HÀNH ĐỘNG — đúng ngưỡng `churn-automation` dùng để tạo cảnh báo
      // + voucher. Nêu ra để không ai đọc KPI rủi ro rồi hỏi "sao chưa gửi
      // voucher cho khách này".
      churnAction: CHURN_ACTION_THRESHOLD,
      recencyDays: 90,
    },
    customers: {
      total: totalCustomers,
      scored,
      unscored: Math.max(0, totalCustomers - scored),
      atRisk,
      atRiskRate: totalCustomers > 0 ? Number(((atRisk / totalCustomers) * 100).toFixed(1)) : null,
      avgChurnProbability:
        avgChurn._avg?.churnProbability != null ? Number(avgChurn._avg.churnProbability) : null,
    },
    cohorts: cohortRows,
    winback: {
      alertsTotal: totalAlerts,
      byStatus: statusMap,
      resolved,
      // Tỷ lệ khách rủi ro đã có kết quả (giữ lại hoặc mất) — đo được vì
      // `churn_alerts.status` được automation cập nhật ở các lần chạy sau.
      resolvedRate: resolvedAtRisk,
      voucherIssued: voucherIds.length,
      voucherUsed: usageCount,
      // Hiệu quả voucher = số lượt dùng / số voucher đã phát. Chưa có lượt dùng
      // thì null, KHÔNG phải 0 — "chưa ai dùng" và "chưa phát voucher" là 2 việc.
      voucherRedemptionRate:
        voucherIds.length > 0 ? Number(((usageCount / voucherIds.length) * 100).toFixed(1)) : null,
    },
    caveats: [
      "Cohort tính theo tháng TẠO khách (customers.createdAt), không phải tháng mua đầu tiên.",
      "Tỷ lệ giữ chân dùng quy ước 'còn mua trong 90 ngày' (rfmRecencyDays <= 90).",
      "customers.atRisk dùng ngưỡng SÀNG LỌC (churnRisk); chỉ khách vượt ngưỡng HÀNH ĐỘNG (churnAction) mới được automation gửi voucher.",
      "resolvedRate phụ thuộc automation đã chạy đủ một vòng để cập nhật trạng thái RETAINED/LOST.",
    ],
  };
};

module.exports = { getAnalytics, getCustomerInsights, salesInsights, retentionKpi };
