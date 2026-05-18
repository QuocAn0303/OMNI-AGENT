// src/modules/accounting/financial-report.service.js
// Tổng hợp số liệu từ journal_lines để xây các báo cáo tài chính.
const prisma = require("../../config/prisma");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Lấy số phát sinh (debit/credit/net) cho TẤT CẢ tài khoản trong khoảng [from, to].
 * Trả về Map theo accountId.
 */
const aggregateByAccount = async ({ from, to } = {}) => {
  const dateFilter = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const lines = await prisma.journalLine.findMany({
    where: {
      entry: {
        status: "POSTED",
        ...(from || to ? { date: dateFilter } : {}),
      },
    },
    select: {
      accountId: true,
      debit: true,
      credit: true,
      account: {
        select: { id: true, code: true, name: true, nameVi: true, type: true, normalBalance: true, isCash: true, parentId: true },
      },
    },
  });

  const map = new Map();
  for (const l of lines) {
    const k = l.accountId;
    if (!map.has(k)) {
      map.set(k, {
        account: l.account,
        debit: 0,
        credit: 0,
      });
    }
    const m = map.get(k);
    m.debit += toNum(l.debit);
    m.credit += toNum(l.credit);
  }
  for (const m of map.values()) {
    m.debit = round2(m.debit);
    m.credit = round2(m.credit);
    m.balance = m.account.normalBalance === "DEBIT"
      ? round2(m.debit - m.credit)
      : round2(m.credit - m.debit);
  }
  return map;
};

/**
 * Báo cáo Lãi/Lỗ (P&L) trong kỳ.
 * Doanh thu - Giảm trừ - Giá vốn - Chi phí = Lợi nhuận
 */
const profitAndLoss = async ({ from, to } = {}) => {
  const map = await aggregateByAccount({ from, to });
  const rows = [...map.values()];

  const revenue = rows
    .filter((r) => r.account.type === "REVENUE" && r.account.normalBalance === "CREDIT")
    .reduce((s, r) => s + r.balance, 0);
  const deductions = rows
    .filter((r) => r.account.type === "REVENUE" && r.account.normalBalance === "DEBIT")
    .reduce((s, r) => s + r.balance, 0);
  const cogs = rows
    .filter((r) => r.account.type === "COST_OF_GOODS_SOLD")
    .reduce((s, r) => s + r.balance, 0);
  const expenses = rows
    .filter((r) => r.account.type === "EXPENSE")
    .reduce((s, r) => s + r.balance, 0);

  const grossProfit = round2(revenue - deductions - cogs);
  const operatingProfit = round2(grossProfit - expenses);

  // Chi tiết theo tài khoản
  const detail = (type, normalBalance) =>
    rows
      .filter((r) => r.account.type === type && (!normalBalance || r.account.normalBalance === normalBalance))
      .map((r) => ({
        code: r.account.code,
        name: r.account.nameVi,
        amount: r.balance,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

  return {
    period: { from, to },
    revenue: round2(revenue),
    deductions: round2(deductions),
    netRevenue: round2(revenue - deductions),
    cogs: round2(cogs),
    grossProfit,
    expenses: round2(expenses),
    operatingProfit,
    detail: {
      revenue: detail("REVENUE", "CREDIT"),
      deductions: detail("REVENUE", "DEBIT"),
      cogs: detail("COST_OF_GOODS_SOLD"),
      expenses: detail("EXPENSE"),
    },
  };
};

/**
 * Bảng cân đối kế toán (Balance Sheet) tại thời điểm endDate.
 * Tài sản = Nợ phải trả + Vốn chủ
 * Để có số liệu chính xác, hợp nhất số dư từ đầu đến endDate.
 */
const balanceSheet = async ({ asOf } = {}) => {
  const map = await aggregateByAccount({ to: asOf });
  const rows = [...map.values()];

  // Tính lợi nhuận chưa phân phối từ Revenue - Expense - CoGS
  const revenue = rows
    .filter((r) => r.account.type === "REVENUE" && r.account.normalBalance === "CREDIT")
    .reduce((s, r) => s + r.balance, 0);
  const deductions = rows
    .filter((r) => r.account.type === "REVENUE" && r.account.normalBalance === "DEBIT")
    .reduce((s, r) => s + r.balance, 0);
  const cogs = rows
    .filter((r) => r.account.type === "COST_OF_GOODS_SOLD")
    .reduce((s, r) => s + r.balance, 0);
  const expenses = rows
    .filter((r) => r.account.type === "EXPENSE")
    .reduce((s, r) => s + r.balance, 0);
  const retainedEarningsAuto = round2(revenue - deductions - cogs - expenses);

  const formatRow = (r) => ({
    code: r.account.code,
    name: r.account.nameVi,
    amount: r.balance,
  });

  const assets = rows.filter((r) => r.account.type === "ASSET").map(formatRow).filter((r) => r.amount !== 0);
  const liabilities = rows.filter((r) => r.account.type === "LIABILITY").map(formatRow).filter((r) => r.amount !== 0);
  const equity = rows.filter((r) => r.account.type === "EQUITY").map(formatRow).filter((r) => r.amount !== 0);

  // Lợi nhuận chưa phân phối tự động (nếu chưa có)
  if (retainedEarningsAuto !== 0) {
    equity.push({ code: "421-AUTO", name: "Lợi nhuận chưa phân phối (tự tính)", amount: retainedEarningsAuto });
  }

  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));
  const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);

  return {
    asOf,
    assets: assets.sort((a, b) => a.code.localeCompare(b.code)),
    liabilities: liabilities.sort((a, b) => a.code.localeCompare(b.code)),
    equity: equity.sort((a, b) => a.code.localeCompare(b.code)),
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
  };
};

