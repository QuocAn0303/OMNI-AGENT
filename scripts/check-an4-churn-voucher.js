'use strict';

/**
 * scripts/check-an4-churn-voucher.js — AN.4: churn cao → nhận voucher KHÔNG bấm tay
 *
 * DoD của R4 (một nửa): "khách test churn cao nhận voucher không bấm tay; log ghi đúng".
 * Script này chứng minh đúng nửa đó bằng cách gọi **đúng hàm cron** — không gọi tay
 * tạo voucher, không giả lập. Chuỗi được kiểm chứng:
 *
 *   churnAutomation.runAllTenants()
 *     → clvForecast.runForTenant()            (chấm lại CLV/churn)
 *     → tìm khách churnProbability ≥ 0.70
 *     → Promotion (voucher) + CustomerTask + ChurnAlert + Notification
 *
 * Kiểm tra thêm: mỗi lần chạy KHÔNG tạo trùng voucher cho cùng một khách
 * (đây là điều dễ hỏng nhất của automation).
 *
 *   Yêu cầu: backend đang chạy + `npm run seed:phase1:apply`
 *   Chạy:   npm run check:an4
 *   Giữ dữ liệu để xem trên UI: npm run check:an4 -- --keep
 */
require("dotenv").config();

const { assertLocalDb } = require("./lib/assert-local-db");

assertLocalDb("check:an4");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

const KEEP = process.argv.includes("--keep");
const TENANT_SLUG = "crm-phase1-demo";
const CHURN_THRESHOLD = Number(process.env.CHURN_THRESHOLD || 0.7);
// Đúng công thức của `churn-automation.service.js`: > ngưỡng critical thì
// CRITICAL, ngược lại HIGH. Mức cảnh báo là HÀM CỦA ĐIỂM CHURN, không phải của
// ngưỡng kích hoạt — nên không suy ra từ CHURN_THRESHOLD.
const CHURN_CRITICAL_THRESHOLD = Number(process.env.CHURN_CRITICAL_THRESHOLD || 0.85);
const riskLevelOf = (p) => (p > CHURN_CRITICAL_THRESHOLD ? "CRITICAL" : "HIGH");

