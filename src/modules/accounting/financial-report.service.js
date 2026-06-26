/**
 * modules/accounting/financial-report.service.js — Báo cáo tài chính
 * 
 * Tổng quan:
 * - Xây dựng các báo cáo tài chính từ dữ liệu journal entries đã POSTED.
 * - Sử dụng aggregateByAccount làm hàm cốt lõi để tổng hợp số phát sinh debit/credit theo tài khoản.
 * - Xác thực số liệu bằng nguyên tắc kế toán: tổng debit = tổng credit, tài sản = nợ + vốn chủ.
 * 
 * Hàm:
 * - aggregateByAccount({from, to}): Map<accountId, {account, debit, credit, balance}> — tổng hợp số phát sinh.
 * - profitAndLoss({from, to}): Báo cáo lãi/lỗ (P&L): doanh thu - giảm trừ - giá vốn - chi phí = lợi nhuận.
 * - balanceSheet({asOf}): Bảng cân đối kế toán: tài sản = nợ phải trả + vốn chủ; tính lợi nhuận chưa phân phối.
 * - cashFlow({from, to}): Báo cáo lưu chuyển tiền tệ dựa trên tài khoản isCash, phân loại theo nguồn (OPERATING/INVESTING/FINANCING).
 * - generalLedger({accountId, from, to, page, limit}): Sổ cái chi tiết tài khoản với số dư running và phân trang.
 * - trialBalance({from, to}): Bảng cân đối tài khoản: tất cả tài khoản với debit/credit/balance, kiểm tra cân bằng.
 * - agingReport({accountCode}): Báo cáo tuổi nợ (AR/AP) theo phương pháp FIFO: mỗi dòng tăng giao dịch là hóa đơn, dòng giảm cấn trừ dần.
 */
// src/modules/accounting/financial-report.service.js
// Tổng hợp số liệu từ journal_lines để xây các báo cáo tài chính.
const prisma = require("../../config/prisma");
const journalService = require("./journal.service");

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

// ══════════════════════════════════════════════════════════════
// TT200-COMPLIANT REPORTS
// ══════════════════════════════════════════════════════════════

const trialBalance6Col = async ({ year, month }) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const prevMonthEnd = new Date(year, month - 1, 0, 23, 59, 59);

  const accounts = await prisma.account.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, nameVi: true, type: true, normalBalance: true },
  });

  const hasOpening = month > 1;
  const rows = [];
  for (const acc of accounts) {
    const [op, period] = await Promise.all([
      hasOpening ? journalService.getAccountBalance(acc.id, new Date(0), prevMonthEnd) : { debit: 0, credit: 0, balance: 0 },
      journalService.getAccountBalance(acc.id, from, to),
    ]);

    const opDebit = acc.normalBalance === "DEBIT" ? Math.max(0, op.balance || 0) : Math.max(0, -(op.balance || 0));
    const opCredit = acc.normalBalance === "DEBIT" ? Math.max(0, -(op.balance || 0)) : Math.max(0, op.balance || 0);
    const closingBalance = (op.balance || 0) + (acc.normalBalance === "DEBIT" ? period.debit - period.credit : period.credit - period.debit);
    const clDebit = acc.normalBalance === "DEBIT" ? Math.max(0, closingBalance) : Math.max(0, -closingBalance);
    const clCredit = acc.normalBalance === "DEBIT" ? Math.max(0, -closingBalance) : Math.max(0, closingBalance);

    rows.push({
      code: acc.code, name: acc.nameVi || acc.name, type: acc.type,
      opDebit: round2(opDebit), opCredit: round2(opCredit),
      periodDebit: round2(period.debit), periodCredit: round2(period.credit),
      clDebit: round2(clDebit), clCredit: round2(clCredit),
    });
  }

  const totals = rows.reduce((s, r) => ({
    opDebit: s.opDebit + r.opDebit, opCredit: s.opCredit + r.opCredit,
    periodDebit: s.periodDebit + r.periodDebit, periodCredit: s.periodCredit + r.periodCredit,
    clDebit: s.clDebit + r.clDebit, clCredit: s.clCredit + r.clCredit,
  }), { opDebit: 0, opCredit: 0, periodDebit: 0, periodCredit: 0, clDebit: 0, clCredit: 0 });

  return { period: { year, month }, rows, totals };
};