/**
 * Cash Flow Statement (đơn giản hóa: dựa trên giao dịch của tài khoản tiền 111, 112).
 * Phân theo loại nguồn (source).
 */
const cashFlow = async ({ from, to } = {}) => {
  const dateFilter = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const cashAccounts = await prisma.account.findMany({ where: { isCash: true } });
  const cashIds = cashAccounts.map((a) => a.id);

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashIds },
      entry: { status: "POSTED", ...(from || to ? { date: dateFilter } : {}) },
    },
    include: {
      entry: { select: { source: true, date: true, description: true } },
      account: { select: { code: true, nameVi: true } },
    },
  });

  // Phân loại theo source
  const groups = {};
  for (const l of lines) {
    const src = l.entry.source;
    if (!groups[src]) groups[src] = { source: src, inflow: 0, outflow: 0, net: 0 };
    groups[src].inflow += toNum(l.debit);  // tăng tiền
    groups[src].outflow += toNum(l.credit); // giảm tiền
  }
  Object.values(groups).forEach((g) => {
    g.inflow = round2(g.inflow);
    g.outflow = round2(g.outflow);
    g.net = round2(g.inflow - g.outflow);
  });

  // Operating / Investing / Financing classification (đơn giản)
  const classification = {
    OPERATING: ["ORDER", "PAYMENT", "RETURN", "EXPENSE", "PURCHASE", "PAYROLL"],
    INVESTING: ["INVENTORY"],
    FINANCING: ["MANUAL", "BANK", "OPENING_BALANCE", "ADJUSTMENT"],
  };
  const classified = { OPERATING: 0, INVESTING: 0, FINANCING: 0 };
  for (const [k, v] of Object.entries(groups)) {
    for (const [cat, srcs] of Object.entries(classification)) {
      if (srcs.includes(k)) {
        classified[cat] += v.net;
        break;
      }
    }
  }
  Object.keys(classified).forEach((k) => (classified[k] = round2(classified[k])));

  const totalInflow = round2(Object.values(groups).reduce((s, g) => s + g.inflow, 0));
  const totalOutflow = round2(Object.values(groups).reduce((s, g) => s + g.outflow, 0));
  const netCashFlow = round2(totalInflow - totalOutflow);

  // Số dư đầu kỳ & cuối kỳ
  const openingMap = await aggregateByAccount({ to: from ? new Date(new Date(from).getTime() - 1) : undefined });
  const closingMap = await aggregateByAccount({ to });
  let opening = 0;
  let closing = 0;
  for (const id of cashIds) {
    opening += openingMap.get(id)?.balance || 0;
    closing += closingMap.get(id)?.balance || 0;
  }

  return {
    period: { from, to },
    openingCash: round2(opening),
    closingCash: round2(closing),
    totalInflow,
    totalOutflow,
    netCashFlow,
    bySource: Object.values(groups).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    byActivity: classified,
  };
};

