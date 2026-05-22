// src/modules/currency/currency.service.js
const prisma = require("../../config/prisma");

const listCurrencies = () =>
  prisma.currency.findMany({ orderBy: [{ isBase: "desc" }, { code: "asc" }] });

const getCurrency = (code) =>
  prisma.currency.findUnique({ where: { code } });

const upsertCurrency = async ({ code, name, symbol, isActive = true }) => {
  return prisma.currency.upsert({
    where: { code },
    create: { code, name, symbol, isActive },
    update: { name, symbol, isActive },
  });
};

const getTodayRate = async (code) => {
  if (code === "VND") return 1;
  const cur = await prisma.currency.findUnique({ where: { code } });
  if (!cur) throw { status: 404, message: `Không tìm thấy tiền tệ ${code}` };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Try today first, then the most recent past rate
  const rate = await prisma.exchangeRate.findFirst({
    where: { currencyId: cur.id },
    orderBy: { date: "desc" },
  });
  return rate ? Number(rate.rate) : null;
};

const getRateHistory = async (code, { limit = 30 } = {}) => {
  const cur = await prisma.currency.findUnique({ where: { code } });
  if (!cur) throw { status: 404, message: `Không tìm thấy tiền tệ ${code}` };
  return prisma.exchangeRate.findMany({
    where: { currencyId: cur.id },
    orderBy: { date: "desc" },
    take: Number(limit),
    select: { id: true, date: true, rate: true, source: true, createdAt: true },
  });
};

const setRate = async (code, { date, rate, source = "MANUAL" }) => {
  if (!date || !rate) throw { status: 400, message: "Cần date và rate" };
  const cur = await prisma.currency.findUnique({ where: { code } });
  if (!cur) throw { status: 404, message: `Không tìm thấy tiền tệ ${code}` };

  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  return prisma.exchangeRate.upsert({
    where: { currencyId_date: { currencyId: cur.id, date: d } },
    create: { currencyId: cur.id, date: d, rate: Number(rate), source },
    update: { rate: Number(rate), source },
  });
};

const getAllCurrentRates = async () => {
  const currencies = await prisma.currency.findMany({
    where: { isActive: true },
    orderBy: [{ isBase: "desc" }, { code: "asc" }],
  });

  const result = [];
  for (const cur of currencies) {
    const rate = await prisma.exchangeRate.findFirst({
      where: { currencyId: cur.id },
      orderBy: { date: "desc" },
      select: { rate: true, date: true, source: true },
    });
    result.push({
      id: cur.id,
      code: cur.code,
      name: cur.name,
      symbol: cur.symbol,
      isBase: cur.isBase,
      isActive: cur.isActive,
      currentRate: cur.isBase ? 1 : (rate ? Number(rate.rate) : null),
      rateDate: rate?.date ?? null,
      rateSource: rate?.source ?? null,
    });
  }
  return result;
};

// Convert an amount in `fromCode` to VND
const toVnd = async (amount, fromCode) => {
  if (fromCode === "VND") return Number(amount);
  const rate = await getTodayRate(fromCode);
  if (!rate) throw { status: 400, message: `Chưa có tỷ giá cho ${fromCode}` };
  return Math.round(Number(amount) * rate);
};

module.exports = {
  listCurrencies,
  getCurrency,
  upsertCurrency,
  getTodayRate,
  getRateHistory,
  setRate,
  getAllCurrentRates,
  toVnd,
};
