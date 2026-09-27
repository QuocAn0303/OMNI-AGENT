/**
 * modules/bank-reco/bank-reco.service.js — Đối soát ngân hàng
 * 
 * Tổng quan:
 * - Import sao kê ngân hàng từ file XLSX (VCB, TCB, BIDV, MB)
 * - Auto-match dòng sao kê với journal entries dựa trên amount, date ±3, fuzzy description
 * - Manual match/unmatch
 * - Tạo bút toán điều chỉnh phí ngân hàng
 * 
 * Hàm:
 * - levenshtein(a, b): Tính khoảng cách Levenshtein cho fuzzy match
 * - importStatement(bankAccountId, buffer, fileName, bank): Import file sao kê, parse theo bank, lưu DB
 * - autoMatch(statementId): Tự động so khớp từng dòng sao kê với journal entries
 * - manualMatch(lineId, entryId): Ghép thủ công một dòng sao kê với journal entry
 * - unmatch(lineId): Huỷ ghép một dòng
 * - createAdjustmentEntry({lineId, bankAccountId, description, amount, userId}): Tạo bút toán điều chỉnh phí NH
 * - listStatements({bankAccountId, page, limit}): Danh sách sao kê, phân trang
 * - getStatementLines(statementId, {page, limit, isMatched}): Lấy dòng sao kê, phân trang, lọc theo trạng thái
 */
// src/modules/bank-reco/bank-reco.service.js
// Đối soát ngân hàng: import sao kê → auto-match → điều chỉnh.
const prisma = require("../../config/prisma");
const ExcelJS = require("exceljs");
const { parseVCB } = require("./importers/vcb.importer");
const { parseTCB } = require("./importers/tcb.importer");
const journalService = require("../accounting/journal.service");
const logger = require('../../utils/logger');

const toNum = (v) => Number(v || 0);

// ======== Levenshtein distance (fuzzy match tên đối tác) ========
const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  dp[0] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

/**
 * Import sao kê ngân hàng từ buffer (XLSX).
 * bank: 'VCB' | 'TCB' | 'MB' | 'BIDV'
 */
const importStatement = async (bankAccountId, buffer, fileName, bank = "VCB") => {
  // Parse XLSX
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw { status: 400, message: "File không có sheet dữ liệu" };

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    rows.push(row.values.slice(1)); // remove index 0
  });

  let lines;
  if (bank === "TCB") {
    lines = parseTCB(rows);
  } else {
    lines = parseVCB(rows); // VCB + BIDV + MB share similar format
  }

  if (!lines.length) throw { status: 400, message: "Không đọc được dòng giao dịch từ file" };

  const fromDate = lines.reduce((min, l) => l.txDate < min ? l.txDate : min, lines[0].txDate);
  const toDate   = lines.reduce((max, l) => l.txDate > max ? l.txDate : max, lines[0].txDate);

  const stmt = await prisma.bankStatement.create({
    data: {
      bankAccountId,
      fileName: fileName || "upload",
      fromDate,
      toDate,
      lineCount: lines.length,
      status: "IMPORTED",
      lines: {
        create: lines.map((l) => ({
          txDate:      l.txDate,
          description: l.description,
          debit:       l.debit,
          credit:      l.credit,
          balance:     l.balance || null,
          reference:   l.reference || null,
        })),
      },
    },
    include: { lines: true },
  });

  return stmt;
};

/**
 * Auto-match: so sánh từng dòng sao kê với journal entries.
 * Tiêu chí: amount khớp chính xác + date ±3 ngày + description fuzzy ≤ 3.
 */
