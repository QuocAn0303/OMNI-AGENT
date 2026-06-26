/**
 * jobs/cron.js — Tác vụ định kỳ (node-cron) cho toàn hệ thống
 * 
 * Tổng quan:
 * - Chạy các tác vụ nền theo lịch: hủy đơn pending, nhắc nợ, lương, đóng kỳ, khuyến mãi, CRM, khấu hao TSCĐ, lot expiry
 * - Chỉ chạy trên PM2 instance 0 (xem app.js) để tránh trùng lặp trong cluster mode
 * - Mỗi tác vụ có try/catch riêng, không làm ảnh hưởng lẫn nhau
 * 
 * Lịch chạy:
 * - Mỗi 5 phút: Quét phiên hỗ trợ hết hạn (support sessions)
 * - Mỗi giờ: Đơn PENDING quá 24h → tự động hủy
 * - 09:00 hàng ngày: Nhắc công nợ quá hạn
 * - 09:00 ngày 25: Nhắc tính lương
 * - 09:00 ngày 28: Nhắc đóng kỳ kế toán
 * - 00:00 hàng ngày: Làm hết hạn khuyến mãi, điểm loyalty, subscription
 * - 01:00 ngày 1: Sinh chi phí định kỳ (recurring expenses)
 * - 08:00 hàng ngày: Nhắc nhiệm vụ CRM sắp tới hạn
 * - Mỗi phút: Xử lý CRM campaigns đã đặt lịch
 * - 01:00 ngày 28: Chạy khấu hao TSCĐ tháng
 * - 07:00 hàng ngày: Cảnh báo lô hàng sắp hết hạn
 * 
 * Hàm:
 * - startCrons(): Khởi động tất cả cron jobs
 * - (Các cron handler inline trong cron.schedule)
 */

const cron = require("node-cron");
const debtService = require("../modules/debt/debt.service");
const notif = require("../modules/notifications/notification.service");
const promotionService = require("../modules/promotions/promotion.service");
const expenseAuto = require("../modules/accounting/expense-auto.service");
const loyaltyService = require("../modules/loyalty/loyalty.service");
const crmTasksService = require("../modules/crm/tasks.service");
const crmCampaignsService = require("../modules/crm/campaigns.service");
const fixedAssetsService = require("../modules/fixed-assets/fixed-assets.service");
const lotService = require("../modules/production/lot.service");
const automation = require("../modules/automation/automation.service");
const bankRecoService = require("../modules/bank-reco/bank-reco.service");
const periodCloseService = require("../modules/accounting/period-close.service");
const subscriptionService = require("../modules/subscriptions/subscription.service");
const currencyService = require("../modules/currency/currency.service");
const prisma = require("../config/prisma");
const logger = require("../utils/logger"); // Sử dụng winston logger có sẵn của dự án

// Quét các phiên hỗ trợ hết hạn mỗi 5 phút
cron.schedule("*/5 * * * *", async () => {
  try {
    const now = new Date();

    // Tìm và cập nhật tất cả các phiên ACTIVE nhưng đã quá thời gian expiresAt
    const result = await prisma.supportAccessSession.updateMany({
      where: {
        status: "ACTIVE",
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: "EXPIRED",
      },
    });

    if (result.count > 0) {
      logger.info(
        `[Cron Support Session] Đã tự động chuyển đổi trạng thái sang EXPIRED cho ${result.count} phiên hỗ trợ hết hạn.`,
      );
    }
  } catch (error) {
    logger.error(
      "[Cron Support Session Error] Lỗi khi quét phiên hỗ trợ hết hạn:",
      error,
    );
  }
});

