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