/**
 * Sổ cái: lấy tất cả journal lines của một account trong khoảng kỳ.
 * Số dư running được tính ĐÚNG cho từng trang:
 *   pageOpening = periodOpening + Σ(prior pages in period)
 *   pageClosing = pageOpening + Σ(current page lines)
 * periodClosing được tính riêng từ aggregate (không phụ thuộc trang).
 */
const generalLedger = async ({ accountId, from, to, page = 1, limit = 50 }) => {
  const pageNum = Math.max(1, Number(page));
  const pageSize = Math.max(1, Number(limit));

  const where = {
    accountId,
    entry: { status: "POSTED" },
  };
  if (from || to) {
    where.entry.date = {};
    if (from) where.entry.date.gte = new Date(from);
    if (to) where.entry.date.lte = new Date(to);
  }

  const skip = (pageNum - 1) * pageSize;

  const [account, total] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId } }),
    prisma.journalLine.count({ where }),
  ]);
  if (!account) throw { status: 404, message: "Không tìm thấy tài khoản" };

  // Số dư đầu kỳ (trước `from`)
  const openingMap = await aggregateByAccount({
    to: from ? new Date(new Date(from).getTime() - 1) : undefined,
  });
  const periodOpening = openingMap.get(accountId)?.balance || 0;

  // Số dư cuối kỳ thực tế (toàn bộ aggregate đến `to`) - không phụ thuộc trang
  const closingMap = await aggregateByAccount({ to });
  const periodClosing = closingMap.get(accountId)?.balance || 0;

  const sign = account.normalBalance === "DEBIT" ? 1 : -1;

  // Tính tổng debit/credit của các dòng TRƯỚC trang hiện tại trong cùng kỳ.
  // Dùng aggregate với cùng orderBy + skip để tận dụng index.
  let priorPagesDebit = 0;
  let priorPagesCredit = 0;
  if (skip > 0) {
    const priorLines = await prisma.journalLine.findMany({
      where,
      take: skip,
      skip: 0,
      orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
      select: { debit: true, credit: true },
    });
    for (const l of priorLines) {
      priorPagesDebit += toNum(l.debit);
      priorPagesCredit += toNum(l.credit);
    }
  }
  const pageOpening = periodOpening + sign * (priorPagesDebit - priorPagesCredit);

  const lines = await prisma.journalLine.findMany({
    where,
    skip,
    take: pageSize,
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
    include: {
      entry: { select: { entryCode: true, date: true, source: true, sourceId: true, description: true } },
    },
  });

  let running = pageOpening;
  const items = lines.map((l) => {
    const d = toNum(l.debit);
    const c = toNum(l.credit);
    running += sign * (d - c);
    return {
      id: l.id,
      date: l.entry.date,
      entryCode: l.entry.entryCode,
      source: l.entry.source,
      description: l.description || l.entry.description,
      debit: d,
      credit: c,
      balance: round2(running),
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      nameVi: account.nameVi,
      normalBalance: account.normalBalance,
    },
    openingBalance: round2(periodOpening),
    pageOpeningBalance: round2(pageOpening),
    closingBalance: round2(periodClosing),
    items,
    pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
};

/**
 * Trial Balance (Bảng cân đối tài khoản): tổng hợp toàn bộ tài khoản với debit/credit và số dư.
 */
const trialBalance = async ({ from, to } = {}) => {
  const map = await aggregateByAccount({ from, to });
  const rows = [...map.values()]
    .filter((r) => r.balance !== 0 || r.debit !== 0 || r.credit !== 0)
    .map((r) => ({
      code: r.account.code,
      name: r.account.nameVi,
      type: r.account.type,
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

  return { period: { from, to }, rows, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.01 };
};

/**
 * Aging Report: tuổi nợ phải thu (TK 131) hoặc phải trả (TK 331).
 *
 * Cách tính ĐÚNG cho cả AR và AP:
 *  - "increase" side là side LÀM TĂNG nghĩa vụ:
 *      * AR (TK 131, normalBalance=DEBIT): debit > 0 = phát sinh hóa đơn (tăng phải thu)
 *      * AP (TK 331, normalBalance=CREDIT): credit > 0 = phát sinh hóa đơn (tăng phải trả)
 *  - Mỗi dòng "increase" là một giao dịch chưa cấn → có age riêng theo ngày phát sinh.
 *  - "decrease" lines giảm dần các giao dịch chưa cấn theo FIFO (oldest first).
 *  - Sau khi cấn FIFO, phần dư của mỗi dòng increase rơi vào bucket dựa trên age.
 *
 * Trả về cả breakdown theo bucket (party-level) lẫn danh sách giao dịch lẻ chưa cấn.
 */
const agingReport = async ({ accountCode = "131" } = {}) => {
  const account = await prisma.account.findUnique({ where: { code: accountCode } });
  if (!account) throw { status: 404, message: `Không tìm thấy tài khoản ${accountCode}` };

  const isDebitNormal = account.normalBalance === "DEBIT";
  // Field nào là "increase" (tăng nghĩa vụ)
  const increaseField = isDebitNormal ? "debit" : "credit";
  const decreaseField = isDebitNormal ? "credit" : "debit";

  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, entry: { status: "POSTED" } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
    include: {
      entry: { select: { date: true, entryCode: true, description: true, source: true, sourceId: true } },
    },
  });

  // Group theo party
  const partyGroups = new Map();
  const keyOf = (l) => `${l.partyType || "UNKNOWN"}::${l.partyId || "NONE"}`;
  for (const l of lines) {
    const k = keyOf(l);
    if (!partyGroups.has(k)) {
      partyGroups.set(k, { partyType: l.partyType, partyId: l.partyId, lines: [] });
    }
    partyGroups.get(k).lines.push(l);
  }

  const today = new Date();
  const bucketFor = (ageDays) => {
    if (ageDays > 90) return "over90";
    if (ageDays > 60) return "61-90";
    if (ageDays > 30) return "31-60";
    if (ageDays > 0) return "1-30";
    return "current";
  };

  const allOpenInvoices = []; // chi tiết hóa đơn chưa cấn xong
  const partyResults = [];

  for (const grp of partyGroups.values()) {
    // FIFO: queue các "increase" lines, mỗi line giữ remaining
    const open = []; // [{ entryDate, entryCode, source, sourceId, original, remaining }]
    for (const l of grp.lines) {
      const incAmount = toNum(l[increaseField]);
      const decAmount = toNum(l[decreaseField]);
      if (incAmount > 0) {
        open.push({
          date: l.entry.date,
          entryCode: l.entry.entryCode,
          source: l.entry.source,
          sourceId: l.entry.sourceId,
          description: l.description || l.entry.description,
          original: incAmount,
          remaining: incAmount,
        });
      }
      if (decAmount > 0) {
        // FIFO match: trừ vào các open invoices cũ nhất trước
        let toMatch = decAmount;
        for (const inv of open) {
          if (toMatch <= 0) break;
          if (inv.remaining <= 0) continue;
          const m = Math.min(inv.remaining, toMatch);
          inv.remaining = round2(inv.remaining - m);
          toMatch = round2(toMatch - m);
        }
        // overpayment (toMatch > 0) → bỏ qua hoặc tạo "credit balance" (advance)
      }
    }

    // Tổng hợp party
    const partyBuckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, over90: 0 };
    let partyOutstanding = 0;
    let oldestDate = null;
    for (const inv of open) {
      if (inv.remaining < 0.01) continue;
      const ageDays = Math.max(0, Math.floor((today - new Date(inv.date)) / (1000 * 60 * 60 * 24)));
      const bucket = bucketFor(ageDays);
      partyBuckets[bucket] = round2(partyBuckets[bucket] + inv.remaining);
      partyOutstanding = round2(partyOutstanding + inv.remaining);
      if (!oldestDate || new Date(inv.date) < new Date(oldestDate)) oldestDate = inv.date;
      allOpenInvoices.push({
        partyType: grp.partyType,
        partyId: grp.partyId,
        date: inv.date,
        entryCode: inv.entryCode,
        source: inv.source,
        description: inv.description,
        original: round2(inv.original),
        remaining: round2(inv.remaining),
        ageDays,
        bucket,
      });
    }
    if (partyOutstanding < 0.01) continue;

    const oldestAge = oldestDate
      ? Math.max(0, Math.floor((today - new Date(oldestDate)) / (1000 * 60 * 60 * 24)))
      : 0;

    partyResults.push({
      partyType: grp.partyType,
      partyId: grp.partyId,
      balance: partyOutstanding,
      bucket: bucketFor(oldestAge),
      ageDays: oldestAge,
      buckets: partyBuckets,
      oldestInvoiceDate: oldestDate,
    });
  }

  // Resolve party names
  const customerIds = partyResults.filter((r) => r.partyType === "CUSTOMER" && r.partyId).map((r) => r.partyId);
  const vendorIds = partyResults.filter((r) => r.partyType === "VENDOR" && r.partyId).map((r) => r.partyId);
  const [customers, vendors] = await Promise.all([
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, phone: true } }) : [],
    vendorIds.length ? prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true, phone: true } }) : [],
  ]);
  const cMap = new Map(customers.map((c) => [c.id, c]));
  const vMap = new Map(vendors.map((v) => [v.id, v]));
  for (const r of partyResults) {
    if (r.partyType === "CUSTOMER" && cMap.has(r.partyId)) r.party = cMap.get(r.partyId);
    if (r.partyType === "VENDOR" && vMap.has(r.partyId)) r.party = vMap.get(r.partyId);
  }
  for (const inv of allOpenInvoices) {
    if (inv.partyType === "CUSTOMER" && cMap.has(inv.partyId)) inv.party = cMap.get(inv.partyId);
    if (inv.partyType === "VENDOR" && vMap.has(inv.partyId)) inv.party = vMap.get(inv.partyId);
  }

  partyResults.sort((a, b) => b.balance - a.balance);

  // Summary tổng theo bucket (cộng từ buckets của từng party - chính xác hơn ageDays-only)
  const summary = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, over90: 0 };
  for (const r of partyResults) {
    for (const k of Object.keys(summary)) {
      summary[k] = round2(summary[k] + (r.buckets[k] || 0));
    }
  }

  return {
    account: { code: account.code, name: account.nameVi },
    rows: partyResults,
    openInvoices: allOpenInvoices.sort((a, b) => new Date(a.date) - new Date(b.date)),
    summary,
    totalOutstanding: round2(partyResults.reduce((s, r) => s + r.balance, 0)),
  };
};

module.exports = {
  profitAndLoss,
  balanceSheet,
  cashFlow,
  generalLedger,
  trialBalance,
  agingReport,
  aggregateByAccount,
};