const startCrons = () => {
  cron.schedule("0 * * * *", async () => {
    try {
      await notif.cronPendingOrders();
    } catch (e) {
      console.error("[cron] pending orders", e.message);
    }
  });

  cron.schedule("0 9 * * *", async () => {
    try {
      await notif.cronDebtOverdue(debtService);
    } catch (e) {
      console.error("[cron] debt overdue", e.message);
    }
  });

  cron.schedule("0 9 25 * *", async () => {
    try {
      await notif.cronPayrollDue();
    } catch (e) {
      console.error("[cron] payroll due", e.message);
    }
  });

  cron.schedule("0 9 28 * *", async () => {
    try {
      await notif.cronPeriodClosing();
    } catch (e) {
      console.error("[cron] period closing", e.message);
    }
  });

  cron.schedule("0 0 * * *", async () => {
    try {
      const n = await promotionService.expirePromotions();
      if (n) console.log(`[cron] expired ${n} promotions`);
    } catch (e) {
      console.error("[cron] promotion expire", e.message);
    }
    try {
      const expiredPts = await loyaltyService.expirePoints();
      if (expiredPts)
        console.log(`[cron] expired ${expiredPts} loyalty batches`);
    } catch (e) {
      console.error("[cron] loyalty expire", e.message);
    }
    try {
      const expired = await subscriptionService.checkExpiredSubscriptions();
      if (expired) console.log(`[cron] expired ${expired} subscriptions`);
    } catch (e) {
      console.error("[cron] subscription expiry", e.message);
    }
  });

  cron.schedule("0 1 1 * *", async () => {
    try {
      const created = await expenseAuto.generateRecurring();
      if (created.length)
        console.log(`[cron] recurring expenses: ${created.length}`);
    } catch (e) {
      console.error("[cron] recurring expenses", e.message);
    }
  });

  // CRM: nhắc nhiệm vụ sắp tới hạn / quá hạn — 8h sáng mỗi ngày
  cron.schedule("0 8 * * *", async () => {
    try {
      const n = await crmTasksService.cronRemindUpcoming();
      if (n) console.log(`[cron] CRM task reminders sent: ${n}`);
    } catch (e) {
      console.error("[cron] crm task reminder", e.message);
    }
  });

  // Tự động cập nhật tỷ giá từ API mỗi ngày lúc 08:30
  cron.schedule("30 8 * * *", async () => {
    try {
      const n = await currencyService.fetchRatesFromAPI();
      console.log(`[cron] exchange rates: updated ${n} currencies`);
    } catch (e) {
      console.error("[cron] exchange rates", e.message);
    }
  });

  // CRM: xử lý campaigns đã đặt lịch — mỗi phút
  cron.schedule("* * * * *", async () => {
    try {
      const n = await crmCampaignsService.cronProcessScheduled();
      if (n) console.log(`[cron] CRM campaigns processed: ${n}`);
    } catch (e) {
      console.error("[cron] crm campaign scheduler", e.message);
    }
  });

  // Khấu hao TSCD: ngày 28 mỗi tháng lúc 01:00
  cron.schedule("0 1 28 * *", async () => {
    const now = new Date();
    try {
      const result = await fixedAssetsService.runMonthlyDepreciation(
        now.getFullYear(),
        now.getMonth() + 1,
      );
      console.log(
        `[cron] depreciation ${result.period}: ${result.processed} assets processed`,
      );
    } catch (e) {
      console.error("[cron] depreciation", e.message);
    }
  });

  // Lot expiry alert: 7h mỗi ngày — thông báo lô hàng hết hạn trong 30 ngày
  cron.schedule("0 7 * * *", async () => {
    try {
      const lots = await lotService.getExpiringLots(30);
      if (lots.length)
        console.log(`[cron] ${lots.length} lô hàng sắp hết hạn trong 30 ngày`);
      // TODO: send notifications to ADMIN/MANAGER
    } catch (e) {
      console.error("[cron] lot expiry check", e.message);
    }
  });

  // Auto-Payroll: ngay 25 hang thang luc 6h sang
  cron.schedule("0 6 25 * *", async () => {
    try {
      await automation.autoPayroll();
    } catch (e) {
      console.error("[cron] auto-payroll", e.message);
    }
  });

  // Debt Auto-Collection: 9h sang moi ngay
  // 3 cap: sap han (3 ngay), qua han 7 ngay, qua han 30 ngay
  cron.schedule("0 9 * * *", async () => {
    try {
      await automation.debtAutoCollection();
    } catch (e) {
      console.error("[cron] debt-auto-collection", e.message);
    }
  });

  // Bank Reco Auto-Match: 10h sang moi ngay
  cron.schedule("0 10 * * *", async () => {
    try {
      await bankRecoService.autoMatchAll();
    } catch (e) {
      console.error("[cron] bank-reco auto-match", e.message);
    }
  });

  // AI Proactive: Morning Briefing 7h sang moi ngay
  cron.schedule("0 7 * * *", async () => {
    try {
      await automation.morningBriefing();
    } catch (e) {
      console.error("[cron] morning-briefing", e.message);
    }
  });

  // AI Proactive: Anomaly Detection 8h sang moi ngay
  cron.schedule("0 8 * * *", async () => {
    try {
      await automation.anomalyDetection();
    } catch (e) {
      console.error("[cron] anomaly-detection", e.message);
    }
  });

  // Accounting: Phan bo chi phi tra truoc hang thang (ngay 1 luc 02:00)
  cron.schedule("0 2 1 * *", async () => {
    try {
      const now = new Date();
      const systemUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
      if (systemUser) {
        const n = await periodCloseService.runMonthlyAllocation(
          now.getFullYear(), now.getMonth() + 1, systemUser.id
        );
        if (n.length) console.log(`[cron] prepaid-allocation: ${n.length} items`);
      }
    } catch (e) {
      console.error("[cron] prepaid-allocation", e.message);
    }
  });

  // Accounting: Khau hao TSCD hang thang (ngay 1 luc 03:00)
  cron.schedule("0 3 1 * *", async () => {
    try {
      const now = new Date();
      const systemUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
      if (systemUser) {
        const n = await periodCloseService.runMonthlyDepreciation(
          now.getFullYear(), now.getMonth() + 1, systemUser.id
        );
        if (n.length) console.log(`[cron] monthly-depreciation: ${n.length} assets`);
      }
    } catch (e) {
      console.error("[cron] monthly-depreciation", e.message);
    }
  });

  // Weekly P&L report: 8h sang thu 2
  cron.schedule("0 8 * * 1", async () => {
    try {
      await automation.weeklyPnLEmail();
    } catch (e) {
      console.error("[cron] weekly-pnl", e.message);
    }
  });

  // Auto-close dormant customers: ngay 1 hang thang luc 04:00
  cron.schedule("0 4 1 * *", async () => {
    try {
      await automation.autoCloseDormantCustomers();
    } catch (e) {
      console.error("[cron] auto-close-dormant", e.message);
    }
  });

  // Auto-archive: ngay 1 hang thang luc 05:00
  cron.schedule("0 5 1 * *", async () => {
    try {
      await automation.autoArchiveData();
    } catch (e) {
      console.error("[cron] auto-archive", e.message);
    }
  });

  console.log(
    "[cron] scheduled: orders hourly, debt 09:00, payroll 25th, period 28th, promo daily, recurring 1st, CRM tasks 08:00, CRM campaigns every minute, depreciation 28th 01:00, lot expiry 07:00, exchange rates 08:30, auto-payroll 25th 06:00, debt-collection 09:00, bank-reco-auto-match 10:00, morning-briefing 07:00, anomaly-detection 08:00, prepaid-allocation 1st 02:00, monthly-depreciation 1st 03:00, weekly-pnl Mon 08:00, auto-close-dormant 1st 04:00, auto-archive 1st 05:00",
  );
};

module.exports = { startCrons };
