/**
 * modules/crm/dashboard.service.js — Số liệu tổng quan CRM Sales Pipeline
 *
 * Tổng quan:
 * - Phục vụ trang "CRM Dashboard" (Recharts): phễu lead, giá trị pipeline theo
 *   giai đoạn, forecast có trọng số, win rate, TB deal, thắng/thua theo tháng.
 * - Phân quyền: CASHIER chỉ thấy số liệu của lead/deal mình phụ trách; MANAGER/ADMIN
 *   thấy toàn tenant (dùng `ownerScope`).
 * - Toàn bộ số liệu gom trong hàm `getSummary(user, opts)` — gọi song song 4 nhóm
 *   query để giảm round-trip.
 *
 * Hàm:
 * - getSummary(user, {months}): dashboard đầy đủ
 * - getFunnel(user): số lead theo từng giai đoạn + tỉ lệ chuyển đổi
 * - getLeadStats(user): lead theo status, theo nguồn, theo tháng
 */
const prisma = require("../../config/prisma");
const { ownerScopeForTeam, isManager } = require("./scope");
const { getTeamUserIds } = require("./hierarchy.service");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Ngày đầu tháng trước `months` tháng (để group theo tháng) */
const startOfMonthBack = (months) => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - (months - 1));
  return d;
};

