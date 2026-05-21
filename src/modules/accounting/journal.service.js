// src/modules/accounting/journal.service.js
// Engine sổ nhật ký - đảm bảo mọi entry cân bằng (Σ Debit = Σ Credit)
const prisma = require("../../config/prisma");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const generateEntryCode = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await tx.journalEntry.count({
    where: { createdAt: { gte: start } },
  });
  return `JE-${today}-${String(count + 1).padStart(4, "0")}`;
};

// Helper: thực thi `fn(code)` với mã được sinh, retry khi gặp unique violation P2002.
// Tránh race condition khi 2 request cùng đẩy count + 1.
const isUniqueConstraintError = (err) =>
  err?.code === "P2002" ||
  err?.cause?.code === "23505" ||
  /unique constraint/i.test(err?.message || "");

const waitBeforeRetry = () => new Promise((r) => setTimeout(r, 5 + Math.random() * 25));

const withCodeRetry = async (generator, fn, maxRetries = 5) => {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    const code = await generator();
    try {
      return await fn(code);
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      lastErr = err;
      await waitBeforeRetry();
    }
  }
  throw lastErr;
};

const withUniqueRetry = async (operation, maxRetries = 5) => {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      lastErr = err;
      await waitBeforeRetry();
    }
  }
  throw lastErr;
};

// Resolve account by code (cached per-call)
const resolveAccount = async (codeOrId, tx) => {
  // try by id (uuid)
  if (typeof codeOrId === "string" && codeOrId.length === 36) {
    const byId = await tx.account.findUnique({ where: { id: codeOrId } });
    if (byId) return byId;
  }
  const byCode = await tx.account.findUnique({ where: { code: String(codeOrId) } });
  if (!byCode) {
    throw {
      status: 500,
      message: `Không tìm thấy tài khoản kế toán '${codeOrId}'. Vui lòng chạy seed_accounting.`,
    };
  }
  return byCode;
};

const findOpenPeriod = async (date, tx) => {
  const d = new Date(date);
  return tx.fiscalPeriod.findFirst({
    where: {
      startDate: { lte: d },
      endDate: { gte: d },
      month: { not: 0 },
    },
  });
};

/**
 * Tạo và post một bút toán kép (auto-balanced).
 *
 * @param {Object} input
 * @param {Date|string} [input.date]
 * @param {string} input.description
 * @param {string} [input.source] - JournalSource enum
 * @param {string} [input.sourceId]
 * @param {string} [input.userId]
 * @param {Array<{accountCode|accountId, debit?, credit?, description?, partyType?, partyId?}>} input.lines
 * @param {Object} [tx] - prisma transaction client
 */
const postEntryOnce = async (input, tx = prisma) => {
  const {
    date = new Date(),
    description,
    source = "MANUAL",
    sourceId = null,
    userId = null,
    lines = [],
  } = input;

  if (!description) throw { status: 400, message: "Bút toán phải có mô tả" };
  if (!Array.isArray(lines) || lines.length < 2) {
    throw { status: 400, message: "Bút toán phải có tối thiểu 2 dòng (Nợ/Có)" };
  }

  // Resolve accounts & validate
  const resolvedLines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    const debit = round2(toNum(line.debit));
    const credit = round2(toNum(line.credit));
    if (debit < 0 || credit < 0) {
      throw { status: 400, message: "Số tiền Nợ/Có không được âm" };
    }
    if (debit > 0 && credit > 0) {
      throw { status: 400, message: "Một dòng không thể vừa Nợ vừa Có" };
    }
    if (debit === 0 && credit === 0) continue; // skip empty line

    const accountKey = line.accountCode || line.accountId;
    const account = await resolveAccount(accountKey, tx);

    resolvedLines.push({
      accountId: account.id,
      debit,
      credit,
      description: line.description || null,
      partyType: line.partyType || null,
      partyId: line.partyId || null,
    });
    totalDebit += debit;
    totalCredit += credit;
  }

  if (resolvedLines.length < 2) {
    throw { status: 400, message: "Sau khi loại dòng rỗng, bút toán không đủ 2 dòng" };
  }

  // Balance check (rounded)
  if (round2(totalDebit) !== round2(totalCredit)) {
    throw {
      status: 400,
      message: `Bút toán không cân bằng: Nợ=${totalDebit}, Có=${totalCredit}`,
    };
  }
  if (totalDebit === 0) {
    throw { status: 400, message: "Bút toán có tổng = 0, không hợp lệ" };
  }

  // Check fiscal period closed
  const period = await findOpenPeriod(date, tx);
  if (period && period.status !== "OPEN") {
    throw {
      status: 400,
      message: `Kỳ kế toán ${period.month}/${period.year} đã ${period.status === "CLOSED" ? "đóng" : "khóa"}, không thể ghi sổ`,
    };
  }

  const entryCode = await generateEntryCode(tx);
  const entry = await tx.journalEntry.create({
    data: {
      entryCode,
      date,
      description,
      source,
      sourceId,
      status: "POSTED",
      createdById: userId,
      fiscalPeriodId: period?.id,
      lines: { create: resolvedLines },
    },
    include: { lines: { include: { account: true } } },
  });

  return entry;
};

