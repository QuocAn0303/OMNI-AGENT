/**
 * modules/accounting/journal.service.js — Engine sổ nhật ký kế toán (double-entry)
 *
 * Tổng quan:
 * - Đảm bảo mọi bút toán cân bằng (Σ Debit = Σ Credit)
 * - Tạo và post bút toán kép với idempotency qua (source, sourceId, operation)
 * - Hỗ trợ đảo ngược bút toán (reversal) trong transaction
 * - Tự động sinh mã bút toán JE-YYYYMMDD-XXXX với retry khi unique violation
 * - Kiểm tra kỳ kế toán (fiscal period) trước khi post
 * - Cung cấp truy vấn số dư tài khoản và danh sách bút toán
 *
 * Hàm:
 * - generateEntryCode(tx): Sinh mã bút toán JE-YYYYMMDD-XXXX dựa trên số lượng trong ngày
 * - isUniqueConstraintError(err): Kiểm tra lỗi unique constraint (P2002, 23505)
 * - withCodeRetry(generator, fn, maxRetries): Retry fn với mã mới khi gặp unique violation
 * - withUniqueRetry(operation, maxRetries): Retry operation khi gặp unique violation
 * - resolveAccount(codeOrId, tx): Tra cứu tài khoản theo code hoặc UUID
 * - findOpenPeriod(date, tx): Tìm kỳ kế toán OPEN tương ứng với ngày
 * - postEntryOnce(input, tx): Tạo bút toán kép: validate lines, kiểm tra cân bằng, kiểm tra fiscal period, tạo entry + lines
 * - postEntry(input, tx): Wrapper postEntryOnce với retry unique constraint
 * - reverseEntry(entryId, userId, externalTx): Đảo ngược bút toán: swap Nợ/Có, SELECT FOR UPDATE + updateMany chống race
 * - getAccountBalance(accountId, { startDate, endDate }): Tính tổng Nợ/Có và số dư theo normalBalance
 * - listEntries({ page, limit, source, sourceId, accountId, from, to }): Liệt kê bút toán phân trang
 * - getEntryById(id): Lấy chi tiết bút toán kèm lines, createdBy, reversedBy
 */
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Sinh mã bút toán `JE-YYYYMMDD-XXXX`.
 *
 * Dùng SỐ THỨ TỰ LỚN NHẤT trong ngày, KHÔNG dùng `count + 1`.
 * `count + 1` hỏng khi chuỗi có lỗ hổng — mà chuỗi có lỗ hổng là chuyện thường:
 * bút toán bị đảo/xoá, kỳ bị dọn khi chạy lại seed, tenant bị xoá. Khi đó mã mới
 * đâm đúng vào một mã đã tồn tại, `create` ném P2002, và `postEntry` chỉ bắt
 * được va chạm theo `(source, sourceId, operation)` chứ không bắt va chạm `entryCode`
 * ⇒ MỌI bút toán còn lại trong ngày đó đều thất bại.
 * Đã xảy ra thật 2026-10-12 sau khi script dọn dẹp xoá bút toán: 2 GRN không ghi
 * được sổ cái vì lý do này.
 *
 * `MAX(suffix)` đọc đúng số đã dùng gần nhất nên chỉ tăng, không bao giờ lùi.
 *
 * QUAN TRỌNG — đọc KHÔNG qua tenant extension:
 * `JournalEntry.entryCode` có ràng buộc `@unique` TOÀN CỤC, nhưng `findFirst` của
 * extension chỉ thấy dòng của tenant hiện tại. Hai tenant cùng ghi sẽ cùng thấy
 * `max` giống nhau và sinh ra CÙNG một mã ⇒ P2002. Đã xảy ra thật: tenant demo max
 * `JE-20261012-0039` trong khi 18 dòng `tenantId = NULL` đã chiếm `0040..0057`
 * ⇒ mọi bút toán của tenant demo trong ngày đó đều hỏng.
 * Vì vậy đọc bằng raw SQL (raw không bị extension lọc). Đây là bộ đếm ký ứu dụng
 * của hệ thống, không phải dữ liệu nghiệp vụ của tenant, nên đọc toàn cục là đúng.
 */