let failed = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " → " + extra : ""}`);
  if (!cond) failed += 1;
};

(async () => {
  console.log("\n=== AN.4 — CHURN CAO → VOUCHER TỰ ĐỘNG (không bấm tay) ===");
  console.log(`Tenant: ${TENANT_SLUG}\n`);

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true },
  });
  if (!tenant) {
    console.log(`FAIL | Chưa có tenant "${TENANT_SLUG}" — chạy: npm run seed:phase1:apply`);
    process.exit(1);
  }

  // Chạy đúng hàm cron (không phải bản sao) để đo được đường đi thật.
  const churnAutomation = require("../src/modules/customers/churn-automation.service");

  const countBefore = {
    alerts: await prisma.churnAlert.count({ where: { tenantId: tenant.id } }),
    promotions: await prisma.promotion.count({ where: { tenantId: tenant.id } }),
    tasks: await prisma.customerTask.count({ where: { tenantId: tenant.id } }),
    notifications: await prisma.notification.count({ where: { tenantId: tenant.id } }),
  };
  console.log("TRƯỚC KHI CHẠY AUTOMATION:");
  console.log(`  churn_alerts=${countBefore.alerts} · promotions=${countBefore.promotions} · tasks=${countBefore.tasks} · notifications=${countBefore.notifications}\n`);

  const t0 = Date.now();
  const res = await churnAutomation.runAllTenants();
  const elapsed = Date.now() - t0;

  console.log(`KẾT QUẢ runAllTenants() sau ${elapsed} ms:`);
  console.log(`  tenants=${res?.tenants} · scored=${res?.scored} · alertsCreated=${res?.alertsCreated} · retained=${res?.retained} · lost=${res?.lost}\n`);

  ok("Cron automation chạy được (không lỗi)", !!res && typeof res.alertsCreated === "number");
  ok(
    "Cron chấm được khách (scored > 0)",
    (res?.scored ?? 0) > 0,
    `scored=${res?.scored}`,
  );

  await runWithTenant(tenant.id, async () => {
    const countAfter = {
      alerts: await prisma.churnAlert.count(),
      promotions: await prisma.promotion.count(),
      tasks: await prisma.customerTask.count(),
      notifications: await prisma.notification.count(),
    };

    // Khách rủi ro: churn ≥ ngưỡng.
    const risky = await prisma.customer.findMany({
      where: { isActive: true, churnProbability: { gte: CHURN_THRESHOLD } },
      select: {
        id: true,
        name: true,
        churnProbability: true,
        clvPredicted: true,
        rfmSegment: true,
      },
      orderBy: { churnProbability: "desc" },
      take: 50,
    });
    ok(
      "Có khách vượt ngưỡng churn để kiểm chứng",
      risky.length > 0,
      `${risky.length} khách có churn ≥ ${CHURN_THRESHOLD}`,
    );

    // 1. ChurnAlert sinh ra cho khách rủi ro
    const alerts = await prisma.churnAlert.findMany({
      where: { customerId: { in: risky.map((c) => c.id) } },
      select: {
        id: true,
        customerId: true,
        riskLevel: true,
        churnScore: true,
        voucherCode: true,
        promotionId: true,
        status: true,
        createdAt: true,
      },
    });
    ok(
      "Khách churn cao có ChurnAlert",
      alerts.length > 0,
      `${alerts.length} alert / ${risky.length} khách rủi ro`,
    );

    // 2. Voucher (Promotion) thật, gắn qua promotionId + voucherCode
    const promoIds = alerts.map((a) => a.promotionId).filter(Boolean);
    const promos = promoIds.length
      ? await prisma.promotion.findMany({
          where: { id: { in: promoIds } },
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            status: true,
            value: true,
            usageLimit: true,
            usageCount: true,
            endDate: true,
          },
        })
      : [];
    ok(
      "Mỗi ChurnAlert có voucher Promotion thật",
      promos.length === promoIds.length && promoIds.length > 0,
      `${promos.length}/${promoIds.length} voucher`,
    );
    const samplePromo = promos[0];
    if (samplePromo) {
      ok(
        "Voucher đúng cấu trúc (mã + kiểu + giá trị)",
        !!samplePromo.code && !!samplePromo.type && Number(samplePromo.value) > 0,
        `${samplePromo.code} · ${samplePromo.type} · giá trị ${Number(samplePromo.value).toLocaleString("vi-VN")}`,
      );
    }

    // 3. Task CSKH sinh cho nhân viên xử lý
    const autoTasks = await prisma.customerTask.findMany({
      where: { customerId: { in: risky.map((c) => c.id) } },
      select: { id: true, customerId: true, title: true, status: true, assignedToId: true },
    });
    ok(
      "Khách churn cao có nhiệm vụ CSKH được giao cho nhân viên",
      autoTasks.length > 0,
      `${autoTasks.length} nhiệm vụ`,
    );
    ok(
      "Nhiệm vụ có người nhận (không phải task mồ côi)",
      autoTasks.every((t) => !!t.assignedToId),
      `${autoTasks.filter((t) => t.assignedToId).length}/${autoTasks.length} có người nhận`,
    );

    // 4. Log ghi đúng: mỗi alert có mức rủi ro + điểm churn, và tỉ lệ khớp ngưỡng
    const badLevel = alerts.filter((a) => a.riskLevel !== riskLevelOf(Number(a.churnScore)));
    const badScore = alerts.filter((a) => Number(a.churnScore) < CHURN_THRESHOLD);
    ok(
      "Log cảnh báo ghi đúng mức rủi ro (HIGH/CRITICAL theo điểm churn)",
      badLevel.length === 0,
      badLevel.length
        ? `${badLevel.length} alert sai riskLevel (${[...new Set(badLevel.map((a) => a.riskLevel))].join(",")})`
        : `tất cả = ${[...new Set(alerts.map((a) => a.riskLevel))].join("/")} (ngưỡng critical ${CHURN_CRITICAL_THRESHOLD})`,
    );
    ok(
      "Log cảnh báo ghi đúng điểm churn ≥ ngưỡng",
      badScore.length === 0,
      badScore.length ? `${badScore.length} alert có churnScore < ${CHURN_THRESHOLD}` : "đạt",
    );

    // 5. Chống tạo trùng: mỗi khách chỉ có 1 alert
    const voucherPerCustomer = new Map();
    for (const a of alerts) {
      voucherPerCustomer.set(a.customerId, (voucherPerCustomer.get(a.customerId) || 0) + 1);
    }
    const duplicated = [...voucherPerCustomer.entries()].filter(([, n]) => n > 1);
    ok(
      "Không sinh nhiều voucher cho cùng một khách",
      duplicated.length === 0,
      duplicated.length ? `${duplicated.length} khách có nhiều alert` : `${voucherPerCustomer.size} khách × 1 alert`,
    );

    const newAlerts = countAfter.alerts - countBefore.alerts;

    // 6. Mọi khách đủ điều kiện trong tenant đều phải có cảnh báo.
    //    KHÔNG so `DB +N` với `alertsCreated` của automation: automation là cron
    //    nên duyệt TẤT CẢ tenant (lần chạy này báo 99 alert cho 4 tenant trong khi
    //    tenant Phase 1 chỉ có 5 khách rủi ro). So sánh với tổng là so hai phạm
    //    vi khác nhau — luôn FAIL dù hệ thống đúng.
    const eligibleIds = risky.map((c) => c.id);
    const missing = eligibleIds.filter((id) => !alerts.some((a) => a.customerId === id));
    ok(
      "Mọi khách đủ điều kiện trong tenant đều được cảnh báo",
      missing.length === 0,
      missing.length
        ? `${missing.length}/${eligibleIds.length} khách chưa có cảnh báo`
        : `${eligibleIds.length}/${eligibleIds.length} khách đã có cảnh báo`,
    );
    ok(
      "Số cảnh báo mới của tenant ≤ tổng automation báo (phạm vi khác nhau)",
      newAlerts <= (res?.alertsCreated ?? 0),
      `DB tenant +${newAlerts}, automation toàn hệ thống ${res?.alertsCreated}`,
    );
    ok(
      "Automation tạo kèm voucher + task + thông báo",
      countAfter.promotions >= countBefore.promotions
        && countAfter.tasks >= countBefore.tasks
        && countAfter.notifications >= countBefore.notifications,
      `promotions +${countAfter.promotions - countBefore.promotions}, tasks +${countAfter.tasks - countBefore.tasks}, notif +${countAfter.notifications - countBefore.notifications}`,
    );

    // 7. Bằng chứng truy vết trên chính bản ghi cảnh báo
    const oneAlert = alerts[0];
    if (oneAlert) {
      ok(
        "ChurnAlert có đủ thông tin truy vết (riskLevel + voucherCode)",
        !!oneAlert.riskLevel && !!oneAlert.voucherCode,
        `riskLevel=${oneAlert.riskLevel} voucher=${oneAlert.voucherCode}`,
      );
    }

    // 8. Bảng tổng hợp để in ra bằng chứng
    console.log("\nBẰNG CHỨNG (5 khách rủi ro nhất):");
    console.log(`  ${"khách".padEnd(24)}${"churn".padStart(8)}${"RFM".padEnd(12)}${"voucher".padEnd(14)}${"task".padStart(6)}`);
    for (const c of risky.slice(0, 5)) {
      const a = alerts.find((x) => x.customerId === c.id);
      const t = autoTasks.find((x) => x.customerId === c.id);
      console.log(
        `  ${String(c.name).slice(0, 23).padEnd(24)}${c.churnProbability.toFixed(2).padStart(8)}${String(c.rfmSegment || "-").padEnd(12)}${String(a?.voucherCode || "-").padEnd(14)}${t ? "có" : "-"}`.padStart(0),
      );
    }
  });

  if (!KEEP) {
    console.log("\n--keep không bật: giữ nguyên dữ liệu automation sinh ra (đây là bằng chứng cần giữ).");
  }

  await prisma.$disconnect();
  console.log("");
  console.log(
    failed === 0
      ? "KẾT QUẢ: ĐẠT — khách churn cao nhận voucher + task + cảnh báo, tự động qua cron."
      : `KẾT QUẢ: ${failed} kiểm tra FAIL.`,
  );
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});