const postEntry = (input, tx = prisma) => {
  if (tx !== prisma) return postEntryOnce(input, tx);
  return withUniqueRetry(() => postEntryOnce(input, prisma));
};

/**
 * Đảo ngược một bút toán (tạo bút toán mới với Nợ/Có hoán đổi).
 * Toàn bộ thực hiện trong một $transaction:
 *  - re-check status để chống đảo trùng (concurrent)
 *  - kiểm tra kỳ kế toán đang OPEN cho ngày đảo
 *  - retry mã trùng
 */
const reverseEntry = async (entryId, userId = null, externalTx = null) => {
  const exec = async (tx) => {
    // SELECT ... FOR UPDATE để lock row trong transaction
    const original = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: true },
    });
    if (!original) throw { status: 404, message: "Không tìm thấy bút toán" };
    if (original.status !== "POSTED") {
      throw { status: 400, message: "Chỉ có thể đảo bút toán đang POSTED" };
    }

    // Check fiscal period đang OPEN cho ngày đảo
    const reversalDate = new Date();
    const period = await findOpenPeriod(reversalDate, tx);
    if (period && period.status !== "OPEN") {
      throw {
        status: 400,
        message: `Kỳ kế toán ${period.month}/${period.year} đã ${period.status === "CLOSED" ? "đóng" : "khóa"}, không thể đảo bút toán`,
      };
    }

    const reversedLines = original.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      description: `Đảo: ${l.description || ""}`,
      partyType: l.partyType,
      partyId: l.partyId,
    }));

    const entryCode = await generateEntryCode(tx);
    const reversal = await tx.journalEntry.create({
          data: {
            entryCode,
            date: reversalDate,
            description: `[ĐẢO] ${original.description}`,
            source: original.source,
            sourceId: original.sourceId,
            status: "POSTED",
            reversedById: original.id,
            createdById: userId,
            fiscalPeriodId: period?.id,
            lines: { create: reversedLines },
          },
    });

    // updateMany với điều kiện status='POSTED' để đảm bảo idempotent
    // (nếu có request đảo song song, chỉ 1 cái thành công)
    const updated = await tx.journalEntry.updateMany({
      where: { id: original.id, status: "POSTED" },
      data: { status: "REVERSED" },
    });
    if (updated.count === 0) {
      // race: ai đó đã đảo trước rồi -> rollback
      throw { status: 409, message: "Bút toán đã bị đảo bởi tiến trình khác" };
    }

    return reversal;
  };

  if (externalTx) return exec(externalTx);
  return withUniqueRetry(() => prisma.$transaction(exec));
};

/**
 * Tính số dư tài khoản đến một ngày (hoặc toàn bộ).
 * Trả về { debit, credit, balance } (balance theo normalBalance).
 */
const getAccountBalance = async (accountId, { startDate, endDate } = {}) => {
  const where = { accountId };
  if (startDate || endDate) {
    where.entry = {};
    if (startDate) where.entry.date = { ...where.entry.date, gte: new Date(startDate) };
    if (endDate) where.entry.date = { ...where.entry.date, lte: new Date(endDate) };
    where.entry.status = "POSTED";
  } else {
    where.entry = { status: "POSTED" };
  }

  const lines = await prisma.journalLine.findMany({
    where,
    select: { debit: true, credit: true, account: { select: { normalBalance: true } } },
  });

  let totalDebit = 0;
  let totalCredit = 0;
  let normalBalance = "DEBIT";
  for (const l of lines) {
    totalDebit += toNum(l.debit);
    totalCredit += toNum(l.credit);
    normalBalance = l.account.normalBalance;
  }
  const balance = normalBalance === "DEBIT" ? totalDebit - totalCredit : totalCredit - totalDebit;
  return {
    debit: round2(totalDebit),
    credit: round2(totalCredit),
    balance: round2(balance),
  };
};

const listEntries = async ({ page = 1, limit = 50, source, sourceId, accountId, from, to } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = { status: "POSTED" };
  if (source) where.source = source;
  if (sourceId) where.sourceId = sourceId;
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  if (accountId) {
    where.lines = { some: { accountId } };
  }

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { date: "desc" },
      include: {
        lines: { include: { account: { select: { code: true, name: true, nameVi: true, normalBalance: true } } } },
        createdBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.journalEntry.count({ where }),
  ]);

  return {
    entries,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  };
};

const getEntryById = async (id) => {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      lines: { include: { account: true } },
      createdBy: { select: { id: true, fullName: true } },
      reversedBy: true,
    },
  });
  if (!entry) throw { status: 404, message: "Không tìm thấy bút toán" };
  return entry;
};

module.exports = {
  postEntry,
  reverseEntry,
  getAccountBalance,
  listEntries,
  getEntryById,
  resolveAccount,
  withCodeRetry,
  withUniqueRetry,
  isUniqueConstraintError,
};
