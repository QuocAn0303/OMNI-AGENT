const prisma = require("../../config/prisma");
const journalService = require("./journal.service");
const auditService = require("../audit/audit.service");
const logger = require('../../utils/logger');

const LOG = "[period-close]";

// ══════════════════════════════════════════════════════
// 1. KẾT CHUYỂN CUỐI KỲ (PERIOD-END CLOSING ENTRIES)
// ══════════════════════════════════════════════════════

/**
 * Kết chuyển doanh thu → TK 911
 * Nợ 511, 515, 711 / Có 911
 */
const closeRevenue = async ({ year, month, userId }) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const periodDesc = `${month}/${year}`;

  const revenueAccounts = ["511", "515", "711"];
  const entries = [];

  for (const code of revenueAccounts) {
    const acc = await prisma.account.findUnique({ where: { code }, select: { id: true, name: true } });
    if (!acc) continue;

    const balance = await journalService.getAccountBalance(acc.id, from, to);
    const netBalance = balance.credit - balance.debit;
    if (netBalance <= 0) continue;

    const entry = await journalService.postEntry({
      date: to,
      description: `Kết chuyển doanh thu ${acc.name} thang ${periodDesc}`,
      source: "CLOSING",
      sourceId: `close-revenue-${code}-${year}-${month}`,
      operation: "REVENUE_CLOSE",
      userId,
      lines: [
        { accountCode: code, debit: netBalance, description: `Kết chuyển ${acc.name}` },
        { accountCode: "911", credit: netBalance, description: `Kết chuyển doanh thu thang ${periodDesc}` },
      ],
    });
    entries.push(entry);
  }

  logger.info(`${LOG} closeRevenue: ${entries.length} entries`);
  return entries;
};

/**
 * Kết chuyển chi phí → TK 911
 * Nợ 911 / Có 632, 635, 641, 642, 811, 821
 */
const closeExpenses = async ({ year, month, userId }) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const periodDesc = `${month}/${year}`;

  const expenseAccounts = ["632", "635", "641", "642", "811", "821"];
  const entries = [];

  for (const code of expenseAccounts) {
    const acc = await prisma.account.findUnique({ where: { code }, select: { id: true, name: true } });
    if (!acc) continue;

    const balance = await journalService.getAccountBalance(acc.id, from, to);
    const netBalance = balance.debit - balance.credit;
    if (netBalance <= 0) continue;

    const entry = await journalService.postEntry({
      date: to,
      description: `Kết chuyển chi phí ${acc.name} thang ${periodDesc}`,
      source: "CLOSING",
      sourceId: `close-expense-${code}-${year}-${month}`,
      operation: "EXPENSE_CLOSE",
      userId,
      lines: [
        { accountCode: "911", debit: netBalance, description: `Kết chuyển chi phí thang ${periodDesc}` },
        { accountCode: code, credit: netBalance, description: `Kết chuyển ${acc.name}` },
      ],
    });
    entries.push(entry);
  }

  logger.info(`${LOG} closeExpenses: ${entries.length} entries`);
  return entries;
};

/**
 * Kết chuyển lãi/lỗ → TK 421
 * Nợ 911 / Có 421 (lãi) hoặc Nợ 421 / Có 911 (lỗ)
 */
const closeProfitLoss = async ({ year, month, userId }) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const periodDesc = `${month}/${year}`;

  const acc911 = await prisma.account.findUnique({ where: { code: "911" } });
  if (!acc911) throw new Error("TK 911 not found");

  const balance = await journalService.getAccountBalance(acc911.id, from, to);
  const netBalance = balance.credit - balance.debit;
  const isProfit = netBalance > 0;
  const profitAmount = Math.abs(netBalance);

  if (profitAmount === 0) {
    logger.info(`${LOG} closeProfitLoss: no profit/loss to transfer`);
    return null;
  }

  const entry = await journalService.postEntry({
    date: to,
    description: `Kết chuyển ${isProfit ? "lai" : "lo"} thang ${periodDesc}`,
    source: "CLOSING",
    sourceId: `close-pl-${year}-${month}`,
    operation: "PROFIT_LOSS_CLOSE",
    userId,
    lines: isProfit
      ? [
          { accountCode: "911", debit: profitAmount, description: `Kết chuyển lai` },
          { accountCode: "421", credit: profitAmount, description: `Lai thang ${periodDesc}` },
        ]
      : [
          { accountCode: "421", debit: profitAmount, description: `Kết chuyển lo` },
          { accountCode: "911", credit: profitAmount, description: `Lo thang ${periodDesc}` },
        ],
  });

  logger.info(`${LOG} closeProfitLoss: ${isProfit ? "profit" : "loss"} ${profitAmount.toLocaleString()} VND`);
  return entry;
};

