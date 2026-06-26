/**
 * modules/currency/currency.service.js — Quản lý tiền tệ & tỷ giá
 * 
 * Tổng quan:
 * - CRUD danh sách tiền tệ
 * - Quản lý tỷ giá hối đoái theo ngày
 * - Tự động lấy tỷ giá mới nhất
 * - Quy đổi từ ngoại tệ sang VND
 * 
 * Hàm:
 * - listCurrencies(): Danh sách tất cả tiền tệ, ưu tiên base currency
 * - getCurrency(code): Lấy thông tin một loại tiền tệ
 * - upsertCurrency({code, name, symbol, isActive}): Tạo hoặc cập nhật tiền tệ
 * - getTodayRate(code): Lấy tỷ giá hôm nay hoặc tỷ giá mới nhất
 * - getRateHistory(code, {limit}): Lịch sử tỷ giá của một loại tiền
 * - setRate(code, {date, rate, source}): Thiết lập tỷ giá cho một ngày (upsert)
 * - getAllCurrentRates(): Lấy tất cả tiền tệ kèm tỷ giá hiện tại
 * - toVnd(amount, fromCode): Quy đổi số tiền từ ngoại tệ sang VND
 */
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

const fetchRatesFromAPI = async () => {
  try {
    const https = require('https');
    const url = 'https://api.exchangerate-api.com/v4/latest/USD';
    const body = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const json = JSON.parse(body);
    if (!json.rates) throw new Error('Invalid API response');
    const usdToVnd = Number(json.rates.VND);
    if (!usdToVnd) throw new Error('VND rate not found');
    const targets = { USD: 1, EUR: null, JPY: null, CNY: null, KRW: null };
    for (const code of Object.keys(targets)) {
      if (code === 'USD') { targets[code] = usdToVnd; continue; }
      const usdToTarget = Number(json.rates[code]);
      targets[code] = usdToTarget ? Math.round(usdToVnd / usdToTarget) : null;
    }
    const currencies = await prisma.currency.findMany({ where: { isBase: false } });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const cur of currencies) {
      const rate = targets[cur.code];
      if (!rate) continue;
      const existing = await prisma.exchangeRate.findFirst({
        where: { currencyId: cur.id, date: today },
      });
      if (!existing) {
        await prisma.exchangeRate.create({
          data: { currencyId: cur.id, date: today, rate, source: 'AUTO' },
        });
      }
    }
    return Object.keys(targets).filter((c) => targets[c]).length;
  } catch (e) {
    console.error('[currency] fetchRatesFromAPI error:', e.message);
    return 0;
  }
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
  fetchRatesFromAPI,
};