const generalJournal = async ({ year, month, page = 1, limit = 100 }) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const entries = await prisma.journalEntry.findMany({
    where: { date: { gte: from, lte: to }, status: "POSTED" },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: [{ date: "asc" }, { entryCode: "asc" }],
    skip: (page - 1) * limit, take: limit,
  });
  const rows = [];
  for (const entry of entries) {
    for (const line of entry.lines) {
      const counterpartCodes = entry.lines.filter((l) => l.id !== line.id).map((l) => l.account.code).join(", ");
      rows.push({
        date: entry.date.toISOString().slice(0, 10),
        entryCode: entry.entryCode, description: entry.description,
        accountCode: line.account.code, accountName: line.account.name,
        debit: round2(Number(line.debit)), credit: round2(Number(line.credit)),
        counterpart: counterpartCodes,
      });
    }
  }
  const total = await prisma.journalEntry.count({ where: { date: { gte: from, lte: to }, status: "POSTED" } });
  return { period: { year, month }, rows, pagination: { page, limit, total } };
};

const accountLedger = async ({ accountId, year, month }) => {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, code: true, name: true, nameVi: true, type: true, normalBalance: true },
  });
  if (!account) throw { status: 404, message: "Account not found" };

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const prevMonthEnd = new Date(year, month - 1, 0, 23, 59, 59);

  const op = month > 1 ? await journalService.getAccountBalance(accountId, new Date(0), prevMonthEnd) : { balance: 0 };
  const lines = await prisma.journalLine.findMany({
    where: { accountId, entry: { status: "POSTED", date: { gte: from, lte: to } } },
    include: { entry: { select: { id: true, entryCode: true, date: true, description: true, source: true, lines: { include: { account: { select: { code: true, name: true } } } } } } },
    orderBy: [{ entry: { date: "asc" } }],
  });

  let running = op.balance || 0;
  const rows = [];
  for (const line of lines) {
    running = account.normalBalance === "DEBIT"
      ? round2(running + Number(line.debit) - Number(line.credit))
      : round2(running + Number(line.credit) - Number(line.debit));
    const counterparts = line.entry.lines.filter((l) => l.accountId !== accountId)
      .map((l) => `${l.account.code} (${Number(l.debit) > 0 ? `No ${round2(Number(l.debit))}` : `Co ${round2(Number(l.credit))}`})`).join("; ");
    rows.push({
      date: line.entry.date.toISOString().slice(0, 10), entryCode: line.entry.entryCode,
      description: line.entry.description, counterpart: counterparts,
      debit: round2(Number(line.debit)), credit: round2(Number(line.credit)),
      balance: running, source: line.entry.source,
    });
  }
  return { account, period: { year, month }, openingBalance: round2(op.balance || 0), closingBalance: running, rows };
};

const subLedger = async ({ accountCode, partyId, year, month }) => {
  const account = await prisma.account.findUnique({ where: { code: accountCode } });
  if (!account) throw { status: 404, message: "Account not found" };
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const prevMonthEnd = new Date(year, month - 1, 0, 23, 59, 59);

  const opLines = await prisma.journalLine.findMany({
    where: {
      accountId: account.id, entry: { status: "POSTED", date: { lte: prevMonthEnd } },
      ...(partyId ? { partyId } : {}),
    },
    select: { debit: true, credit: true },
  });
  const opBalance = account.normalBalance === "DEBIT"
    ? round2(opLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0))
    : round2(opLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0));

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: account.id, entry: { status: "POSTED", date: { gte: from, lte: to } },
      ...(partyId ? { partyId } : {}),
    },
    include: { entry: { select: { entryCode: true, date: true, description: true, source: true } } },
    orderBy: [{ entry: { date: "asc" } }],
  });

  let running = opBalance;
  const rows = [];
  for (const line of lines) {
    running = account.normalBalance === "DEBIT"
      ? round2(running + Number(line.debit) - Number(line.credit))
      : round2(running + Number(line.credit) - Number(line.debit));
    rows.push({
      date: line.entry.date.toISOString().slice(0, 10), entryCode: line.entry.entryCode,
      description: line.entry.description,
      debit: round2(Number(line.debit)), credit: round2(Number(line.credit)),
      balance: running, source: line.entry.source,
    });
  }
  return { account, period: { year, month }, openingBalance: opBalance, closingBalance: running, rows };
};