/**
 * Full period-end close: Revenue → Expense → Profit/Loss
 * Kiểm tra: chưa có bút toán close nào cho kỳ này
 */
const runPeriodClose = async ({ year, month, userId }) => {
  const existing = await prisma.journalEntry.findFirst({
    where: { source: "CLOSING", sourceId: `close-pl-${year}-${month}` },
  });
  if (existing) {
    throw { status: 400, message: `Thang ${month}/${year} da duoc kết chuyển roi` };
  }

  const results = { year, month, revenue: null, expenses: null, profitLoss: null };

  results.revenue = await closeRevenue({ year, month, userId });
  results.expenses = await closeExpenses({ year, month, userId });
  results.profitLoss = await closeProfitLoss({ year, month, userId });

  await auditService.log({
    userId, action: "PERIOD_CLOSE", entity: "FiscalPeriod",
    entityId: `${year}-${month}`, after: { status: "CLOSED" },
  }).catch(() => {});

  logger.info(`${LOG} period-close ${month}/${year} completed`);
  return results;
};

// ══════════════════════════════════════════════════════
// 2. PHÂN BỔ CHI PHÍ TRẢ TRƯỚC (PREPAID EXPENSE)
// ══════════════════════════════════════════════════════

/**
 * Tạo khoản chi phí trả trước (prepaid expense)
 * Nợ TK 242 / Có TK 111/112/331
 */
const createPrepaid = async (userId, data) => {
  const { description, amount, totalMonths, startMonth, startYear, paymentAccountCode, vendorId } = data;
  if (!amount || !totalMonths || totalMonths < 1) {
    throw { status: 400, message: "Vui lòng nhap so tien va so thang phân bổ" };
  }

  const monthlyAmount = Math.round(amount / totalMonths);
  const start = startMonth && startYear ? new Date(startYear, startMonth - 1, 1) : new Date();

  const prepaid = await prisma.prepaidExpense.create({
    data: {
      description, amount, totalMonths, monthlyAmount,
      remainingAmount: amount, allocatedMonths: 0,
      startDate: start,
      endDate: new Date(start.getFullYear(), start.getMonth() + totalMonths, 0),
      status: "ACTIVE",
      createdById: userId,
    },
  });

  // Hạch toán: Nợ 242 / Có paymentAccount
  await journalService.postEntry({
    date: start,
    description: `Chi phi tra truoc: ${description}`,
    source: "PREPAID",
    sourceId: `prepaid-${prepaid.id}`,
    operation: "PRIMARY",
    userId,
    lines: [
      { accountCode: "242", debit: amount, description: `Tra truoc ${description}` },
      { accountCode: paymentAccountCode || "112", credit: amount, description: `Thanh toan ${description}` },
    ],
  });

  logger.info(`${LOG} createPrepaid: ${prepaid.id}, ${amount.toLocaleString()} VND / ${totalMonths} thang`);
  return prepaid;
};

/**
 * Chạy phân bổ hàng tháng cho tất cả khoản còn active
 * Nợ 642 / Có 242
 */