const autoMatch = async (statementId) => {
  const stmt = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { lines: { where: { isMatched: false } } },
  });
  if (!stmt) throw { status: 404, message: "Không tìm thấy sao kê" };

  // B5: lấy 1 lần TRƯỚC vòng lặp — trước đây query account mỗi dòng (N+1)
  const cashAccounts = await prisma.account.findMany({ where: { isCash: true }, select: { id: true } });
  const cashIds = cashAccounts.map((a) => a.id);

  let matched = 0;
  for (const line of stmt.lines) {
    const amount = toNum(line.credit) > 0 ? toNum(line.credit) : toNum(line.debit);
    if (amount <= 0) continue;

    const from = new Date(line.txDate); from.setDate(from.getDate() - 3);
    const to   = new Date(line.txDate); to.setDate(to.getDate() + 3);

    // Tìm journal entries có cash account (isCash=true) + amount khớp + date ±3
    const candidates = await prisma.journalEntry.findMany({
      where: {
        status: "POSTED",
        date: { gte: from, lte: to },
        lines: {
          some: {
            accountId: { in: cashIds },
            OR: [
              { debit: amount },
              { credit: amount },
            ],
          },
        },
      },
      select: { id: true, description: true, date: true },
    });

    // Fuzzy match description
    const descNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const lineDesc = descNorm(line.description);

    let bestEntry = null;
    let bestDist = 999;
    for (const entry of candidates) {
      const entryDesc = descNorm(entry.description);
      const dist = levenshtein(lineDesc.slice(0, 20), entryDesc.slice(0, 20));
      if (dist < bestDist) {
        bestDist = dist;
        bestEntry = entry;
      }
    }

    if (bestEntry && bestDist <= 5) {
      await prisma.bankStatementLine.update({
        where: { id: line.id },
        data: { matchedEntryId: bestEntry.id, isMatched: true },
      });
      matched++;
    }
  }

  // Cập nhật status statement
  const total = await prisma.bankStatementLine.count({ where: { statementId } });
  const matchedCount = await prisma.bankStatementLine.count({ where: { statementId, isMatched: true } });
  if (matchedCount === total) {
    await prisma.bankStatement.update({ where: { id: statementId }, data: { status: "RECONCILED" } });
  }

  return { total, matched, unmatched: total - matchedCount };
};

/**
 * Manual match một line với một journal entry.
 */
const manualMatch = async (lineId, entryId) => {
  const line = await prisma.bankStatementLine.findUnique({ where: { id: lineId } });
  if (!line) throw { status: 404, message: "Không tìm thấy dòng sao kê" };

  return prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { matchedEntryId: entryId, isMatched: true },
  });
};

/**
 * Unmatch một line.
 */
const unmatch = async (lineId) =>
  prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { matchedEntryId: null, isMatched: false },
  });

/**
 * Tạo bút toán điều chỉnh phí ngân hàng (TK 635) cho dòng chưa match.
 * amount: số tiền phí, bankAccountId: tài khoản 112
 */
const createAdjustmentEntry = async ({ lineId, bankAccountId, description, amount, userId }) => {
  const bankAcc = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!bankAcc) throw { status: 404, message: "Không tìm thấy tài khoản ngân hàng" };

  const entry = await journalService.postEntry({
    description: description || "Phí ngân hàng",
    source: "BANK",
    sourceId: lineId,
    operation: "BANK_FEE",
    userId,
    lines: [
      { accountCode: "635", debit: amount, description: "Phí NH" },
      { accountCode: bankAcc.accountId, credit: amount, description: "Trừ tài khoản NH" },
    ],
  });

  await prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { matchedEntryId: entry.id, isMatched: true, isAdjustment: true },
  });

  return entry;
};

const listStatements = async ({ bankAccountId, page = 1, limit = 20 } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = bankAccountId ? { bankAccountId } : {};
  const [items, total] = await Promise.all([
    prisma.bankStatement.findMany({
      where, skip, take: Number(limit),
      orderBy: { importedAt: "desc" },
      include: { bankAccount: { select: { bankName: true, accountNumber: true } } },
    }),
    prisma.bankStatement.count({ where }),
  ]);
  return { items, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } };
};

const getStatementLines = async (statementId, { page = 1, limit = 50, isMatched } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = { statementId };
  if (typeof isMatched === "boolean") where.isMatched = isMatched;
  const [lines, total] = await Promise.all([
    prisma.bankStatementLine.findMany({
      where, skip, take: Number(limit),
      orderBy: { txDate: "asc" },
    }),
    prisma.bankStatementLine.count({ where }),
  ]);
  return { lines, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) } };
};

const autoMatchAll = async () => {
  const statements = await prisma.bankStatement.findMany({
    where: { status: "IMPORTED" },
    orderBy: { importedAt: "desc" },
    take: 5,
  });

  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const stmt of statements) {
    try {
      const result = await autoMatch(stmt.id);
      totalMatched += result.matched;
      totalUnmatched += result.unmatched;
    } catch (e) {
      logger.error(`[bank-reco] autoMatch failed for statement ${stmt.id}:`, e.message);
    }
  }

  if (totalMatched > 0 || totalUnmatched > 0) {
    logger.info(`[bank-reco] autoMatchAll: ${totalMatched} matched, ${totalUnmatched} unmatched across ${statements.length} statements`);
  }

  return { statements: statements.length, matched: totalMatched, unmatched: totalUnmatched };
};

module.exports = {
  importStatement,
  autoMatch,
  autoMatchAll,
  manualMatch,
  unmatch,
  createAdjustmentEntry,
  listStatements,
  getStatementLines,
};
