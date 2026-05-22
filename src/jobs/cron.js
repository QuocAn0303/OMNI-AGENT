// src/jobs/cron.js
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
      if (expiredPts) console.log(`[cron] expired ${expiredPts} loyalty batches`);
    } catch (e) {
      console.error("[cron] loyalty expire", e.message);
    }
  });

  cron.schedule("0 1 1 * *", async () => {
    try {
      const created = await expenseAuto.generateRecurring();
      if (created.length) console.log(`[cron] recurring expenses: ${created.length}`);
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
      const result = await fixedAssetsService.runMonthlyDepreciation(now.getFullYear(), now.getMonth() + 1);
      console.log(`[cron] depreciation ${result.period}: ${result.processed} assets processed`);
    } catch (e) {
      console.error("[cron] depreciation", e.message);
    }
  });

  // Lot expiry alert: 7h mỗi ngày — thông báo lô hàng hết hạn trong 30 ngày
  cron.schedule("0 7 * * *", async () => {
    try {
      const lots = await lotService.getExpiringLots(30);
      if (lots.length) console.log(`[cron] ${lots.length} lô hàng sắp hết hạn trong 30 ngày`);
      // TODO: send notifications to ADMIN/MANAGER
    } catch (e) {
      console.error("[cron] lot expiry check", e.message);
    }
  });

  console.log("[cron] scheduled: orders hourly, debt 09:00, payroll 25th, period 28th, promo daily, recurring 1st, CRM tasks 08:00, CRM campaigns every minute, depreciation 28th 01:00, lot expiry 07:00");
};

module.exports = { startCrons };