const generateEntryCode = async (tx = prisma) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `JE-${today}-`;
  // `journalEntry` được map sang bảng `journal_entries` và `entryCode` sang
  // `"entryCode"`. `$queryRaw` (không phải Unsafe) đi qua extension nên vẫn bị lọc
  // theo tenant ⇒ phải dùng `$queryRawUnsafe` cho truy vấn bộ đếm này.
  const rows = await tx.$queryRawUnsafe(
    `SELECT "entryCode" FROM "journal_entries"
      WHERE "entryCode" LIKE $1
      ORDER BY "entryCode" DESC LIMIT 1`,
    `${prefix}%`,
  );
  const lastSeq = rows?.[0]?.entryCode ? Number(String(rows[0].entryCode).slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
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
    operation = "PRIMARY",
    userId = null,
    lines = [],
  } = input;

  if (!description) throw { status: 400, message: "Bút toán phải có mô tả" };
  if (!Array.isArray(lines) || lines.length < 2) {
    throw { status: 400, message: "Bút toán phải có tối thiểu 2 dòng (Nợ/Có)" };
  }

  // Idempotency: nếu đã có bút toán POSTED cùng (source, sourceId, operation)
  // → không tạo nữa, trả về bản cũ. Tránh race condition + retry trùng lặp.
  if (sourceId) {
    const existing = await tx.journalEntry.findFirst({
      where: { source, sourceId, operation, status: "POSTED" },
      include: { lines: { include: { account: true } } },
    });
    if (existing) return existing;
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

  // Check fiscal period:
  //  1. Nếu date nằm trong 1 kỳ → kỳ đó phải đang OPEN
  //  2. Nếu date không thuộc kỳ nào VÀ hệ thống đã có ít nhất 1 kỳ → reject
  //     (ngăn user post lùi/post tới ngày không kế toán)
  //  3. Nếu hệ thống chưa cấu hình kỳ nào → cho phép (early setup phase)
  const period = await findOpenPeriod(date, tx);
  if (period) {
    if (period.status !== "OPEN") {
      throw {
        status: 400,
        message: `Kỳ kế toán ${period.month}/${period.year} đã ${period.status === "CLOSED" ? "đóng" : "khóa"}, không thể ghi sổ`,
      };
    }
  } else {
    const anyPeriod = await tx.fiscalPeriod.findFirst({
      where: { month: { not: 0 } },
      select: { id: true },
    });
    if (anyPeriod) {
      throw {
        status: 400,
        message: `Ngày ${new Date(date).toISOString().slice(0, 10)} không thuộc kỳ kế toán nào đang mở. Vui lòng mở kỳ tương ứng trước khi ghi sổ.`,
      };
    }
  }

  const entryCode = await generateEntryCode(tx);
  try {
    const entry = await tx.journalEntry.create({
      data: {
        entryCode,
        date,
        description,
        source,
        sourceId,
        operation,
        status: "POSTED",
        createdById: userId,
        fiscalPeriodId: period?.id,
        lines: { create: resolvedLines },
      },
      include: { lines: { include: { account: true } } },
    });
    auditService.log({ userId, action: 'POST_JOURNAL_ENTRY', entity: 'JournalEntry', entityId: entry.id, after: { entryCode, source, sourceId, totalDebit } });
    return entry;
  } catch (err) {
    // Race condition: 2 process post cùng (source, sourceId, operation) → P2002
    // Trả về bản cũ thay vì throw.
    if (isUniqueConstraintError(err) && sourceId) {
      const existing = await tx.journalEntry.findFirst({
        where: { source, sourceId, operation, status: "POSTED" },
        include: { lines: { include: { account: true } } },
      });
      if (existing) return existing;
    }
    throw err;
  }
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
    if (period) {
      if (period.status !== "OPEN") {
        throw {
          status: 400,
          message: `Kỳ kế toán ${period.month}/${period.year} đã ${period.status === "CLOSED" ? "đóng" : "khóa"}, không thể đảo bút toán`,
        };
      }
    } else {
      const anyPeriod = await tx.fiscalPeriod.findFirst({
        where: { month: { not: 0 } },
        select: { id: true },
      });
      if (anyPeriod) {
        throw {
          status: 400,
          message: "Ngày hiện tại không thuộc kỳ kế toán nào đang mở. Vui lòng mở kỳ tương ứng trước khi đảo bút toán.",
        };
      }
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
            // operation = REVERSAL + originalId để unique theo từng bút toán đảo
            operation: `REVERSAL:${original.id.slice(0, 8)}`,
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

    auditService.log({ userId, action: 'REVERSE_JOURNAL_ENTRY', entity: 'JournalEntry', entityId: reversal.id, after: { entryCode: reversal.entryCode, originalId: original.id } });
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
  // Xuất ra để test khoá hành vi chống lỗ hổng chuỗi mã (xem chú thích hàm).
  generateEntryCode,
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
