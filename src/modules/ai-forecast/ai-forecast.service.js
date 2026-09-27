/**
 * modules/ai-forecast/ai-forecast.service.js — Dự báo F&B + đề xuất (USP AI)
 *
 * Xây trên dữ liệu Order lịch sử. Bản đầu dùng thống kê đơn giản
 * (moving average + day-of-week pattern). Phase nâng cao: feed vào LLM agent có sẵn.
 *
 * - forecastHourlyDemand(days) → dự báo số đơn theo giờ cho N ngày tới
 * - menuEngineering() → ma trận Stars/Dogs (doanh số × margin)
 * - getRecommendations() → list AiRecommendation chờ duyệt
 * - decideRecommendation(id, decision) → approve/reject (human-gate)
 */
const prisma = require('../../config/prisma');

// Dự báo giờ cao điểm — đọc 90 ngày gần nhất, gom theo (dayOfWeek, hour)
async function forecastHourlyDemand(forecastDays = 7) {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: since }, status: 'COMPLETED' },
    select: { createdAt: true },
  });

  // Gom theo (dayOfWeek, hour)
  const buckets = {};
  for (const o of orders) {
    const d = new Date(o.createdAt);
    const dow = d.getDay();
    const hr = d.getHours();
    const key = `${dow}_${hr}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  // Trung bình per (dow, hour) = count / số tuần (90 ngày ≈ 12.8 tuần)
  const weeks = 90 / 7;
  const forecast = [];
  for (let day = 0; day < forecastDays; day++) {
    const target = new Date(Date.now() + day * 24 * 3600 * 1000);
    const dow = target.getDay();
    for (let hr = 6; hr <= 23; hr++) {
      const key = `${dow}_${hr}`;
      const avg = (buckets[key] || 0) / weeks;
      forecast.push({ date: target.toISOString().slice(0, 10), dow, hour: hr, predictedOrders: Math.round(avg) });
    }
  }

  // Lưu forecast
  await prisma.aiForecast.create({
    data: {
      type: 'HOURLY_DEMAND',
      targetDate: new Date(),
      horizon: `${forecastDays}_DAY`,
      payload: forecast,
      confidence: orders.length > 100 ? 75 : orders.length > 30 ? 50 : 25,
    },
  });

  return {
    forecast,
    summary: {
      totalHistoricalOrders: orders.length,
      confidence: orders.length > 100 ? 75 : orders.length > 30 ? 50 : 25,
      peakHours: forecast.filter((f) => f.predictedOrders > 5).sort((a, b) => b.predictedOrders - a.predictedOrders).slice(0, 5),
    },
  };
}

// Menu engineering: Stars (cao doanh số + cao margin) / Dogs (thấp cả 2)
async function menuEngineering() {
  // Doanh số 30 ngày per product
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const items = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: { createdAt: { gte: since }, status: 'COMPLETED' } },
    _sum: { subtotal: true, quantity: true },
  });
  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true, costPrice: true },
  });
  const pMap = {}; for (const p of products) pMap[p.id] = p;

  const avgSales = items.length > 0 ? items.reduce((s, i) => s + Number(i._sum.subtotal || 0), 0) / items.length : 0;

  const matrix = items.map((it) => {
    const p = pMap[it.productId];
    if (!p) return null;
    const revenue = Number(it._sum.subtotal || 0);
    const margin = Number(p.price) > 0 ? ((Number(p.price) - Number(p.costPrice)) / Number(p.price)) * 100 : 0;
    const isHighSales = revenue > avgSales;
    const isHighMargin = margin > 30;
    let category;
    if (isHighSales && isHighMargin) category = 'STAR';
    else if (isHighSales && !isHighMargin) category = 'PLOWHORSE';
    else if (!isHighSales && isHighMargin) category = 'PUZZLE';
    else category = 'DOG';
    return { productId: p.id, name: p.name, revenue, margin: Math.round(margin * 10) / 10, category, action: actionFor(category) };
  }).filter(Boolean);

  await prisma.aiForecast.create({
    data: { type: 'MENU_ENGINEERING', targetDate: new Date(), horizon: '30_DAY', payload: matrix, confidence: 70 },
  });

  return { avgSales, items: matrix };
}

function actionFor(cat) {
  return {
    STAR: 'Giữ — bán chạy + lãi cao',
    PLOWHORSE: 'Tăng giá nhẹ — bán tốt nhưng lãi thấp',
    PUZZLE: 'Đẩy marketing — lãi cao nhưng bán chậm',
    DOG: 'Cân nhắc loại bỏ hoặc đổi công thức',
  }[cat];
}

// Đề xuất dynamic pricing (nếu có slot giờ thấp → suggest happy hour)
async function suggestDynamicPricing() {
  const latest = await prisma.aiForecast.findFirst({
    where: { type: 'HOURLY_DEMAND' },
    orderBy: { generatedAt: 'desc' },
  });
  if (!latest) return { suggestion: 'Chưa có dữ liệu dự báo — chạy forecast trước' };
  const forecast = latest.payload;
  const lowSlots = forecast.filter((f) => f.predictedOrders < 2 && f.hour >= 14 && f.hour <= 17);
  if (lowSlots.length === 0) return { suggestion: 'Không có slot thấp — không cần happy hour' };

  const rec = await prisma.aiRecommendation.create({
    data: {
      type: 'DYNAMIC_PRICING',
      payload: { suggestion: `Giờ ${lowSlots[0].hour}h ít khách — chạy happy hour 15%`, slots: lowSlots },
      status: 'PENDING',
    },
  });
  return rec;
}

async function listRecommendations() {
  return prisma.aiRecommendation.findMany({ orderBy: { suggestedAt: 'desc' }, take: 50 });
}

async function decideRecommendation(id, decision, userId) {
  return prisma.aiRecommendation.update({
    where: { id },
    data: { status: decision, decidedAt: new Date(), decidedById: userId },
  });
}

module.exports = {
  forecastHourlyDemand, menuEngineering, suggestDynamicPricing,
  listRecommendations, decideRecommendation,
};
