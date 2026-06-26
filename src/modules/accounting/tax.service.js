/**
 * modules/accounting/tax.service.js — Service quản lý thuế
 * 
 * Tổng quan:
 * - Quản lý danh sách thuế suất (TaxRate) và báo cáo VAT.
 * - Báo cáo VAT tính: VAT đầu ra (TK 3331) - VAT đầu vào (TK 1331) = thuế phải nộp.
 * 
 * Hàm:
 * - list(): Danh sách thuế suất đang hoạt động (isActive).
 * - create(data): Tạo thuế suất mới.
 * - update(id, data): Cập nhật thuế suất.
 * - remove(id): Vô hiệu hóa thuế suất (soft delete).
 * - vatReport({from, to}): Báo cáo VAT trong kỳ: tổng hợp số phát sinh TK 3331 và 1331,
 *   tính VAT phải nộp (hoặc được khấu trừ kỳ sau).
 */
// src/modules/accounting/tax.service.js
const prisma = require("../../config/prisma");

const toNum = (v) => Number(v || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const list = () =>
  prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { rate: "asc" } });

const create = (data) => prisma.taxRate.create({ data });
const update = (id, data) => prisma.taxRate.update({ where: { id }, data });
const remove = (id) => prisma.taxRate.update({ where: { id }, data: { isActive: false } });

/**
 * Báo cáo VAT: tổng VAT đầu ra (3331) - VAT đầu vào (1331) = thuế phải nộp.
 * Lấy số phát sinh trong kỳ.
 */
const vatReport = async ({ from, to } = {}) => {
  const dateFilter = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) dateFilter.lte = new Date(to);

  const [out, inp] = await Promise.all([
    prisma.account.findUnique({ where: { code: "3331" } }),
    prisma.account.findUnique({ where: { code: "1331" } }),
  ]);
  if (!out || !inp) throw { status: 500, message: "Chưa seed Chart of Accounts" };

  const linesOut = await prisma.journalLine.findMany({
    where: { accountId: out.id, entry: { status: "POSTED", ...(from || to ? { date: dateFilter } : {}) } },
    select: { debit: true, credit: true },
  });
  const linesIn = await prisma.journalLine.findMany({
    where: { accountId: inp.id, entry: { status: "POSTED", ...(from || to ? { date: dateFilter } : {}) } },
    select: { debit: true, credit: true },
  });

  const vatOut = round2(linesOut.reduce((s, l) => s + toNum(l.credit) - toNum(l.debit), 0));
  const vatIn = round2(linesIn.reduce((s, l) => s + toNum(l.debit) - toNum(l.credit), 0));
  const payable = round2(vatOut - vatIn);

  return {
    period: { from, to },
    vatOutput: vatOut,
    vatInput: vatIn,
    payable,
    note:
      payable > 0
        ? `Phải nộp ${payable.toLocaleString("vi-VN")}đ thuế VAT`
        : `Được khấu trừ tiếp ${Math.abs(payable).toLocaleString("vi-VN")}đ kỳ sau`,
  };
};

module.exports = { list, create, update, remove, vatReport };
