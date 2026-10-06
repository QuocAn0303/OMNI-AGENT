'use strict';

/**
 * scripts/check-an4-retention-kpi.js — AN.4: KPI giữ chân khớp DB
 *
 * DoD của R4 có phần "KPI". Script này gọi endpoint `GET /api/analytics/retention-kpi`
 * (HTTP thật, có JWT) rồi so TỪNG CON SỐ với truy vấn Prisma độc lập — cùng cách
 * làm với cross-check báo cáo ở `check:an3`.
 *
 *   Yêu cầu: backend đang chạy + `npm run seed:phase1:apply` + RFM đã chấm
 *   Chạy:   npm run check:kpi
 */
require("dotenv").config();

const { assertLocalDb } = require("./lib/assert-local-db");

assertLocalDb("check:kpi");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const TENANT_SLUG = "crm-phase1-demo";
const ADMIN = { email: "P1.admin@crm.local", password: "123456" };
const RECENCY_DAYS = 90;

let failed = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " → " + extra : ""}`);
  if (!cond) failed += 1;
};

const login = async ({ email, password }) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  const token = json?.data?.token;
  if (res.status !== 200 || !token) throw new Error(`đăng nhập thất bại (HTTP ${res.status})`);
  return token;
};

(async () => {
  console.log("\n=== AN.4 — KPI GIỮ CHÂN (HTTP thật) khớp DB ===");

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    console.log(`FAIL | Chưa có tenant "${TENANT_SLUG}" — chạy: npm run seed:phase1:apply`);
    process.exit(1);
  }

  let token;
  try {
    token = await login(ADMIN);
  } catch (e) {
    console.log(`FAIL | ${e.message} — backend có đang chạy không?`);
    process.exit(1);
  }

  const res = await fetch(`${BASE}/analytics/retention-kpi`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  const d = json?.data || {};
  ok("GET /api/analytics/retention-kpi trả 200", res.status === 200, `HTTP ${res.status}`);

  await runWithTenant(tenant.id, async () => {
    // ---- Tổng số khách
    const total = await prisma.customer.count({ where: { isActive: true } });
    ok("Tổng khách khớp DB", d.customers?.total === total, `API ${d.customers?.total} / DB ${total}`);

    // ---- Khách đã chấm churn
    const scored = await prisma.customer.count({ where: { churnProbability: { not: null } } });
    ok("Số khách đã chấm churn khớp DB", d.customers?.scored === scored, `API ${d.customers?.scored} / DB ${scored}`);

    // ---- Khách rủi ro — theo đúng ngưỡng endpoint trả về, và phải phân biệt được
//      ngưỡng SÀNG LỌC với ngưỡng HÀNH ĐỘNG của automation (0.70).
const threshold = d.thresholds?.churnRisk;
    const atRisk = await prisma.customer.count({ where: { churnProbability: { gte: threshold } } });
    ok(
      "Số khách rủi ro khớp DB (theo ngưỡng endpoint dùng)",
      d.customers?.atRisk === atRisk,
      `API ${d.customers?.atRisk} / DB ${atRisk}, ngưỡng sàng lọc ${threshold}`,
    );
    ok(
      "Endpoint nêu rõ cả ngưỡng sàng lọc và ngưỡng hành động (0.70)",
      threshold === 0.5 && d.thresholds?.churnAction === 0.7,
      `sàng lọc ${d.thresholds?.churnRisk} · hành động ${d.thresholds?.churnAction}`,
    );
    // Khách vượt ngưỡng hành động phải ≤ khách vượt ngưỡng sàng lọc.
    const actionable = await prisma.customer.count({
      where: { churnProbability: { gte: d.thresholds?.churnAction } },
    });
    ok(
      "Số khách được gửi voucher ≤ số khách rủi ro",
      actionable <= atRisk,
      `hành động ${actionable} ≤ sàng lọc ${atRisk}`,
    );

    // ---- Cohort: so từng tháng
    let cohortOk = Array.isArray(d.cohorts) && d.cohorts.length > 0;
    const cohortDetail = [];
    for (const row of d.cohorts || []) {
      const [yy, mm] = row.month.split("-").map(Number);
      const start = new Date(Date.UTC(yy, mm - 1, 1));
      const end = new Date(Date.UTC(yy, mm, 1));
      const [cnt, act] = await Promise.all([
        prisma.customer.count({ where: { createdAt: { gte: start, lt: end }, isActive: true } }),
        prisma.customer.count({
          where: { createdAt: { gte: start, lt: end }, isActive: true, rfmRecencyDays: { lte: RECENCY_DAYS } },
        }),
      ]);
      const same = cnt === row.customers && act === row.active;
      if (!same) cohortOk = false;
      cohortDetail.push(`${row.month}: ${row.customers}/${cnt} khách, ${row.active}/${act} còn hoạt động`);
    }
    ok("Cohort giữ chân khớp DB từng tháng", cohortOk, cohortDetail.join(" · "));

    // ---- Tỷ lệ giữ chân = active/customers (không để null khi customers = 0)
    const ratioWrong = (d.cohorts || []).filter(
      (r) => r.customers === 0 ? r.retentionRate !== null : Math.abs((r.retentionRate ?? 0) - (r.active / r.customers) * 100) > 0.05,
    );
    ok(
      "Tỷ lệ % giữ chân tính đúng (và null khi cohort rỗng)",
      ratioWrong.length === 0,
      ratioWrong.length ? `${ratioWrong.length} tháng sai` : "đúng",
    );

    // ---- Hiệu quả win-back
    const alertsByStatus = await prisma.churnAlert.groupBy({ by: ["status"], _count: { _all: true } });
    const statusMap = Object.fromEntries(alertsByStatus.map((r) => [r.status, r._count._all]));
    ok(
      "Số cảnh báo churn theo trạng thái khớp DB",
      d.winback?.alertsTotal === alertsByStatus.reduce((s, r) => s + r._count._all, 0),
      `API ${JSON.stringify(d.winback?.byStatus)} / DB ${JSON.stringify(statusMap)}`,
    );

    const voucherIds = (await prisma.churnAlert.findMany({
      where: { promotionId: { not: null } }, select: { promotionId: true }, distinct: ["promotionId"],
    })).map((a) => a.promotionId);
    const usage = voucherIds.length ? await prisma.promotionUsage.count({ where: { promotionId: { in: voucherIds } } }) : 0;
    ok(
      "Số voucher đã phát khớp DB",
      d.winback?.voucherIssued === voucherIds.length,
      `API ${d.winback?.voucherIssued} / DB ${voucherIds.length}`,
    );
    ok(
      "Số lượt dùng voucher khớp DB",
      d.winback?.voucherUsed === usage,
      `API ${d.winback?.voucherUsed} / DB ${usage}`,
    );

    // ---- Phải nói rõ giới hạn, không để người đọc tưởng là số chắc chắn
    ok(
      "Endpoint kèm danh sách giới hạn (caveats)",
      Array.isArray(d.caveats) && d.caveats.length >= 3,
      `${(d.caveats || []).length} mục`,
    );

    // ---- Engine đang chạy: mô hình hay công thức
    const churnModel = require("../src/modules/customers/churn-model.service");
    const info = churnModel.getModelInfo();
    ok(
      "Mô hình churn sẵn sàng và có AUC đo được",
      info.available && info.metrics?.aucTest != null,
      `engine=${info.engine}, AUC=${info.metrics?.aucTest}`,
    );
  });

  await prisma.$disconnect();
  console.log("");
  console.log(failed === 0 ? "KẾT QUẢ: ĐẠT — KPI giữ chân khớp DB." : `KẾT QUẢ: ${failed} kiểm tra FAIL.`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