const runMonthlyAllocation = async (year, month, userId) => {
  const prepaids = await prisma.prepaidExpense.findMany({
    where: {
      status: "ACTIVE",
      startDate: { lte: new Date(year, month - 0, 0) },
      endDate: { gte: new Date(year, month - 1, 1) },
      remainingAmount: { gt: 0 },
    },
  });

  const results = [];
  for (const p of prepaids) {
    const alreadyAllocated = await prisma.journalEntry.findFirst({
      where: { source: "PREPAID", sourceId: `prepaid-alloc-${p.id}-${year}-${month}` },
    });
    if (alreadyAllocated) continue;

    const allocAmount = Math.min(p.monthlyAmount, p.remainingAmount);

    await journalService.postEntry({
      date: new Date(year, month - 1, 1),
      description: `Phan bo chi phí tra truoc: ${p.description} (thang ${month}/${year})`,
      source: "PREPAID",
      sourceId: `prepaid-alloc-${p.id}-${year}-${month}`,
      operation: "PRIMARY",
      userId,
      lines: [
        { accountCode: "642", debit: allocAmount, description: `Phan bo ${p.description}` },
        { accountCode: "242", credit: allocAmount, description: `Phan bo ${p.description}` },
      ],
    });

    await prisma.prepaidExpense.update({
      where: { id: p.id },
      data: {
        allocatedMonths: p.allocatedMonths + 1,
        remainingAmount: p.remainingAmount - allocAmount,
        status: p.remainingAmount - allocAmount <= 0 ? "FULLY_ALLOCATED" : "ACTIVE",
      },
    });

    results.push({ id: p.id, description: p.description, amount: allocAmount });
  }

  logger.info(`${LOG} runMonthlyAllocation: ${results.length} prepaids allocated for ${month}/${year}`);
  return results;
};

// ══════════════════════════════════════════════════════
// 3. CIT TÍNH THUẾ TNDN TẠM TÍNH
// ══════════════════════════════════════════════════════

/**
 * Tính thuế TNDN tạm tính quý
 * Lợi nhuận kế toán trước thuế × thuế suất
 */
const calculateCIT = async ({ year, quarter, userId }) => {
  const qStart = (quarter - 1) * 3;
  const from = new Date(year, qStart, 1);
  const to = new Date(year, qStart + 3, 0, 23, 59, 59);

  const acc911 = await prisma.account.findUnique({ where: { code: "911" } });
  if (!acc911) throw new Error("TK 911 not found");

  const balance = await journalService.getAccountBalance(acc911.id, from, to);
  const profitBeforeTax = balance.credit - balance.debit;
  const citRate = Number(process.env.CIT_RATE || 20) / 100;
  const citAmount = Math.round(Math.max(0, profitBeforeTax) * citRate);

  if (citAmount <= 0) return { profitBeforeTax, citAmount: 0, message: "Không phat sinh thue TNDN" };

  // Check if already posted
  const existing = await prisma.journalEntry.findFirst({
    where: { source: "TAX", sourceId: `cit-q${quarter}-${year}` },
  });
  if (existing) return { profitBeforeTax, citAmount, message: "Da tinh thue TNDN quy nay roi" };

  // Post: Nợ 821 / Có 3334
  await journalService.postEntry({
    date: to,
    description: `Thue TNDN tam tinh quy ${quarter}/${year}`,
    source: "TAX",
    sourceId: `cit-q${quarter}-${year}`,
    operation: "PRIMARY",
    userId,
    lines: [
      { accountCode: "821", debit: citAmount, description: `Chi phi thue TNDN quy ${quarter}` },
      { accountCode: "3334", credit: citAmount, description: `Thue TNDN phai nop quy ${quarter}` },
    ],
  });

  logger.info(`${LOG} CIT Q${quarter}/${year}: profit=${profitBeforeTax.toLocaleString()}, CIT=${citAmount.toLocaleString()} VND`);
  return { profitBeforeTax, citAmount };
};

// ══════════════════════════════════════════════════════
// 4. KHẤU HAO TSCĐ HÀNG THÁNG
// ══════════════════════════════════════════════════════

