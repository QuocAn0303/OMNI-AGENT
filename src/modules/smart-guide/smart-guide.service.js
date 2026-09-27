/**
 * Smart Guide Service — Hướng dẫn nghiệp vụ thông minh cho chủ doanh nghiệp
 *
 * Cung cấp:
 * - Gợi ý giá bán dựa trên costPrice + margin mong muốn
 * - Cảnh báo sản phẩm bán dưới giá vốn
 * - Gợi ý nhập hàng thông minh (tồn thấp + vendor + lead time)
 * - Điểm sức khỏe doanh nghiệp (0-100)
 * - Báo cáo đơn giản bằng ngôn ngữ tự nhiên
 *
 * Lưu ý multi-tenant:
 * - Các business model (Product, Inventory, Order, Customer, BankAccount, Expense, Debt)
 *   HIỆN KHÔNG có field `tenantId` trong schema (chỉ User/Tenant có).
 * - Do đó `tenantId` param được giữ ở signature cho forward-compat (khi nào thêm field)
 *   nhưng KHÔNG được dùng trong where clause — nếu dùng sẽ throw "Unknown argument".
 * - Khi nào bổ sung `tenantId` cho business model (migration lớn), mở lại filter tại đây.
 */

const prisma = require('../../config/prisma');

// ==================== PRICING INSIGHTS ====================

/**
 * Get pricing insights for all active products
 * Returns suggested price, margin %, and warnings
 */
async function getPricingInsights(tenantId) {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      category: true,
      inventories: { include: { warehouse: true } },
    },
    orderBy: { price: 'asc' },
  });

  // Get average margin per category
  const categoryMargins = {};
  for (const p of products) {
    if (!p.categoryId) continue;
    if (!categoryMargins[p.categoryId]) {
      categoryMargins[p.categoryId] = { total: 0, count: 0 };
    }
    if (p.costPrice > 0 && p.price > 0) {
      const margin = ((Number(p.price) - Number(p.costPrice)) / Number(p.price)) * 100;
      categoryMargins[p.categoryId].total += margin;
      categoryMargins[p.categoryId].count++;
    }
  }

  const defaultMarkup = 1.5; // 50% markup default

  const insights = products.map((p) => {
    const costPrice = Number(p.costPrice || 0);
    const price = Number(p.price || 0);
    const catAvgMargin = p.categoryId && categoryMargins[p.categoryId]
      ? categoryMargins[p.categoryId].total / Math.max(categoryMargins[p.categoryId].count, 1)
      : null;

    const margin = costPrice > 0 && price > 0
      ? ((price - costPrice) / price) * 100
      : null;

    const suggestedMarkup = catAvgMargin
      ? 1 + (catAvgMargin / 100)
      : defaultMarkup;
    const suggestedPrice = costPrice > 0
      ? Math.round(costPrice * suggestedMarkup / 1000) * 1000
      : null;

    const warnings = [];
    if (costPrice > 0 && price > 0 && price < costPrice) {
      warnings.push({
        type: 'BELOW_COST',
        message: `Bán dưới giá vốn ${formatMoney(costPrice - price)} — bạn đang lỗ mỗi lần bán!`,
        severity: 'HIGH',
      });
    } else if (margin !== null && margin < 15) {
      warnings.push({
        type: 'LOW_MARGIN',
        message: `Lãi chỉ ${round1(margin)}% — cân nhắc tăng giá hoặc tìm nguồn hàng rẻ hơn.`,
        severity: margin < 5 ? 'HIGH' : 'MEDIUM',
      });
    }
    if (costPrice === 0) {
      warnings.push({
        type: 'NO_COST',
        message: 'Chưa nhập giá vốn — không thể tính lợi nhuận.',
        severity: 'MEDIUM',
      });
    }

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category?.name || null,
      costPrice,
      price,
      marginPercent: margin !== null ? round1(margin) : null,
      suggestedPrice,
      categoryAvgMargin: catAvgMargin !== null ? round1(catAvgMargin) : null,
      warnings,
    };
  });

  const belowCostCount = insights.filter((i) => i.warnings.some((w) => w.type === 'BELOW_COST')).length;
  const lowMarginCount = insights.filter((i) => i.warnings.some((w) => w.type === 'LOW_MARGIN')).length;
  const noCostCount = insights.filter((i) => i.warnings.some((w) => w.type === 'NO_COST')).length;

  return {
    products: insights,
    summary: {
      total: products.length,
      belowCostCount,
      lowMarginCount,
      noCostCount,
      healthLabel: belowCostCount > 0
        ? `Có ${belowCostCount} sản phẩm đang bán dưới giá vốn — cần xem lại ngay!`
        : lowMarginCount > 3
          ? `${lowMarginCount} sản phẩm có lãi thấp — cân nhắc điều chỉnh`
          : 'Tất cả sản phẩm có lợi nhuận tốt. Bạn đang làm rất tốt!',
    },
  };
}

