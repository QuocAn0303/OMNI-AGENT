/**
 * Smoke Phase 4 — chạy chấm điểm RFM/CLV/churn thật rồi gọi getCustomerInsights().
 * Mục đích: chứng minh endpoint MỚI đọc được dữ liệu thật, không chỉ pass unit test
 * với mock rỗng.
 *
 * Chạy: node scripts/smoke-crm-phase4-insights.js
 * Giữ dữ liệu (để xem trang FE): -- --keep
 */
require("dotenv").config(); // phải trước khi require prisma — config/prisma.js đọc process.env.DATABASE_URL lúc load
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const rfmService = require("../src/modules/customers/rfm.service");
const clvService = require("../src/modules/customers/clv-forecast.service");
const churnService = require("../src/modules/customers/churn-automation.service");
const analyticsService = require("../src/modules/analytics/analytics.service");

const KEEP = process.argv.includes("--keep");
let pass = 0;
let fail = 0;

const check = (label, cond, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`  OK   ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

const section = (t) => console.log(`\n${t}`);

/**
 * Dò trong object bất kỳ chuỗi nào là số ("5192000") — dấu hiệu Decimal của Prisma
 * chưa được chuyển về number.
 *
 * Bỏ qua các key vốn dĩ là chuỗi: phone/email/id là text, tier/segment là enum.
 * Không có ngoại lệ này detector bắt nhầm "0327283626" (số điện thoại) và báo
 * FAIL giả — phải thử mới thấy.
 */
const STRING_BY_NATURE = new Set([
  "id", "phone", "email", "name", "avatar", "tier", "rfmSegment",
  "segment", "campaignName", "channel", "status", "fullName", "code",
]);

const findStringNumbers = (node, path = "$", key = "", acc = []) => {
  if (typeof node === "string") {
    const natural = STRING_BY_NATURE.has(key);
    if (!natural && node.trim() !== "" && Number.isFinite(Number(node))) {
      acc.push(`${path}="${node}"`);
    }
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => findStringNumbers(v, `${path}[${i}]`, key, acc));
    return acc;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) findStringNumbers(v, `${path}.${k}`, k, acc);
  }
  return acc;
};

/**
 * Reset toàn bộ chỉ số chấm điểm về NULL — đưa DB về trạng thái trước khi smoke.
 * KHÔNG xoá customer/order (chỉ số là dữ liệu cache, cron sẽ tính lại).
 *
 * Lọc phải theo MỌI cột chấm điểm, không chỉ rfmSegment/clvPredicted — lần trước
 * lọc thiếu `churnProbability` nên sót khách chỉ có churn, và lần smoke kế tiếp
 * đọc dữ liệu cũ rồi fail ở check "baseline phải rỗng".
 *
 * Tách thành hàm để catch gọi được — bản đầu tiên chỉ reset ở cuối luồng thành
 * công, nên script lỗi giữa chừng làm sót chỉ số.
 */
const resetScores = async () => {
  if (KEEP) {
    console.log("\n  --keep: giữ chỉ số chấm điểm để xem trang FE.");
    return;
  }
  const reset = await prisma.customer.updateMany({
    where: {
      OR: [
        { rfmSegment: { not: null } },
        { rfmFrequency: { not: null } },
        { rfmMonetary: { not: null } },
        { rfmRecencyDays: { not: null } },
        { clvPredicted: { not: null } },
        { churnProbability: { not: null } },
      ],
    },
    data: {
      rfmSegment: null, rfmRecencyDays: null, rfmFrequency: null,
      rfmMonetary: null, rfmScoredAt: null, clvPredicted: null,
      clvScoredAt: null, churnProbability: null,
    },
  });
  console.log(`  Đã reset chỉ số chấm điểm của ${reset.count} khách hàng.`);

  // Verify: phải thực sự sạch, nếu không lần smoke sau sẽ đọc dữ liệu cũ
  const leftover = await prisma.customer.count({
    where: { OR: [{ rfmSegment: { not: null } }, { clvPredicted: { not: null } }, { churnProbability: { not: null } }] },
  });
  if (leftover > 0) {
    fail += 1;
    console.log(`  FAIL còn ${leftover} khách chưa reset`);
  } else {
    pass += 1;
    console.log("  OK   reset sạch, lần smoke sau sẽ thấy baseline rỗng");
  }
};

(async () => {
// Phải duyệt TẤT CẢ tenant, không `take: 3` — trước đó script lấy 3 tenant đầu
// tùy ý nên có thể trượt tenant thật (chỉ có dữ liệu ở "CANDORY SCENT") rồi báo
// "chấm RFM được 0 khách" — sai, vì chạy nhầm chỗ chứ không phải service hỏng.
const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
console.log(`Tenant dùng để test: ${tenants.length}`);

  // ---------------------------------------------------------------- baseline
  section("1. Baseline — trước khi chạy chấm điểm");
  const before = await prisma.customer.count({
    where: { rfmSegment: { not: null } },
  });
  check("chưa có ai được chấm RFM (hoặc đã có từ cron)", typeof before === "number", `rfmSegment!=null = ${before}`);

  const empty = await analyticsService.getCustomerInsights();
  check(
    "getCustomerInsights chạy được khi CHƯA có dữ liệu RFM",
    empty && Array.isArray(empty.rfmSegments),
    `totals=${JSON.stringify(empty.totals)}`,
  );
  check(
    "vẫn trả đủ 5 phân khúc RFM kể cả khi rỗng",
    empty.rfmSegments.length === 5,
    `segments=${empty.rfmSegments.map((s) => s.segment).join(",")}`,
  );
  check(
    "unscored = active - scored (không âm)",
    empty.totals.unscoredCustomers >= 0,
    `active=${empty.totals.activeCustomers} scored=${empty.totals.scoredCustomers} unscored=${empty.totals.unscoredCustomers}`,
  );
  check("clv/churn null-safe khi rỗng", empty.clv.total === 0 && empty.churn.average === null);

  // ---------------------------------------------------------------- chấm điểm
  section("2. Chạy chấm điểm thật (rfm → clv → churn)");
  let rfmTotal = 0;
  for (const t of tenants) {
    const r = await runWithTenant(t.id, async () => {
      const m = await rfmService.runForTenant();
      const c = await clvService.runForTenant();
      // churn-automation không có runForTenant (chỉ có runAllTenants + closeLoopForTenant)
      const ch = await churnService.runAllTenants();
      return { m, c, ch };
    });
    rfmTotal += r.m.scored ?? 0;
    console.log(
      `  tenant ${t.name}: rfm=${JSON.stringify(r.m)} clv customers=${r.c.customers}` +
      ` churn=${JSON.stringify(r.ch)}`,
    );
  }

  const scoredRfm = await prisma.customer.count({ where: { rfmSegment: { not: null } } });
  check("đã chấm RFM cho ít nhất 1 khách", scoredRfm > 0, `rfmSegment!=null = ${scoredRfm}`);

  const scoredClv = await prisma.customer.count({ where: { clvPredicted: { not: null } } });
  const scoredChurn = await prisma.customer.count({ where: { churnProbability: { not: null } } });
  console.log(`  clvPredicted!=null = ${scoredClv}, churnProbability!=null = ${scoredChurn}`);

  // ---------------------------------------------------------------- endpoint
  section("3. getCustomerInsights() với DỮ LIỆU THẬT");
  const out = await analyticsService.getCustomerInsights();
  console.log(
    `  totals=${JSON.stringify(out.totals)}\n  churn=${JSON.stringify(out.churn)}\n  clv=${JSON.stringify(out.clv)}`,
  );

  check("totals.activeCustomers > 0", out.totals.activeCustomers > 0, `${out.totals.activeCustomers}`);
  check(
    "scored + unscored == active",
    out.totals.scoredCustomers + out.totals.unscoredCustomers === out.totals.activeCustomers,
    `${out.totals.scoredCustomers} + ${out.totals.unscoredCustomers} == ${out.totals.activeCustomers}`,
  );
  check("vẫn trả đủ 5 phân khúc RFM", out.rfmSegments.length === 5);
  check(
    "tổng số khách trong các phân khúc khớp scoredCustomers",
    out.rfmSegments.reduce((s, x) => s + x.count, 0) === out.totals.scoredCustomers,
    `${out.rfmSegments.reduce((s, x) => s + x.count, 0)} == ${out.totals.scoredCustomers}`,
  );
  check(
    "mọi giá trị số đều là NUMBER, không phải string (Decimal của Prisma)",
    // Bug thật: cột Decimal serialize ra JSON thành string → FE tự parse,
    // so sánh/sắp xếp sai. Unit test với mock số KHÔNG bắt được, chỉ DB thật mới lộ.
    findStringNumbers(out).length === 0,
    findStringNumbers(out).length ? `còn string: ${findStringNumbers(out).slice(0, 5).join(", ")}` : "",
  );
  check(
    "churnProbability là number",
    out.atRisk.every((c) => typeof c.churnProbability === "number"),
  );
  check(
    "topClv.totalSpent là number",
    out.topClv.every((c) => typeof c.totalSpent === "number"),
  );
  check(
    "atRisk.clvPredicted là number hoặc null",
    out.atRisk.every((c) => c.clvPredicted === null || typeof c.clvPredicted === "number"),
  );
  check(
    "JSON serialize được (không Decimal object)",
    JSON.stringify(out).length > 0,
    `json length=${JSON.stringify(out).length}`,
  );
  check(
    "avgMonetary là number hoặc null (không phải Decimal object)",
    out.rfmSegments.every((s) => s.avgMonetary === null || typeof s.avgMonetary === "number"),
  );
  check(
    "clv.total là number",
    typeof out.clv.total === "number" && !Number.isNaN(out.clv.total),
    `${out.clv.total}`,
  );
  check(
    "tiers có dữ liệu",
    out.tiers.length > 0,
    out.tiers.map((x) => `${x.tier}:${x.count}`).join(" "),
  );
  check(
    "atRisk tôn trọng ngưỡng 0.5",
    out.atRisk.every((c) => Number(c.churnProbability) >= 0.5),
    `${out.atRisk.length} khách`,
  );
  check(
    "topClv sort giảm dần",
    out.topClv.every((c, i, a) => i === 0 || a[i - 1].clvPredicted >= c.clvPredicted),
  );
  check("atRisk và topClv là mảng", Array.isArray(out.atRisk) && Array.isArray(out.topClv));

  console.log(`\n--- rfmSegments ---\n${JSON.stringify(out.rfmSegments, null, 1)}`);
  console.log(`--- tiers ---\n${JSON.stringify(out.tiers, null, 1)}`);
  console.log(`--- topClv (3 đầu) ---\n${JSON.stringify(out.topClv.slice(0, 3), null, 1)}`);
  console.log(`--- atRisk (3 đầu) ---\n${JSON.stringify(out.atRisk.slice(0, 3), null, 1)}`);

  // ---------------------------------------------------------------- dọn dẹp
  section("4. Dọn dẹp");
  await resetScores();

  console.log(`\n--- Kết quả: ${pass} pass / ${fail} fail ---`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("SMOKE ERROR:", e.message);
  console.error(e.stack?.split("\n").slice(0, 6).join("\n"));
  // Dọn dẹp VẪN phải chạy khi script lỗi — nếu không, chỉ số chấm điểm sót lại và
  // lần smoke sau đọc dữ liệu cũ rồi fail ở check "baseline phải rỗng".
  try { await resetScores(); } catch (ce) { console.error("cleanup lỗi:", ce.message); }
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});