const prisma = require("../../config/prisma");
const logger = require('../../utils/logger');

const LOG = "[automation]";

const checkAutoReorder = async (productIds, warehouseId) => {
  try {
    const notif = require("../notifications/notification.service");

    const inventories = await prisma.inventory.findMany({
      where: {
        productId: { in: productIds },
        warehouseId,
      },
      include: {
        product: { select: { id: true, name: true, sku: true, costPrice: true, isActive: true } },
      },
    });

    for (const inv of inventories) {
      if (!inv.product?.isActive) continue;
      const available = inv.quantity - (inv.reserved || 0);
      if (available > inv.minStock) continue;

      const lastPO = await prisma.purchaseItem.findFirst({
        where: { productId: inv.productId },
        orderBy: { purchaseOrder: { date: "desc" } },
        include: { purchaseOrder: { select: { vendorId: true, vendor: { select: { id: true, name: true, isActive: true } } } } },
      });

      const vendor = lastPO?.purchaseOrder?.vendor;
      if (!vendor || !vendor.isActive) {
        logger.info(`${LOG} auto-reorder: không tìm thấy vendor cho ${inv.product.sku}, skip`);
        continue;
      }

      const existingDraft = await prisma.purchaseOrder.findFirst({
        where: {
          vendorId: vendor.id,
          status: "DRAFT",
          items: { some: { productId: inv.productId } },
        },
      });
      if (existingDraft) {
        logger.info(`${LOG} auto-reorder: da co PO draft ${existingDraft.poCode} cho ${inv.product.sku}, skip`);
        continue;
      }

      const reorderQty = Math.max(1, (inv.minStock * 2) - inv.quantity);
      const unitCost = Number(inv.product.costPrice) || 0;
      const subtotal = reorderQty * unitCost;

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const count = await prisma.purchaseOrder.count({ where: { createdAt: { gte: start } } });
      const poCode = `PO-${today}-${String(count + 1).padStart(4, "0")}`;

      const autoApprove = subtotal < 5_000_000;
      const po = await prisma.purchaseOrder.create({
        data: {
          poCode,
          vendorId: vendor.id,
          status: autoApprove ? "APPROVED" : "DRAFT",
          subtotal,
          total: subtotal,
          note: `[Auto-Reorder] ${inv.product.name} con ${inv.quantity}, minStock=${inv.minStock}`,
          createdById: (await getSystemUserId()),
          items: {
            create: [{
              productId: inv.productId,
              quantity: reorderQty,
              unitCost,
              subtotal,
            }],
          },
        },
        include: { vendor: true },
      });

      logger.info(`${LOG} auto-reorder: tao PO ${poCode} cho ${inv.product.sku}, qty=${reorderQty}, total=${subtotal}, autoApprove=${autoApprove}`);

      if (autoApprove) {
        await notif.notifyRoles(["MANAGER", "ADMIN"], {
          type: "SYSTEM",
          severity: "INFO",
          title: "PO tự động đã duyệt",
          message: `PO ${poCode}: nhap ${reorderQty} x ${inv.product.name} tu ${vendor.name} (${subtotal.toLocaleString()} VND)`,
          link: "/purchase-orders",
          meta: { poId: po.id, autoApproved: true },
        });
      } else {
        await notif.notifyRoles(["MANAGER", "ADMIN"], {
          type: "PO_PENDING_APPROVAL",
          severity: "WARNING",
          title: "PO tự động cần duyệt",
          message: `PO ${poCode}: nhap ${reorderQty} x ${inv.product.name} tu ${vendor.name} (${subtotal.toLocaleString()} VND). Vui lòng duyet.`,
          link: "/purchase-orders",
          meta: { poId: po.id, autoApproved: false },
        });
      }
    }
  } catch (err) {
    logger.error(`${LOG} auto-reorder error:`, err.message);
  }
};