// ==================== REORDER SUGGESTIONS ====================

/**
 * Get smart reorder suggestions with vendor info and priority
 */
async function getReorderSuggestions(tenantId) {
  const lowStock = await prisma.inventory.findMany({
    where: {
      quantity: { lte: prisma.inventory.fields?.minStock ? undefined : 10 },
    },
    include: {
      product: {
        include: { category: true },
      },
      warehouse: true,
    },
  });

  // Filter in JS since Prisma can't compare field-to-field directly
  const filtered = lowStock.filter((inv) => inv.quantity <= (inv.minStock || 10));

  // Get sold quantities in last 30 days for velocity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const productIds = filtered.map((f) => f.productId);

  const salesVelocity = {};
  if (productIds.length > 0) {
    const orderItems = await prisma.orderItem.findMany({
      where: {
        productId: { in: productIds },
        order: { createdAt: { gte: thirtyDaysAgo }, status: 'COMPLETED' },
      },
      select: { productId: true, quantity: true },
    });

    for (const oi of orderItems) {
      if (!salesVelocity[oi.productId]) salesVelocity[oi.productId] = 0;
      salesVelocity[oi.productId] += oi.quantity;
    }
  }

  // Get last vendor for each product
  const lastVendors = {};
  if (productIds.length > 0) {
    const lastPos = await prisma.purchaseItem.findMany({
      where: { productId: { in: productIds } },
      include: {
        purchaseOrder: { select: { vendor: { select: { id: true, name: true } }, createdAt: true } },
      },
      orderBy: { purchaseOrder: { createdAt: 'desc' } },
    });

    const seen = new Set();
    for (const pi of lastPos) {
      if (!seen.has(pi.productId)) {
        seen.add(pi.productId);
        lastVendors[pi.productId] = pi.purchaseOrder?.vendor || null;
      }
    }
  }

  const suggestions = filtered.map((inv) => {
    const safetyStock = inv.minStock || 10;
    const weeklySales = (salesVelocity[inv.productId] || 0) / 4.3;
    const weeksUntilEmpty = weeklySales > 0 ? inv.quantity / weeklySales : Infinity;
    const vendor = lastVendors[inv.productId];

    let priority;
    if (inv.quantity === 0) priority = 'URGENT';
    else if (inv.quantity <= safetyStock / 3) priority = 'HIGH';
    else if (inv.quantity <= safetyStock / 2) priority = 'MEDIUM';
    else priority = 'LOW';

    let message;
    if (inv.quantity === 0) {
      message = `HẾT HÀNG! Cần nhập gấp — đã hết từ ${inv.product.name}.`;
    } else if (weeksUntilEmpty < 1) {
      message = `Chỉ còn ${inv.quantity} ${inv.product.unit || 'cái'} — dùng chưa tới 1 tuần.`;
    } else {
      message = `Còn ${inv.quantity}/${safetyStock} ${inv.product.unit || 'cái'} — nên nhập thêm sớm.`;
    }

    const reorderQty = Math.max(1, Math.ceil((safetyStock * 2 - inv.quantity) * 1.2));

    return {
      productId: inv.productId,
      productName: inv.product.name,
      sku: inv.product.sku,
      category: inv.product.category?.name || null,
      warehouse: inv.warehouse?.name || null,
      currentStock: inv.quantity,
      minStock: safetyStock,
      weeklySales: round1(weeklySales),
      weeksUntilEmpty: weeksUntilEmpty === Infinity ? null : round1(weeksUntilEmpty),
      suggestedReorderQty: reorderQty,
      suggestedVendor: vendor ? { id: vendor.id, name: vendor.name } : null,
      priority,
      message,
    };
  });

  // Sort: URGENT > HIGH > MEDIUM > LOW
  const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    suggestions,
    summary: {
      total: suggestions.length,
      urgentCount: suggestions.filter((s) => s.priority === 'URGENT').length,
      highCount: suggestions.filter((s) => s.priority === 'HIGH').length,
      noVendorCount: suggestions.filter((s) => !s.suggestedVendor).length,
    },
  };
}

