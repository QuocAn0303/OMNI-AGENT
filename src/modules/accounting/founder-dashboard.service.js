/**
 * modules/accounting/founder-dashboard.service.js — Dashboard tài chính founder
 * 
 * Tổng quan:
 * - Cung cấp cái nhìn tổng quan tài chính cho nhà sáng lập / quản lý cấp cao.
 * - Tổng hợp từ nhiều nguồn: số dư tiền, P&L, burn rate, công nợ, cảnh báo.
 * - Tính toán các chỉ số quan trọng: runway (số tháng sống sót), tăng trưởng doanh thu, top chi phí.
 * 
 * Hàm:
 * - overview(): Trả về object tổng quan gồm:
 *   + cash: Số dư tiền mặt theo từng tài khoản (111, 112...).
 *   + runway: Số tháng còn lại (cash / net burn rate trung bình 3 tháng).
 *   + thisMonth: P&L tháng hiện tại (revenue, cogs, grossProfit, expenses, operatingProfit, grossMargin).
 *   + growth: Tăng trưởng doanh thu và lợi nhuận so với tháng trước (%).
 *   + receivables/payables: Công nợ phải thu (131) / phải trả (331) và quá hạn.
 *   + topExpenses: Top 5 chi phí theo tài khoản trong tháng.
 *   + alerts: Mảng cảnh báo (critical/warning/info) về tiền mặt, runway, lỗ, chi phí tăng, công nợ quá hạn.
 */
// src/modules/accounting/founder-dashboard.service.js
// Dashboard tài chính cho founder: cash, runway, P&L tóm tắt, cảnh báo.
const prisma = require("../../config/prisma");
const reportService = require("./financial-report.service");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };

const overview = async () => {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const prevMonthEnd = new Date(monthStart.getTime() - 1);
  const prevMonthStart = startOfMonth(prevMonthEnd);

  // Số dư tiền hiện tại
  const cashAccounts = await prisma.account.findMany({ where: { isCash: true } });
  const balanceNow = await reportService.aggregateByAccount({ to: now });
  let totalCash = 0;
  for (const a of cashAccounts) {
    totalCash += balanceNow.get(a.id)?.balance || 0;
  }
  totalCash = round2(totalCash);

  // P&L tháng này & tháng trước
  const [thisMonth, prevMonth] = await Promise.all([
    reportService.profitAndLoss({ from: monthStart, to: monthEnd }),
    reportService.profitAndLoss({ from: prevMonthStart, to: prevMonthEnd }),
  ]);

  // Tính burn rate trung bình 3 tháng (chi phí hoạt động hàng tháng)
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const last3 = await reportService.profitAndLoss({ from: threeMonthsAgo, to: now });
  const monthlyBurn = round2((last3.expenses + last3.cogs) / 3);
  const monthlyRevenue = round2((last3.revenue - last3.deductions) / 3);
  const monthlyNetBurn = round2(Math.max(0, monthlyBurn - monthlyRevenue));
  const runwayMonths = monthlyNetBurn > 0 ? round2(totalCash / monthlyNetBurn) : null;

  // Công nợ phải thu / phải trả
  const [ar, ap] = await Promise.all([
    reportService.agingReport({ accountCode: "131" }),
    reportService.agingReport({ accountCode: "331" }),
  ]);

  // Top 5 chi phí tháng này theo category
  const expenseLines = await prisma.journalLine.findMany({
    where: {
      account: { type: "EXPENSE" },
      entry: { status: "POSTED", date: { gte: monthStart, lte: monthEnd } },
    },
    include: { account: { select: { code: true, nameVi: true } } },
  });
  const byAccount = new Map();
  for (const l of expenseLines) {
    const k = l.account.code;
    if (!byAccount.has(k)) byAccount.set(k, { code: k, name: l.account.nameVi, amount: 0 });
    byAccount.get(k).amount += toNum(l.debit) - toNum(l.credit);
  }
  const topExpenses = [...byAccount.values()]
    .map((e) => ({ ...e, amount: round2(e.amount) }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Cảnh báo
  const alerts = [];
  if (totalCash <= 0) {
    alerts.push({ severity: "critical", message: "⚠️ Hết tiền mặt!" });
  } else if (runwayMonths !== null && runwayMonths < 3) {
    alerts.push({ severity: "critical", message: `⚠️ Runway chỉ còn ${runwayMonths} tháng - cần huy động vốn hoặc cắt giảm chi phí gấp` });
  } else if (runwayMonths !== null && runwayMonths < 6) {
    alerts.push({ severity: "warning", message: `Runway còn ${runwayMonths} tháng - hãy theo dõi sát` });
  }
  if (thisMonth.operatingProfit < 0) {
    alerts.push({ severity: "warning", message: `Tháng này đang lỗ ${Math.abs(thisMonth.operatingProfit).toLocaleString("vi-VN")}đ` });
  }
  if (prevMonth.expenses > 0 && thisMonth.expenses > prevMonth.expenses * 1.3) {
    const inc = round2(((thisMonth.expenses - prevMonth.expenses) / prevMonth.expenses) * 100);
    alerts.push({ severity: "info", message: `Chi phí tháng này tăng ${inc}% so với tháng trước` });
  }
  if (ar.summary.over90 > 0) {
    alerts.push({ severity: "warning", message: `Có ${ar.summary.over90.toLocaleString("vi-VN")}đ công nợ quá hạn 90+ ngày` });
  }
  if (ap.summary.over90 > 0) {
    alerts.push({ severity: "warning", message: `Có ${ap.summary.over90.toLocaleString("vi-VN")}đ phải trả NCC quá 90 ngày` });
  }

  // Tỷ lệ tăng trưởng
  const revenueGrowth = prevMonth.revenue > 0
    ? round2(((thisMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 100)
    : null;

  return {
    cash: {
      total: totalCash,
      breakdown: cashAccounts.map((a) => ({
        code: a.code,
        name: a.nameVi,
        balance: round2(balanceNow.get(a.id)?.balance || 0),
      })),
    },
    runway: {
      months: runwayMonths,
      monthlyBurn,
      monthlyRevenue,
      monthlyNetBurn,
    },
    thisMonth: {
      revenue: thisMonth.revenue,
      netRevenue: thisMonth.netRevenue,
      cogs: thisMonth.cogs,
      grossProfit: thisMonth.grossProfit,
      expenses: thisMonth.expenses,
      operatingProfit: thisMonth.operatingProfit,
      grossMargin: thisMonth.netRevenue > 0
        ? round2((thisMonth.grossProfit / thisMonth.netRevenue) * 100)
        : 0,
    },
    growth: {
      revenue: revenueGrowth,
      profit: prevMonth.operatingProfit !== 0
        ? round2(((thisMonth.operatingProfit - prevMonth.operatingProfit) / Math.abs(prevMonth.operatingProfit)) * 100)
        : null,
    },
    receivables: {
      total: ar.totalOutstanding,
      overdue: ar.summary.over90 + ar.summary["61-90"] + ar.summary["31-60"],
    },
    payables: {
      total: ap.totalOutstanding,
      overdue: ap.summary.over90 + ap.summary["61-90"] + ap.summary["31-60"],
    },
    topExpenses,
    alerts,
  };
};

module.exports = { overview };