const autoPayroll = async () => {
  try {
    const hrService = require("../hr/hr.service");
    const journalService = require("../accounting/journal.service");
    const notif = require("../notifications/notification.service");

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const existing = await prisma.payroll.findFirst({
      where: { month, year, isLocked: true },
    });
    if (existing) {
      logger.info(`${LOG} auto-payroll: thang ${month}/${year} da co payroll locked, skip`);
      return;
    }

    logger.info(`${LOG} auto-payroll: bat dau tinh luong thang ${month}/${year}...`);
    const payrolls = await hrService.generatePayrollForMonth(month, year);

    if (!payrolls.length) {
      logger.info(`${LOG} auto-payroll: không co nhân viên active`);
      return;
    }

    const totalSalary = payrolls.reduce((sum, p) => sum + Number(p.finalSalary || 0), 0);
    const totalBHXH = payrolls.reduce((sum, p) => sum + Number(p.bhxhEmployee || 0), 0);
    const totalPIT = payrolls.reduce((sum, p) => sum + Number(p.pitAmount || 0), 0);

    if (totalSalary > 0) {
      try {
        const lines = [
          { accountCode: "642", debit: totalSalary + totalBHXH + totalPIT, description: `Chi phi luong thang ${month}/${year}` },
          { accountCode: "334", credit: totalSalary, description: `Phai tra NV thang ${month}/${year}` },
        ];

        if (totalBHXH > 0) {
          lines.push({ accountCode: "338", credit: totalBHXH, description: `BHXH phai nop thang ${month}/${year}` });
        }
        if (totalPIT > 0) {
          lines.push({ accountCode: "333", credit: totalPIT, description: `Thue TNCN phai nop thang ${month}/${year}` });
        }

        await journalService.postEntry({
          date: now,
          description: `Tinh luong thang ${month}/${year} - ${payrolls.length} nhân viên`,
          source: "PAYROLL",
          sourceId: `payroll-${year}-${month}`,
          operation: "PRIMARY",
          userId: await getSystemUserId(),
          lines,
        });
        logger.info(`${LOG} auto-payroll: da tao but toan luong ${totalSalary.toLocaleString()} VND`);
      } catch (err) {
        logger.error(`${LOG} auto-payroll: loi tao but toan:`, err.message);
      }
    }

    await notif.notifyRoles(["ADMIN"], {
      type: "PAYROLL_DUE",
      severity: "INFO",
      title: `Luong thang ${month}/${year} da tinh xong`,
      message: `${payrolls.length} nhân viên, tong luong: ${totalSalary.toLocaleString()} VND. Vao HR de xem chi tiet va khoa bang luong.`,
      link: "/hr",
      meta: { month, year, count: payrolls.length, total: totalSalary },
    });

    logger.info(`${LOG} auto-payroll: hoan tat ${payrolls.length} nhân viên, tong ${totalSalary.toLocaleString()} VND`);
  } catch (err) {
    logger.error(`${LOG} auto-payroll error:`, err.message);
  }
};