const balanceSheetB01 = async ({ year, month }) => {
  const to = new Date(year, month, 0, 23, 59, 59);
  const getNet = (codes = []) => journalService.getAccountBalance("aggregate", new Date(0), to).then(() => {
    return Promise.all(codes.map((c) => prisma.account.findUnique({ where: { code: c } }).then((a) => {
      if (!a) return 0;
      return journalService.getAccountBalance(a.id, new Date(0), to).then((b) => {
        if (["214"].includes(c)) return -(b.credit - b.debit);
        return a.normalBalance === "CREDIT" ? b.credit - b.debit : b.debit - b.credit;
      });
    }))).then((arr) => arr.reduce((s, v) => s + (typeof v === "number" ? v : 0), 0));
  });

  // Actually simpler approach: aggregate everything by type
  const accounts = await prisma.account.findMany({ select: { id: true, code: true, nameVi: true, type: true, normalBalance: true } });
  const balances = {};
  for (const acc of accounts) {
    const b = await journalService.getAccountBalance(acc.id, new Date(0), to);
    balances[acc.code] = acc.normalBalance === "CREDIT" ? b.credit - b.debit : b.debit - b.credit;
  }

  const sumOf = (codes) => codes.reduce((s, c) => s + round2(balances[c] || 0), 0);

  const totalShortAssets = sumOf(["111", "112", "131", "138", "133", "141", "154", "155", "156"]);
  const totalLongAssets = sumOf(["211"]) + sumOf(["214"]); // 214 is negative
  const totalLiabilities = sumOf(["331", "333", "3331", "3334", "3335", "334", "338", "341"]);
  const totalEquity = sumOf(["411", "421"]);

  return {
    period: { year, month },
    assets: { short: totalShortAssets, long: totalLongAssets, total: round2(totalShortAssets + totalLongAssets) },
    liabilities: { total: round2(totalLiabilities) },
    equity: { total: round2(totalEquity) },
    totalLiabilitiesEquity: round2(totalLiabilities + totalEquity),
    balanced: Math.abs(round2(totalShortAssets + totalLongAssets) - round2(totalLiabilities + totalEquity)) < 100,
  };
};

const profitAndLossB02 = async ({ year, month }) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);

  const getAcc = async (code) => {
    const acc = await prisma.account.findUnique({ where: { code } });
    if (!acc) return { debit: 0, credit: 0 };
    return journalService.getAccountBalance(acc.id, from, to);
  };

  const netOf = async (code, isRevenue) => {
    const b = await getAcc(code);
    return isRevenue ? (b.credit - b.debit) : (b.debit - b.credit);
  };

  const netRevenue = await netOf("511", true);
  const deductions = Math.abs(await netOf("521", false));
  const netRevenueActual = round2(Math.max(0, netRevenue - deductions));
  const cogs = await netOf("632", false);
  const grossProfit = round2(netRevenueActual - cogs);
  const finRevenue = await netOf("515", true);
  const finExpense = await netOf("635", false);
  const sellingExp = await netOf("641", false);
  const adminExp = await netOf("642", false);
  const operatingProfit = round2(grossProfit + finRevenue - finExpense - sellingExp - adminExp);
  const otherIncome = await netOf("711", true);
  const otherExpense = await netOf("811", false);
  const otherProfit = round2(otherIncome - otherExpense);
  const profitBeforeTax = round2(operatingProfit + otherProfit);
  const citExpense = await netOf("821", false);
  const netProfit = round2(profitBeforeTax - citExpense);

  return {
    period: { year, month },
    rows: [
      { code: "01", name: "1. Doanh thu ban hang", value: netRevenue },
      { code: "02", name: "2. Cac khoan giam tru", value: deductions },
      { code: "10", name: "3. Doanh thu thuan", value: netRevenueActual, bold: true },
      { code: "11", name: "4. Gia von hang ban", value: cogs },
      { code: "20", name: "5. Loi nhuan gop", value: grossProfit, bold: true },
      { code: "21", name: "6. Doanh thu tai chinh", value: finRevenue },
      { code: "22", name: "7. Chi phi tai chinh", value: finExpense },
      { code: "23", name: "8. Chi phi ban hang", value: sellingExp },
      { code: "24", name: "9. Chi phi quan ly DN", value: adminExp },
      { code: "30", name: "10. Loi nhuan thuan tu HDSXKD", value: operatingProfit, bold: true },
      { code: "31", name: "11. Thu nhap khac", value: otherIncome },
      { code: "32", name: "12. Chi phi khac", value: otherExpense },
      { code: "40", name: "13. Loi nhuan khac", value: otherProfit, bold: true },
      { code: "50", name: "14. Tong loi nhuan truoc thue", value: profitBeforeTax, bold: true },
      { code: "51", name: "15. Chi phi thue TNDN", value: citExpense },
      { code: "60", name: "16. Loi nhuan sau thue", value: netProfit, bold: true },
    ],
    summary: { netRevenue: netRevenueActual, grossProfit, operatingProfit, profitBeforeTax, netProfit },
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
  trialBalance6Col,
  generalJournal,
  accountLedger,
  subLedger,
  balanceSheetB01,
  profitAndLossB02,
};
