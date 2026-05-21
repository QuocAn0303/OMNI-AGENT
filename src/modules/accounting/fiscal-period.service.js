// src/modules/accounting/fiscal-period.service.js
const prisma = require("../../config/prisma");

const list = () =>
  prisma.fiscalPeriod.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { closedBy: { select: { id: true, fullName: true } } },
  });

const ensurePeriod = async (year, month) => {
  const existing = await prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return existing;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return prisma.fiscalPeriod.create({
    data: { year, month, startDate: start, endDate: end, status: "OPEN" },
  });
};

const close = async ({ year, month }, userId) => {
  const period = await ensurePeriod(year, month);
  if (period.status !== "OPEN") throw { status: 400, message: "Kỳ này đã đóng/khóa" };
  return prisma.fiscalPeriod.update({
    where: { id: period.id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: userId },
  });
};

const reopen = async ({ year, month }) => {
  const period = await prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month } } });
  if (!period) throw { status: 404, message: "Không tìm thấy kỳ" };
  if (period.status === "LOCKED") throw { status: 400, message: "Kỳ đã bị khóa vĩnh viễn" };
  return prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: "OPEN", closedAt: null, closedById: null } });
};

const lock = async ({ year, month }) => {
  const period = await prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month } } });
  if (!period) throw { status: 404, message: "Không tìm thấy kỳ" };
  return prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
};

module.exports = { list, ensurePeriod, close, reopen, lock };
