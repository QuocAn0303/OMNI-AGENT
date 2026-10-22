/**
 * scripts/check-evidence-http.js — Kiểm chứng HTTP THẬT của màn hình bằng chứng.
 *
 * Gọi đúng như trình duyệt gọi: đăng nhập → GET /api/evidence/backtest →
 * GET /api/evidence/live-snapshot. Bắt buộc chạy backend thật (npm run dev).
 */
require("dotenv").config();
const prisma = require("../src/config/prisma");

const BASE = `http://localhost:${process.env.PORT || 4000}`;
let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`${c ? "OK  " : "FAIL"} | ${l}${e ? " -> " + e : ""}`); c ? pass++ : fail++; };

(async () => {
  console.log(`\n=== HTTP THẬT: /api/evidence (${BASE}) ===\n`);

  // Lấy tài khoản demo từ DB để không hard-code mật khẩu vào script.
  const tenant = await prisma.tenant.findUnique({ where: { slug: "omni-demo-mo-phong" }, select: { id: true } });
  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { email: true },
  });
  const PW = process.env.DEMO_PASSWORD || "Demo123456";

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: PW }),
  });
  ok("đăng nhập được", login.ok, `HTTP ${login.status}`);
  if (!login.ok) { console.log((await login.text()).slice(0, 300)); await prisma.$disconnect(); process.exit(1); }
  const token = (await login.json()).data.token;
  const H = { Authorization: `Bearer ${token}` };

  const r1 = await fetch(`${BASE}/api/evidence/backtest?leadTime=7`, { headers: H });
  ok("GET /evidence/backtest", r1.ok, `HTTP ${r1.status}`);
  const d1 = (await r1.json()).data;
  ok("  có kết quả thực nghiệm", d1.available === true);
  ok("  kèm NGUỒN dữ liệu (sha256)", !!d1.source?.sha256, String(d1.source?.sha256).slice(0, 16) + "…");
  ok("  kèm DANH SÁCH GIỚI HẠN", Array.isArray(d1.caveats) && d1.caveats.length >= 3, `${d1.caveats?.length} dòng`);
  ok("  có đủ 4 phương án", Object.keys(d1.policies || {}).length === 4, Object.keys(d1.policies || {}).join(","));
  ok("  đối chiếu đúng NHÓN tiếng Việt", !!d1.comparison?.baselineName, d1.comparison?.baselineName);
  ok("  kết luận trung thực (có verdict)", typeof d1.comparison?.verdict === "string" && d1.comparison.verdict.length > 10, d1.comparison?.verdict);
  ok("  phân biệt được họ phương án", d1.comparison?.baselineKey !== d1.comparison?.systemKey,
     `${d1.comparison?.baselineKey} vs ${d1.comparison?.systemKey}`);

  // Tham số khác phải ra kết quả khác — chứng minh UI đổi kịch bản thật sự hoạt động.
  // Cùng cửa sổ đo (tháng) là ĐÚNG — tham số lead time không đổi cửa sổ thời gian.
  // Thứ phải khác là CHÍ SỐ của phương án, vì lead time nằm trong công thức ROP/SS.
  const r2 = await fetch(`${BASE}/api/evidence/backtest?leadTime=14&branch=A`, { headers: H });
  const d2 = (await r2.json()).data;
  const p1of = (d) => d.policies[Object.keys(d.policies)[0]]?.totalCost;
  ok("đổi thời gian nhập → tham số đúng kịch bản", d2.params?.leadTimeDays === 14, `LT=${d2.params?.leadTimeDays}`);
  ok("  và CHÍ SỐ thay đổi theo (cùng cửa sổ đo)", p1of(d1) !== p1of(d2),
     `tổng chi phí P1: LT7=${p1of(d1)} → LT14=${p1of(d2)}`);

  const r3 = await fetch(`${BASE}/api/evidence/live-snapshot`, { headers: H });
  ok("GET /evidence/live-snapshot", r3.ok, `HTTP ${r3.status}`);
  const l = (await r3.json()).data;
  ok("  số đo THẬT của tenant", typeof l.activeSkus === "number" && l.activeSkus > 0, `${l.activeSkus} SKU, dưới ngưỡng ${l.belowMinStock}`);

  // Không đăng nhập thì phải bị chặn — bằng chứng là có phân quyền.
  const r4 = await fetch(`${BASE}/api/evidence/backtest`);
  ok("chặn truy cập khi chưa đăng nhập", r4.status === 401, `HTTP ${r4.status}`);

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  console.error("Cần backend đang chạy: npm run dev");
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});