const monthKey = (dt) => {
  const d = new Date(dt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Phễu lead: mỗi stage ONGOING/đã dùng có bao nhiêu lead đang nằm ở đó, cộng dồn
 * từ stage đầu → conversion rate giữa 2 stage liền kề.
 */
const getFunnel = async (user) => {
  const [stages, grouped] = await Promise.all([
    prisma.crmPipelineStage.findMany({
      where: { entityType: "LEAD", isActive: true },
      select: { id: true, label: true, color: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.crmLead.groupBy({
      by: ["stageId"],
      where: { ...ownerScopeForTeam(user, "leadOwnerId", await getTeamUserIds(user)) },
      _count: { _all: true },
    }),
  ]);

  const countByStage = new Map(grouped.map((g) => [g.stageId, g._count._all]));
  const steps = stages.map((s) => ({
    stageId: s.id,
    label: s.label,
    color: s.color,
    count: countByStage.get(s.id) || 0,
  }));

  // conversion = số lead ở stage này / số lead ở stage trước (null nếu trước đó = 0)
  let running = null;
  for (let i = 0; i < steps.length; i += 1) {
    const prev = i === 0 ? steps[i].count : steps[i - 1].count;
    steps[i].conversionRate = prev > 0 ? round2((steps[i].count / prev) * 100) : null;
    running = (running ?? 0) + steps[i].count;
  }

  const unassigned = grouped.find((g) => g.stageId === null)?._count._all || 0;
  if (unassigned > 0) {
    steps.push({ stageId: null, label: "Chưa phân giai đoạn", color: "#64748b", count: unassigned, conversionRate: null });
  }

  return { steps, total: running ?? 0 };
};

/** Lead theo status / nguồn / tháng + giá trị kỳ vọng */
const getLeadStats = async (user, months = 6) => {
  const from = startOfMonthBack(months);
  const where = { ...ownerScopeForTeam(user, "leadOwnerId", await getTeamUserIds(user)) };

  const [byStatus, bySource, recent, totals, convertedTotals] = await Promise.all([
    prisma.crmLead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.crmLead.groupBy({
      by: ["source"],
      where: { ...where, source: { not: null } },
      _count: { _all: true },
    }),
    prisma.crmLead.findMany({
      where: { ...where, createdAt: { gte: from } },
      select: { createdAt: true, status: true, expectedValue: true },
      take: 5000,
    }),
    prisma.crmLead.aggregate({ where, _count: { _all: true }, _sum: { expectedValue: true } }),
    prisma.crmLead.aggregate({
      where: { ...where, status: "CONVERTED" },
      _count: { _all: true },
    }),
  ]);

  const byMonth = new Map();
  for (const lead of recent) {
    const k = monthKey(lead.createdAt);
    const cur = byMonth.get(k) || { month: k, created: 0, converted: 0, expectedValue: 0 };
    cur.created += 1;
    if (lead.status === "CONVERTED") cur.converted += 1;
    cur.expectedValue += Number(lead.expectedValue || 0);
    byMonth.set(k, cur);
  }

  const totalLeads = totals._count._all;
  const convertedLeads = convertedTotals._count._all;

  return {
    total: totalLeads,
    totalExpectedValue: round2(Number(totals._sum.expectedValue || 0)),
    converted: convertedLeads,
    conversionRate: totalLeads > 0 ? round2((convertedLeads / totalLeads) * 100) : 0,
    byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
    bySource: bySource
      .map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    byMonth: [...byMonth.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ ...r, expectedValue: round2(r.expectedValue) })),
  };
};

/** Gộp tất cả số liệu dashboard */
const getSummary = async (user, { months = 6 } = {}) => {
  const m = Math.max(1, Math.min(24, Number(months) || 6));
  const where = { ...ownerScopeForTeam(user, "dealOwnerId", await getTeamUserIds(user)) };
  const from = startOfMonthBack(m);

  const [funnel, leadStats, dealGroups, openDeals, closed, recentDeals] = await Promise.all([
    getFunnel(user),
    getLeadStats(user, m),
    prisma.crmDeal.groupBy({
      by: ["stageId", "kind"],
      where,
      _count: { _all: true },
      _sum: { value: true },
    }),
    prisma.crmDeal.findMany({
      where: { ...where, kind: "ONGOING" },
      select: { value: true, probability: true, stageId: true, expectedCloseDate: true },
    }),
    prisma.crmDeal.findMany({
      where: { ...where, kind: { in: ["WON", "LOST"] }, closedAt: { gte: from } },
      select: { value: true, kind: true, closedAt: true, lostReason: true, stage: { select: { label: true, color: true } } },
    }),
    prisma.crmDeal.findMany({
      where,
      select: { id: true, dealName: true, value: true, kind: true, expectedCloseDate: true, stage: { select: { label: true, color: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  const stageIds = [...new Set(dealGroups.map((g) => g.stageId).filter(Boolean))];
  const stages = stageIds.length
    ? await prisma.crmPipelineStage.findMany({
        where: { id: { in: stageIds } },
        select: { id: true, label: true, color: true, sortOrder: true },
      })
    : [];
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  // Gom theo stage để vẽ bar chart giá trị pipeline
  const byStageMap = new Map();
  for (const g of dealGroups) {
    const meta = g.stageId ? stageMap.get(g.stageId) : null;
    const key = g.stageId || "none";
    const cur = byStageMap.get(key) || {
      stageId: g.stageId || null,
      label: meta?.label || "Chưa phân giai đoạn",
      color: meta?.color || "#64748b",
      count: 0,
      value: 0,
      wonCount: 0,
      lostCount: 0,
    };
    cur.count += g._count._all;
    cur.value += Number(g._sum.value || 0);
    if (g.kind === "WON") cur.wonCount += g._count._all;
    if (g.kind === "LOST") cur.lostCount += g._count._all;
    byStageMap.set(key, cur);
  }

  const totalValue = openDeals.reduce((s, d) => s + Number(d.value || 0), 0);
  const weightedValue = openDeals.reduce((s, d) => s + (Number(d.value || 0) * Number(d.probability || 0)) / 100, 0);
  const won = closed.filter((d) => d.kind === "WON");
  const lost = closed.filter((d) => d.kind === "LOST");
  const decided = won.length + lost.length;
  const wonValue = won.reduce((s, d) => s + Number(d.value || 0), 0);

  const byMonthMap = new Map();
  for (const d of closed) {
    const k = monthKey(d.closedAt);
    const cur = byMonthMap.get(k) || { month: k, wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0 };
    if (d.kind === "WON") {
      cur.wonCount += 1;
      cur.wonValue += Number(d.value || 0);
    } else {
      cur.lostCount += 1;
      cur.lostValue += Number(d.value || 0);
    }
    byMonthMap.set(k, cur);
  }

  const dueSoonCut = Date.now() + 30 * 24 * 60 * 60 * 1000;

  return {
    scope: isManager(user) ? "TENANT" : "OWN",
    months: m,
    kpi: {
      totalLeads: leadStats.total,
      newLeads: leadStats.byStatus.find((s) => s.status === "NEW")?.count || 0,
      qualifiedLeads: leadStats.byStatus.find((s) => s.status === "QUALIFIED")?.count || 0,
      convertedLeads: leadStats.byStatus.find((s) => s.status === "CONVERTED")?.count || 0,
      openDeals: openDeals.length,
      pipelineValue: round2(totalValue),
      weightedForecast: round2(weightedValue),
      dueSoonValue: round2(
        openDeals
          .filter((d) => d.expectedCloseDate && new Date(d.expectedCloseDate).getTime() <= dueSoonCut)
          .reduce((s, d) => s + Number(d.value || 0), 0),
      ),
      wonCount: won.length,
      wonValue: round2(wonValue),
      lostCount: lost.length,
      winRate: decided > 0 ? round2((won.length / decided) * 100) : 0,
      avgDealSize: won.length > 0 ? round2(wonValue / won.length) : 0,
    },
    funnel,
    leadByStatus: leadStats.byStatus,
    leadBySource: leadStats.bySource,
    leadByMonth: leadStats.byMonth,
    dealByStage: [...byStageMap.values()]
      .sort((a, b) => {
        const oa = a.stageId ? stageMap.get(a.stageId)?.sortOrder ?? 99 : 99;
        const ob = b.stageId ? stageMap.get(b.stageId)?.sortOrder ?? 99 : 99;
        return oa - ob;
      })
      .map((s) => ({ ...s, value: round2(s.value) })),
    dealByMonth: [...byMonthMap.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((r) => ({ ...r, wonValue: round2(r.wonValue), lostValue: round2(r.lostValue) })),
    lostReasons: countBy(lost.map((d) => d.lostReason).filter(Boolean)),
    recentDeals,
  };
};

const countBy = (arr) => {
  const map = new Map();
  for (const v of arr) map.set(v, (map.get(v) || 0) + 1);
  return [...map.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
};

module.exports = { getSummary, getFunnel, getLeadStats };