const debtAutoCollection = async () => {
  try {
    const notif = require("../notifications/notification.service");
    const now = new Date();

    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const upcomingDebts = await prisma.debt.findMany({
      where: {
        status: { in: ["OPEN", "PARTIAL"] },
        dueDate: { gte: now, lte: threeDaysLater },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vendor: { select: { id: true, name: true } },
      },
    });

    for (const debt of upcomingDebts) {
      const remaining = Number(debt.amount) - Number(debt.paidAmount);
      const partyName = debt.customer?.name || debt.vendor?.name || "N/A";
      const daysLeft = Math.ceil((new Date(debt.dueDate) - now) / (24 * 60 * 60 * 1000));

      const recentNotif = await prisma.notification.findFirst({
        where: {
          type: "DEBT_OVERDUE",
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          meta: { path: ["debtId"], equals: debt.id },
        },
      });
      if (recentNotif) continue;

      await notif.notifyRoles(["MANAGER"], {
        type: "DEBT_OVERDUE",
        severity: "WARNING",
        title: `Công nợ sap den han (${daysLeft} ngay)`,
        message: `${debt.type === "RECEIVABLE" ? "Phai thu" : "Phai tra"} ${partyName}: ${remaining.toLocaleString()} VND, han ${new Date(debt.dueDate).toLocaleDateString("vi-VN")}`,
        link: "/debts",
        meta: { debtId: debt.id, level: "upcoming", daysLeft },
      });

      // Send Zalo reminder to customer
      if (debt.customer?.phone) {
        try {
          const zalo = require("../../utils/zalo");
          zalo.sendDebtReminder({
            name: debt.customer.name,
            phone: debt.customer.phone,
            debtAmount: remaining,
            dueDate: debt.dueDate,
          }).catch(() => {});
        } catch (_) {}
      }

      if (debt.customer?.id) {
        await prisma.customerNote.create({
          data: {
            customerId: debt.customer.id,
            content: `[Tự động] Nhắc nợ: con ${remaining.toLocaleString()} VND, han ${new Date(debt.dueDate).toLocaleDateString("vi-VN")}`,
            type: "NOTE",
            createdById: await getSystemUserId(),
          },
        }).catch(() => {});
      }
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const overdueDebts7 = await prisma.debt.findMany({
      where: {
        status: { in: ["OPEN", "PARTIAL", "OVERDUE"] },
        dueDate: { lt: sevenDaysAgo },
      },
      include: {
        customer: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
    });

    for (const debt of overdueDebts7) {
      const remaining = Number(debt.amount) - Number(debt.paidAmount);
      const partyName = debt.customer?.name || debt.vendor?.name || "N/A";
      const daysOverdue = Math.ceil((now - new Date(debt.dueDate)) / (24 * 60 * 60 * 1000));

      const recentEscalation = await prisma.notification.findFirst({
        where: {
          type: "DEBT_OVERDUE",
          severity: "CRITICAL",
          createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
          meta: { path: ["debtId"], equals: debt.id },
        },
      });
      if (recentEscalation) continue;

      await prisma.debt.update({
        where: { id: debt.id },
        data: { status: "OVERDUE" },
      });

      await notif.notifyRoles(["ADMIN"], {
        type: "DEBT_OVERDUE",
        severity: "CRITICAL",
        title: `KHẨN: Công nợ quá hạn ${daysOverdue} ngay`,
        message: `${debt.type === "RECEIVABLE" ? "Phai thu" : "Phai tra"} ${partyName}: ${remaining.toLocaleString()} VND. Can xu ly gap!`,
        link: "/debts",
        meta: { debtId: debt.id, level: "escalated", daysOverdue },
      });
    }

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const overdueDebts30 = await prisma.debt.findMany({
      where: {
        status: { in: ["OPEN", "PARTIAL", "OVERDUE"] },
        dueDate: { lt: thirtyDaysAgo },
      },
    });

    for (const debt of overdueDebts30) {
      const recentFlag = await prisma.notification.findFirst({
        where: {
          type: "DEBT_OVERDUE",
          createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
          meta: { path: ["debtId"], equals: debt.id, path: ["level"], equals: "critical_flag" },
        },
      });
      if (recentFlag) continue;

      await prisma.debt.update({
        where: { id: debt.id },
        data: {
          status: "OVERDUE",
          note: `${debt.note || ""} [QUA HAN 30+ NGAY - CAN XU LY DAC BIET]`.trim(),
        },
      });

      await notif.notifyRoles(["ADMIN"], {
        type: "DEBT_OVERDUE",
        severity: "CRITICAL",
        title: "Công nợ quá hạn 30+ ngay",
        message: `Debt ${debt.id.slice(0, 8)}: ${(Number(debt.amount) - Number(debt.paidAmount)).toLocaleString()} VND. Da danh dau can xu ly dac biet.`,
        link: "/debts",
        meta: { debtId: debt.id, level: "critical_flag" },
      });
    }

    const total = upcomingDebts.length + overdueDebts7.length + overdueDebts30.length;
    if (total > 0) {
      logger.info(`${LOG} debt-collection: ${upcomingDebts.length} sap han, ${overdueDebts7.length} qua 7d, ${overdueDebts30.length} qua 30d`);
    }
  } catch (err) {
    logger.error(`${LOG} debt-collection error:`, err.message);
  }
};

const onOrderCompleted = async (order, userId) => {
  try {
    const productIds = (order.items || []).map((it) => it.productId);
    const warehouseId = order.warehouseId;
    if (productIds.length && warehouseId) {
      setTimeout(() => {
        checkAutoReorder(productIds, warehouseId).catch((e) =>
          logger.error(`${LOG} onOrderCompleted auto-reorder error:`, e.message)
        );
      }, 1000);
    }

    // Send Zalo notification to customer
    if (order.customer?.phone) {
      try {
        const zalo = require("../../utils/zalo");
        zalo.sendOrderStatusUpdate(
          order.customer.name, order.customer.phone,
          order.orderCode, "COMPLETED"
        ).catch(() => {});
      } catch (_) {}
    }
  } catch (err) {
    logger.error(`${LOG} onOrderCompleted error:`, err.message);
  }
};

// ===================== 5. MORNING BRIEFING =====================

/**
 * Tong hop briefing buoi sang cho ADMIN.
 * Goi tu cron job 7h sang hang ngay.
 */
const morningBriefing = async () => {
  try {
    const notif = require("../notifications/notification.service");
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      ordersToday, revenueToday,
      ordersYesterday, revenueYesterday,
      ordersThisMonth, revenueThisMonth,
      lowStock, pendingPO, overdueDebts,
      activeCustomers, newCustomersThisMonth,
    ] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: today }, status: { not: 'CANCELLED' } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: today }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
      prisma.order.count({ where: { createdAt: { gte: yesterday, lt: today }, status: { not: 'CANCELLED' } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: yesterday, lt: today }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
      prisma.order.count({ where: { createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
      prisma.inventory.count({ where: { quantity: { lte: 5 } } }).catch(() => 0),
      prisma.purchaseOrder.count({ where: { status: { in: ['DRAFT', 'PENDING'] } } }),
      prisma.debt.count({ where: { status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] }, dueDate: { lte: new Date(now.getTime() + 7 * 86400000) } } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.customer.count({ where: { isActive: true, createdAt: { gte: monthStart } } }),
    ]);

    const revenueT = Number(revenueToday._sum.total || 0);
    const revenueY = Number(revenueYesterday._sum.total || 0);
    const revenueTM = Number(revenueThisMonth._sum.total || 0);
    const changeD = revenueY > 0 ? Math.round(((revenueT - revenueY) / revenueY) * 100) : (revenueT > 0 ? 100 : 0);

    let anomaly = '';
    if (revenueY > 0 && revenueT < revenueY * 0.7) {
      anomaly += `⚠️ Doanh thu hom nay giam ${Math.abs(changeD)}% so voi hom qua.\n`;
    }
    if (lowStock > 20) {
      anomaly += `⚠️ Co ${lowStock} sản phẩm sắp hết hàng – can nhap gap.\n`;
    }
    if (overdueDebts > 10) {
      anomaly += `⚠️ ${overdueDebts} khoan công nợ sap den han (7 ngay toi).\n`;
    }
    if (pendingPO > 5) {
      anomaly += `📋 ${pendingPO} PO dang chờ duyệt.\n`;
    }

    const message = [
      `📊 **Báo cáo sang ${now.toLocaleDateString('vi-VN')}**`,
      ``,
      `📦 Hom nay: ${ordersToday} don — ${revenueT.toLocaleString()} VND (${changeD >= 0 ? '+' : ''}${changeD}% vs hom qua)`,
      `📅 Thang nay: ${ordersThisMonth} don — ${revenueTM.toLocaleString()} VND`,
      ``,
      `👤 Khách hàng: ${activeCustomers} (moi: ${newCustomersThisMonth} thang nay)`,
      `📦 Tồn kho thap: ${lowStock} SP`,
      `📋 PO chờ duyệt: ${pendingPO}`,
      `💰 No sap den han: ${overdueDebts}`,
      anomaly ? `\n🚨 **Cảnh báo:**\n${anomaly}` : '',
      `✅ Goi y hom nay:`,
      pendingPO > 0 ? `  → Duyet ${pendingPO} PO dang cho` : '',
      lowStock > 0 ? `  → Nhập hàng cho ${lowStock} SP ton thap` : '',
      overdueDebts > 0 ? `  → Nhắc nợ ${overdueDebts} KH sap den han` : '',
    ].filter(Boolean).join('\n');

    const severity = anomaly ? 'WARNING' : 'INFO';

    await notif.notifyRoles(['ADMIN', 'MANAGER'], {
      type: 'SYSTEM',
      severity,
      title: `Briefing ${now.toLocaleDateString('vi-VN')}`,
      message,
      link: '/',
      meta: {
        ordersToday, revenueToday: revenueT,
        changeD, lowStock, pendingPO, overdueDebts,
        anomaly: !!anomaly,
      },
    });

    logger.info(`${LOG} morning-briefing: sent. revenue=${revenueT.toLocaleString()} VND, alert=${!!anomaly}`);
    return { success: true, anomaly: !!anomaly };
  } catch (err) {
    logger.error(`${LOG} morning-briefing error:`, err.message);
    return { success: false, error: err.message };
  }
};

// ===================== 5.5 ANOMALY DETECTION =====================

const anomalyDetection = async () => {
  try {
    const notif = require("../notifications/notification.service");
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const alerts = [];

    const last7 = new Date(today.getTime() - 7 * 86400000);
    const last37 = new Date(today.getTime() - 37 * 86400000);

    const [recent, previous] = await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: last7 }, status: { not: 'CANCELLED' } },
        _sum: { total: true }, _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: last37, lt: last7 }, status: { not: 'CANCELLED' } },
        _sum: { total: true }, _count: { id: true },
      }),
    ]);

    const recentTotal = Number(recent._sum.total || 0);
    const previousTotal = Number(previous._sum.total || 0);
    const recentCount = recent._count.id || 0;
    const previousCount = previous._count.id || 0;

    if (previousTotal > 0) {
      const avgRecent = recentTotal / Math.max(recentCount, 1);
      const avgPrevious = previousTotal / Math.max(previousCount, 1);
      if (avgRecent < avgPrevious * 0.5) {
        alerts.push({
          type: 'REVENUE_DROP',
          message: `Doanh thu TB 7 ngay qua (${avgRecent.toLocaleString()} VND/don) giam >50% so voi 30 ngay truoc (${avgPrevious.toLocaleString()} VND/don)`,
        });
      }
    }

    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [expenseThis, expenseLast] = await Promise.all([
      prisma.expense.aggregate({ where: { date: { gte: thisMonth } }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { date: { gte: lastMonthStart, lt: thisMonth } }, _sum: { amount: true } }),
    ]);

    const expThis = Number(expenseThis._sum.amount || 0);
    const expLast = Number(expenseLast._sum.amount || 0);

    if (expLast > 0 && expThis > expLast * 1.5) {
      alerts.push({
        type: 'EXPENSE_SPIKE',
        message: `Chi phi thang nay (${expThis.toLocaleString()} VND) tang >50% so voi thang truoc (${expLast.toLocaleString()} VND)`,
      });
    }

    const sixtyDaysAgo = new Date(today.getTime() - 60 * 86400000);
    const dormantCustomers = await prisma.customer.count({
      where: {
        isActive: true,
        orders: { none: { createdAt: { gte: sixtyDaysAgo } } },
      },
    });

    if (dormantCustomers > 10) {
      alerts.push({
        type: 'DORMANT_CUSTOMERS',
        message: `${dormantCustomers} khách hàng không mua hang trong 60 ngay qua`,
      });
    }

    if (alerts.length > 0) {
      const alertMsg = alerts.map((a, i) => `${i + 1}. ${a.message}`).join('\n');
      await notif.notifyRoles(['ADMIN'], {
        type: 'ANOMALY',
        severity: 'WARNING',
        title: `Phat hien ${alerts.length} bất thường`,
        message: alertMsg,
        link: '/analytics',
        meta: { alerts },
      });

      logger.info(`${LOG} anomaly-detection: ${alerts.length} alerts`);
    }

    return { success: true, alerts: alerts.length };
  } catch (err) {
    logger.error(`${LOG} anomaly-detection error:`, err.message);
    return { success: false, error: err.message };
  }
};