const runMonthlyDepreciation = async (year, month, userId) => {
  const assets = await prisma.fixedAsset.findMany({
    where: { status: "ACTIVE" },
    include: { category: { select: { id: true, depreciationAccountId: true, usefulLifeMonths: true } } },
  });

  const results = [];
  for (const asset of assets) {
    const monthlyDep = Number(asset.monthlyDepreciation || 0);
    if (monthlyDep <= 0) continue;

    const periodKey = `${year}-${String(month).padStart(2, "0")}`;
    const alreadyDone = await prisma.depreciationSchedule.findFirst({
      where: { assetId: asset.id, periodKey },
    });
    if (alreadyDone) continue;

    const deprAccountId = asset.category?.depreciationAccountId;

    await journalService.postEntry({
      date: new Date(year, month - 1, 1),
      description: `Khau hao TSCD: ${asset.name} (thang ${month}/${year})`,
      source: "DEPRECIATION",
      sourceId: `depr-${asset.id}-${periodKey}`,
      operation: "PRIMARY",
      userId,
      lines: [
        { accountCode: "642", debit: monthlyDep, description: `Chi phi khấu hao ${asset.name}` },
        { accountCode: "214", credit: monthlyDep, description: `Hao mon luy ke ${asset.name}` },
      ],
    });

    await prisma.depreciationSchedule.create({
      data: { assetId: asset.id, periodKey, amount: monthlyDep, postedBy: userId },
    });

    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { accumulatedDepreciation: { increment: monthlyDep } },
    });

    results.push({ asset: asset.name, amount: monthlyDep });
  }

  logger.info(`${LOG} monthlyDepreciation: ${results.length} assets, ${month}/${year}`);
  return results;
};

// ══════════════════════════════════════════════════════
// 5. ĐỊNH GIÁ HÀNG TỒN KHO (INVENTORY VALUATION)
// ══════════════════════════════════════════════════════

const inventoryValuation = async (year, month) => {
  const to = new Date(year, month, 0, 23, 59, 59);

  const inventories = await prisma.inventory.findMany({
    where: { quantity: { gt: 0 } },
    include: { product: { select: { id: true, name: true, sku: true, costPrice: true, price: true } } },
  });

  const totalCost = inventories.reduce((s, inv) => s + (inv.quantity * Number(inv.product.costPrice || 0)), 0);
  const totalMarket = inventories.reduce((s, inv) => s + (inv.quantity * Number(inv.product.price || 0)), 0);

  const byCategory = [];
  const catMap = new Map();
  for (const inv of inventories) {
    const cat = inv.product?.name || "Unknown";
    if (!catMap.has(cat)) catMap.set(cat, { qty: 0, cost: 0, market: 0 });
    const entry = catMap.get(cat);
    entry.qty += inv.quantity;
    entry.cost += inv.quantity * Number(inv.product.costPrice || 0);
    entry.market += inv.quantity * Number(inv.product.price || 0);
  }
  catMap.forEach((v, k) => byCategory.push({ name: k, ...v }));

  return {
    date: to,
    totalItems: inventories.length,
    totalQuantity: inventories.reduce((s, i) => s + i.quantity, 0),
    totalCost,
    totalMarket,
    byCategory,
    method: "Weighted Average Cost",
  };
};

// ══════════════════════════════════════════════════════
// 6. MỞ LẠI KỲ (REOPEN — reverse closing entries)
// ══════════════════════════════════════════════════════

const reversePeriodClose = async ({ year, month, userId }) => {
  const closingEntries = await prisma.journalEntry.findMany({
    where: { source: "CLOSING", createdAt: { gte: new Date(year, month - 1, 1) } },
    include: { lines: { include: { account: { select: { code: true } } } } },
  });

  if (!closingEntries.length) {
    throw { status: 400, message: `Thang ${month}/${year} chua duoc kết chuyển` };
  }

  const reversed = [];
  for (const entry of closingEntries) {
    const rev = await journalService.postEntry({
      date: new Date(),
      description: `Dao but toan kết chuyển: ${entry.description}`,
      source: "CLOSING",
      sourceId: `reverse-${entry.id}`,
      operation: "REVERSE_CLOSE",
      userId,
      lines: entry.lines.map((l) => ({
        accountCode: l.account.code,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `Dao kết chuyển ${l.account.code}`,
      })),
    });
    reversed.push(rev);
  }

  logger.info(`${LOG} reversePeriodClose: ${reversed.length} entries reversed for ${month}/${year}`);
  return reversed;
};

module.exports = {
  closeRevenue, closeExpenses, closeProfitLoss, runPeriodClose,
  createPrepaid, runMonthlyAllocation,
  calculateCIT,
  runMonthlyDepreciation,
  inventoryValuation,
  reversePeriodClose,
};