// ==================== BUSINESS HEALTH SCORE ====================

/**
 * Calculate business health score (0-100)
 * Components:
 * - Cash health (30%): bank+cash balance, runway
 * - Profitability (25%): gross margin, operating profit
 * - Growth (20%): revenue growth vs last month
 * - Debt risk (15%): AR/AP ratio, overdue ratio
 * - Inventory health (10%): stockout risk, dead stock
 */
async function getBusinessHealth(tenantId) {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // --- Cash Health (30%) ---
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
  });
  const totalBank = bankAccounts.reduce((sum, b) => sum + Number(b.currentBalance || 0), 0);

  let cashScore = 50;
  if (totalBank > 100000000) cashScore = 90;
  else if (totalBank > 50000000) cashScore = 80;
  else if (totalBank > 10000000) cashScore = 65;
  else if (totalBank > 0) cashScore = 40;
  else cashScore = 15;

  // --- Profitability (25%) ---
  const thisMonthRevenue = await prisma.order.aggregate({
    where: { createdAt: { gte: thisMonth }, status: 'COMPLETED' },
    _sum: { total: true },
  });
  const thisMonthExpenses = await prisma.expense.aggregate({
    where: { date: { gte: thisMonth }, status: 'PAID' },
    _sum: { totalAmount: true },
  });

  const revenue = Number(thisMonthRevenue._sum.total || 0);
  const expenses = Number(thisMonthExpenses._sum.totalAmount || 0);
  const profit = revenue - expenses;
  const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

  let profitScore = 50;
  if (marginPercent > 25) profitScore = 90;
  else if (marginPercent > 15) profitScore = 80;
  else if (marginPercent > 8) profitScore = 65;
  else if (marginPercent > 0) profitScore = 45;
  else profitScore = 15;

  // --- Growth (20%) ---
  const lastMonthRevenue = await prisma.order.aggregate({
    where: {
      createdAt: { gte: lastMonth, lt: thisMonth },
      status: 'COMPLETED',
    },
    _sum: { total: true },
  });
  const lmRev = Number(lastMonthRevenue._sum.total || 0);
  const growth = lmRev > 0 ? ((revenue - lmRev) / lmRev) * 100 : revenue > 0 ? 100 : 0;

  let growthScore = 50;
  if (growth > 20) growthScore = 85;
  else if (growth > 5) growthScore = 70;
  else if (growth > -5) growthScore = 55;
  else if (growth > -20) growthScore = 35;
  else growthScore = 15;

  // --- Debt Risk (15%) ---
  const totalAR = await prisma.debt.aggregate({
    where: { type: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIAL'] } },
    _sum: { amount: true },
  });
  const overdueAR = await prisma.debt.aggregate({
    where: { type: 'RECEIVABLE', status: 'OVERDUE' },
    _sum: { amount: true },
  });

  const arTotal = Number(totalAR._sum.amount || 0);
  const arOverdue = Number(overdueAR._sum.amount || 0);
  const overdueRatio = arTotal > 0 ? (arOverdue / arTotal) * 100 : 0;

  let debtScore = 70;
  if (overdueRatio > 30) debtScore = 25;
  else if (overdueRatio > 10) debtScore = 45;
  else if (overdueRatio > 0) debtScore = 60;
  else if (arTotal === 0) debtScore = 80;

  // --- Inventory Health (10%) ---
  const totalInv = await prisma.inventory.count();
  const lowStockInv = await prisma.inventory.count({
    where: { quantity: { lte: prisma.inventory.fields?.minStock ? undefined : 10 } },
  });
  const deadStock = await prisma.inventory.findMany({
    where: { quantity: { gt: 0 } },
    include: { product: true },
  });

  let deadStockCount = 0;
  for (const inv of deadStock) {
    const orders = await prisma.orderItem.count({
      where: {
        productId: inv.productId,
        order: { createdAt: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
      },
    });
    if (orders === 0) deadStockCount++;
  }

  const stockoutRisk = totalInv > 0 ? lowStockInv / totalInv : 0;
  const deadStockRatio = totalInv > 0 ? deadStockCount / totalInv : 0;

  let invScore = 70;
  if (stockoutRisk > 0.3 || deadStockRatio > 0.3) invScore = 30;
  else if (stockoutRisk > 0.15 || deadStockRatio > 0.15) invScore = 50;
  else if (stockoutRisk > 0.05 || deadStockRatio > 0.05) invScore = 65;

  // --- Composite Score ---
  const score = Math.round(
    cashScore * 0.30 +
    profitScore * 0.25 +
    growthScore * 0.20 +
    debtScore * 0.15 +
    invScore * 0.10
  );

  const healthLabel = score >= 80 ? 'TỐT' : score >= 60 ? 'ỔN' : score >= 40 ? 'CẦN CHÚ Ý' : 'NGUY CƠ';
  const healthColor = score >= 80 ? '#059669' : score >= 60 ? '#d97706' : score >= 40 ? '#ea580c' : '#dc2626';

  const insights = [];
  if (cashScore < 50) insights.push({ area: 'Tiền mặt', suggestion: 'Số dư ngân hàng thấp. Cân nhắc thu hồi công nợ hoặc giảm chi phí.', icon: '💰' });
  if (profitScore < 50) insights.push({ area: 'Lợi nhuận', suggestion: `Lãi chỉ ${round1(marginPercent)}%. Xem lại giá bán và chi phí để cải thiện.`, icon: '📊' });
  if (growthScore < 40) insights.push({ area: 'Tăng trưởng', suggestion: businessLabel(growth), icon: '📈' });
  if (debtScore < 50) insights.push({ area: 'Công nợ', suggestion: `${round1(overdueRatio)}% công nợ quá hạn. Ưu tiên thu hồi nợ xấu.`, icon: '⚠️' });
  if (stockoutRisk > 0.1) insights.push({ area: 'Tồn kho', suggestion: `${lowStockInv} sản phẩm sắp hết. Lên kế hoạch nhập hàng ngay.`, icon: '📦' });

  return {
    score,
    label: healthLabel,
    color: healthColor,
    breakdown: {
      cash: { score: cashScore, weight: 30, label: 'Tiền mặt' },
      profitability: { score: profitScore, weight: 25, label: 'Lợi nhuận' },
      growth: { score: growthScore, weight: 20, label: 'Tăng trưởng' },
      debt: { score: debtScore, weight: 15, label: 'Công nợ' },
      inventory: { score: invScore, weight: 10, label: 'Tồn kho' },
    },
    metrics: {
      bankBalance: totalBank,
      monthRevenue: revenue,
      monthExpenses: expenses,
      monthProfit: profit,
      marginPercent: round1(marginPercent),
      growthPercent: round1(growth),
      arOutstanding: arTotal,
      arOverdue: arOverdue,
      lowStockCount: lowStockInv,
      deadStockCount: deadStockCount,
    },
    insights,
  };
}

// ==================== SIMPLE REPORT ====================

/**
 * Generate a simple, plain-language business report
 */
async function getSimpleReport(tenantId) {
  const health = await getBusinessHealth(tenantId);
  const suggestions = await getReorderSuggestions(tenantId);
  const pricing = await getPricingInsights(tenantId);

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthOrders = await prisma.order.count({
    where: { createdAt: { gte: thisMonth }, status: { not: 'CANCELLED' } },
  });
  const todayOrders = await prisma.order.count({
    where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
  });
  const monthCustomers = await prisma.customer.count({
    where: { createdAt: { gte: thisMonth } },
  });
  const totalCustomers = await prisma.customer.count({ where: { isActive: true } });

  const narrative = [];
  narrative.push(`Sức khỏe kinh doanh của bạn đang ở mức **${health.label}** (${health.score}/100).`);

  if (health.metrics.monthRevenue > 0) {
    narrative.push(`Tháng này bạn đã thu về **${formatMoney(health.metrics.monthRevenue)}** từ ${monthOrders} đơn hàng, lời **${formatMoney(health.metrics.monthProfit)}** (${health.metrics.marginPercent}%).`);
  } else {
    narrative.push('Tháng này chưa có doanh thu. Hãy tạo đơn hàng đầu tiên!');
  }

  if (health.metrics.arOverdue > 0) {
    narrative.push(`Bạn đang có **${formatMoney(health.metrics.arOverdue)}** công nợ quá hạn — nên thu hồi sớm.`);
  }

  if (health.metrics.lowStockCount > 0) {
    narrative.push(`${health.metrics.lowStockCount} sản phẩm sắp hết hàng — kiểm tra tab "Nhập hàng" để đặt thêm.`);
  }

  if (pricing.summary.belowCostCount > 0) {
    narrative.push(`⚠️ **Cảnh báo:** ${pricing.summary.belowCostCount} sản phẩm đang bán dưới giá vốn — bạn đang lỗ tiền!`);
  }

  return {
    generatedAt: now.toISOString(),
    health,
    today: {
      orders: todayOrders,
      revenue: health.metrics.monthRevenue, // Simplified
    },
    month: {
      orders: monthOrders,
      revenue: health.metrics.monthRevenue,
      profit: health.metrics.monthProfit,
      newCustomers: monthCustomers,
      totalCustomers,
    },
    narrative,
    urgentActions: [
      ...(health.metrics.lowStockCount > 0 ? [{ action: 'Nhập hàng', detail: `${health.metrics.lowStockCount} sản phẩm sắp hết`, link: '/products' }] : []),
      ...(health.metrics.arOverdue > 0 ? [{ action: 'Thu hồi công nợ', detail: `Còn ${formatMoney(health.metrics.arOverdue)} quá hạn`, link: '/debts' }] : []),
      ...(pricing.summary.belowCostCount > 0 ? [{ action: 'Điều chỉnh giá', detail: `${pricing.summary.belowCostCount} SP bán dưới giá vốn`, link: '/products' }] : []),
    ],
  };
}

// ==================== HELPERS ====================

function formatMoney(val) {
  return Number(val || 0).toLocaleString('vi-VN') + '₫';
}

function round1(val) {
  return Math.round(val * 10) / 10;
}

function businessLabel(growth) {
  if (growth > 0) return `Doanh thu tăng ${round1(growth)}% so với tháng trước. Tiếp tục phát huy!`;
  return `Doanh thu giảm ${round1(Math.abs(growth))}% so với tháng trước. Cần tìm hiểu nguyên nhân.`;
}

module.exports = {
  getPricingInsights,
  getReorderSuggestions,
  getBusinessHealth,
  getSimpleReport,
};