const getSystemUserId = async () => {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  return admin?.id || null;
};

// ===================== 6. AUTO-CLOSE INACTIVE CUSTOMERS =====================

const autoCloseDormantCustomers = async () => {
  try {
    const now = new Date();
    const threshold = new Date(now.getTime() - 180 * 86400000);
    const dormant = await prisma.customer.findMany({
      where: { isActive: true, orders: { none: { createdAt: { gte: threshold } } }, updatedAt: { lt: threshold } },
      select: { id: true, name: true },
    });
    if (!dormant.length) return { count: 0 };
    await prisma.customer.updateMany({ where: { id: { in: dormant.map((c) => c.id) } }, data: { isActive: false } });
    logger.info(`${LOG} autoCloseDormant: ${dormant.length} customers`);
    return { count: dormant.length };
  } catch (err) { logger.error(`${LOG} autoCloseDormant error:`, err.message); return { success: false }; }
};

// ===================== 7. AUTO-ARCHIVE OLD DATA =====================

const autoArchiveData = async () => {
  try {
    const now = new Date();
    const a = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * 86400000) } } });
    const n = await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86400000) }, isRead: true } });
    if (a.count || n.count) logger.info(`${LOG} autoArchive: ${a.count} audit, ${n.count} notifs`);
    return { auditLogs: a.count, notifications: n.count };
  } catch (err) { logger.error(`${LOG} autoArchive error:`, err.message); return { success: false }; }
};

