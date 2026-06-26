/**
 * modules/dashboard/dashboard.service.js — Dữ liệu dashboard tổng quan
 * 
 * Tổng quan:
 * - Cung cấp dữ liệu thống kê cho dashboard: doanh thu tháng, doanh thu hôm nay, doanh thu theo khoảng ngày
 * 
 * Hàm:
 * - getMonthRevenue(): Doanh thu + số đơn hàng hoàn thành trong tháng hiện tại
 * - getTodayRevenue(): Doanh thu + số đơn hôm nay (trừ CANCELLED)
 * - getRevenueByRange(from, to): Doanh thu theo ngày trong khoảng thời gian, trả về daily array + summary
 */
const prisma = require('../../config/prisma');

function getLocalDateString(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getMonthRevenue() {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const result = await prisma.order.aggregate({
    where: {
      createdAt: { gte: startOfMonth },
      status: 'COMPLETED',
    },
    _sum: { total: true },
    _count: { id: true },
  });
  return {
    totalRevenue: Number(result._sum.total ?? 0),
    orderCount: result._count.id ?? 0,
  };
}

async function getTodayRevenue() {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const result = await prisma.order.aggregate({
    where: {
      createdAt: { gte: startOfDay },
      status: { not: 'CANCELLED' },
    },
    _sum: { total: true },
    _count: { id: true },
  });
  return {
    totalRevenue: Number(result._sum.total ?? 0),
    orderCount: result._count.id ?? 0,
  };
}

async function getRevenueByRange(from, to) {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      status: 'COMPLETED',
    },
    select: { total: true, createdAt: true },
  });

  const dailyMap = {};
  for (let i = 0; i <= Math.floor((to - from) / 86400000); i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const key = getLocalDateString(d);
    dailyMap[key] = { date: key, revenue: 0, orders: 0 };
  }

  for (const order of orders) {
    const key = getLocalDateString(order.createdAt);
    if (dailyMap[key]) {
      dailyMap[key].revenue += Number(order.total);
      dailyMap[key].orders += 1;
    }
  }

  const daily = Object.values(dailyMap);
  const summary = {
    totalRevenue: daily.reduce((sum, d) => sum + d.revenue, 0),
    totalOrders: daily.reduce((sum, d) => sum + d.orders, 0),
  };
  return { summary, daily };
}

module.exports = { getMonthRevenue, getTodayRevenue, getRevenueByRange };
