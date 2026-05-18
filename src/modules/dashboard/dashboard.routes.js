// src/modules/dashboard/dashboard.routes.js
const router = require("express").Router();
const prisma = require("../../config/prisma");
const { authenticate } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");

router.use(authenticate);

// Helper function: Lấy ngày YYYY-MM-DD theo giờ Local (Tránh lỗi UTC Timezone)
const getLocalDateString = (dateObj) => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ==================== GET /api/dashboard/overview ====================
router.get("/overview", async (req, res, next) => {
  try {
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalProducts,
      totalCustomers,
      todayOrderStats,
      monthRevenue,
      lowStockInventories,
      lowStockCount,
      orderStatusGroups,
      topProductsGroups,
      totalQuantityResult,
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfDay },
          status: { not: "CANCELLED" },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfMonth },
          status: "COMPLETED",
        },
        _sum: { total: true },
      }),
      // Lấy 5 dòng tồn kho thấp nhất (ngưỡng <= 10); join product + category để FE hiển thị tên/SKU/danh mục
      prisma.inventory.findMany({
        where: { quantity: { lte: 10 } },
        include: {
          product: {
            select: {
              name: true,
              sku: true,
              category: { select: { name: true } },
            },
          },
        },
        take: 5,
        orderBy: { quantity: "asc" },
      }),
      prisma.inventory.count({ where: { quantity: { lte: 10 } } }),
      // group by status to get counts per order status
      prisma.order.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      // Get top 3 selling products
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 3,
      }),
      // Get total quantity of all products sold
      prisma.orderItem.aggregate({
        _sum: { quantity: true },
      }),
    ]);

    // build a map of order status counts (ensure all keys exist)
    const orderStatus = {
      PENDING: 0,
      CONFIRMED: 0,
      SHIPPING: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    if (Array.isArray(orderStatusGroups)) {
      for (const g of orderStatusGroups) {
        if (g && g.status) orderStatus[g.status] = Number(g._count?._all ?? 0);
      }
    }

    // Process top products
    const safeTopProductsGroups = topProductsGroups || [];
    
    // We need the names of the top 3 products
    const topProductIds = safeTopProductsGroups.map(g => g.productId);
    const topProductsInfo = await prisma.product.findMany({
      where: { id: { in: topProductIds } },
      select: { id: true, name: true }
    });
    const topProductsMap = {};
    topProductsInfo.forEach(p => topProductsMap[p.id] = p.name);

    const productPerformance = safeTopProductsGroups.map(g => ({
      name: topProductsMap[g.productId] || "Sản phẩm ẩn",
      value: g._sum.quantity || 0,
    }));

    const totalQuantity = totalQuantityResult?._sum?.quantity || 0;
    const top3Quantity = productPerformance.reduce((sum, item) => sum + item.value, 0);
    const otherQuantity = totalQuantity - top3Quantity;

    if (otherQuantity > 0) {
      productPerformance.push({ name: "Khác", value: otherQuantity });
    } else if (productPerformance.length === 0) {
      productPerformance.push({ name: "Chưa có dữ liệu", value: 1 });
    }

    const lowStockProducts = (lowStockInventories || []).map((inv) => ({
      id: inv.id,
      name: inv.product?.name ?? "—",
      sku: inv.product?.sku ?? "",
      categoryName: inv.product?.category?.name ?? null,
      quantity: inv.quantity,
      minStock: inv.minStock,
    }));

    success(res, {
      totalProducts,
      totalCustomers,
      todayOrders: todayOrderStats._count.id ?? 0,
      todayRevenue: Number(todayOrderStats._sum.total ?? 0),
      monthRevenue: Number(monthRevenue._sum.total ?? 0),
      lowStockCount: Number(lowStockCount ?? 0),
      lowStockProducts,
      orderStatus,
      productPerformance,
    });
  } catch (err) {
    next(err);
  }
});

// ==================== GET /api/dashboard/revenue ====================
router.get("/revenue", async (req, res, next) => {
  try {
    const today = new Date();
    // Lùi về 6 ngày trước (tổng là 7 ngày tính cả hôm nay)
    const sevenDaysAgo = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 6,
    );

    // Dùng 1 Query duy nhất lấy toàn bộ đơn hàng trong 7 ngày
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        status: "COMPLETED",
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    // Tạo sẵn 7 slot ngày (để những ngày không có đơn vẫn hiện $0 trên biểu đồ)
    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - i,
      );
      const key = getLocalDateString(d); // 👈 Sử dụng hàm Local Date
      dailyMap[key] = { date: key, revenue: 0, orders: 0 };
    }

    // Gán từng đơn hàng vào đúng ngày
    for (const order of orders) {
      const key = getLocalDateString(order.createdAt); // 👈 Sử dụng hàm Local Date
      if (dailyMap[key]) {
        dailyMap[key].revenue += Number(order.total);
        dailyMap[key].orders += 1;
      }
    }

    const result = Object.values(dailyMap);

    const summary = {
      totalRevenue: result.reduce((sum, d) => sum + d.revenue, 0),
      totalOrders: result.reduce((sum, d) => sum + d.orders, 0),
    };

    success(res, { summary, daily: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