// ===================== 8. WEEKLY P&L EMAIL =====================

const weeklyPnLEmail = async () => {
  try {
    const notif = require("../notifications/notification.service");
    const now = new Date(); const w = new Date(now.getTime() - 7 * 86400000);
    const m = new Date(now.getFullYear(), now.getMonth(), 1);
    const [rw, rm, ew, o] = await Promise.all([
      prisma.order.aggregate({ where: { createdAt: { gte: w }, status: { not: "CANCELLED" } }, _sum: { total: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: m }, status: { not: "CANCELLED" } }, _sum: { total: true } }),
      prisma.expense.aggregate({ where: { date: { gte: w } }, _sum: { amount: true } }),
      prisma.order.count({ where: { createdAt: { gte: w }, status: { not: "CANCELLED" } } }),
    ]);
    const revW = Number(rw._sum.total || 0); const expW = Number(ew._sum.amount || 0); const prof = revW - expW;
    await notif.notifyRoles(["ADMIN", "MANAGER"], { type: "SYSTEM", severity: "INFO", title: `P&L tuan ${now.toLocaleDateString("vi-VN")}`, message: `${o} don — DT: ${revW.toLocaleString()} VND — CP: ${expW.toLocaleString()} VND — LN: ${prof.toLocaleString()} VND (${revW ? ((prof / revW) * 100).toFixed(1) : 0}%)`, link: "/finance", meta: { revenue: revW, expenses: expW, profit: prof } });
    logger.info(`${LOG} weeklyPnL: ${revW.toLocaleString()} VND`);
    return { revenue: revW, profit: prof };
  } catch (err) { logger.error(`${LOG} weeklyPnL error:`, err.message); return { success: false }; }
};

module.exports = {
  checkAutoReorder,
  autoPayroll,
  debtAutoCollection,
  onOrderCompleted,
  morningBriefing,
  anomalyDetection,
  autoCloseDormantCustomers,
  autoArchiveData,
  weeklyPnLEmail,
};
