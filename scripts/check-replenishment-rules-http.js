/**
 * scripts/check-replenishment-rules-http.js — HTTP THẬT cho API quy tắc nhập hàng.
 * Cần backend đang chạy (npm run dev).
 */
require("dotenv").config();
const prisma = require("../src/config/prisma");
const BASE = `http://localhost:${process.env.PORT || 4000}`;

let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`${c ? "OK  " : "FAIL"} | ${l}${e ? " -> " + e : ""}`); c ? pass++ : fail++; };

(async () => {
  console.log(`\n=== HTTP THẬT: /api/inventory/rules (${BASE}) ===\n`);

  const tenant = await prisma.tenant.findUnique({ where: { slug: "omni-demo-mo-phong" }, select: { id: true } });
  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id, isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { email: true },
  });

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: process.env.DEMO_PASSWORD || "Demo123456" }),
  });
  ok("đăng nhập được", login.ok, `HTTP ${login.status}`);
  if (!login.ok) { await prisma.$disconnect(); process.exit(1); }
  const H = { Authorization: `Bearer ${(await login.json()).data.token}`, "Content-Type": "application/json" };

  const g = await fetch(`${BASE}/api/inventory/rules`, { headers: H });
  ok("GET /inventory/rules", g.ok, `HTTP ${g.status}`);
  const rows = await g.json();
  const list = rows.data || [];
  ok("  trả về quy tắc kèm thông tin sản phẩm + kho",
     Array.isArray(list) && list.length > 0 && !!list[0].product?.sku,
     `${list.length} dòng, ví dụ ${list[0]?.product?.sku} @ ${list[0]?.warehouse?.name}`);
  ok("  có đủ 4 tham số quy tắc",
     list[0] && "maxStock" in list[0] && "leadTimeDays" in list[0] &&
     "packMultiple" in list[0] && "serviceLevel" in list[0]);

  if (!list.length) { await prisma.$disconnect(); process.exit(1); }
  const target = list[0];
  const orig = {
    maxStock: target.maxStock, leadTimeDays: target.leadTimeDays,
    packMultiple: target.packMultiple, serviceLevel: target.serviceLevel, minStock: target.minStock,
  };

  // PUT hợp lệ
  const put = await fetch(`${BASE}/api/inventory/rules`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ inventoryId: target.id, maxStock: 321, leadTimeDays: 14, packMultiple: 6, serviceLevel: 0.9 }),
  });
  ok("PUT /inventory/rules (giá trị hợp lệ)", put.ok, `HTTP ${put.status}`);
  const saved = (await put.json()).data;
  ok("  lưu đúng giá trị",
     saved.maxStock === 321 && saved.leadTimeDays === 14 && saved.packMultiple === 6 && saved.serviceLevel === 0.9,
     `max=${saved.maxStock} lt=${saved.leadTimeDays} pack=${saved.packMultiple} sl=${saved.serviceLevel}`);

  // PUT sai miền giá trị → phải bị chặn, KHÔNG ghi
  const bad1 = await fetch(`${BASE}/api/inventory/rules`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ inventoryId: target.id, maxStock: -3 }),
  });
  ok("PUT maxStock âm bị chặn (400)", bad1.status === 400, `HTTP ${bad1.status}`);

  const bad2 = await fetch(`${BASE}/api/inventory/rules`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ inventoryId: target.id, serviceLevel: 1.5 }),
  });
  ok("PUT serviceLevel = 1,5 bị chặn (400)", bad2.status === 400, `HTTP ${bad2.status}`);

  const after = (await (await fetch(`${BASE}/api/inventory/rules`, { headers: H })).json()).data
    .find((r) => r.id === target.id);
  ok("  giá trị sai KHÔNG bị ghi vào DB",
     after.maxStock === 321 && after.leadTimeDays === 14,
     `max=${after.maxStock} lt=${after.leadTimeDays}`);

  // Bỏ cấu hình = null
  const clear = await fetch(`${BASE}/api/inventory/rules`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ inventoryId: target.id, maxStock: null, leadTimeDays: null, serviceLevel: null, packMultiple: 1 }),
  });
  ok("PUT bỏ cấu hình (null = về mặc định)", clear.ok, `HTTP ${clear.status}`);
  const cleared = (await clear.json()).data;
  ok("  quy tắc về đúng trạng thái chưa cấu hình",
     cleared.maxStock === null && cleared.leadTimeDays === null && cleared.packMultiple === 1,
     `max=${cleared.maxStock} lt=${cleared.leadTimeDays} pack=${cleared.packMultiple}`);

  // Phân quyền
  const noAuth = await fetch(`${BASE}/api/inventory/rules`);
  ok("chặn khi chưa đăng nhập (401)", noAuth.status === 401, `HTTP ${noAuth.status}`);

  // Trả lại nguyên trạng
  await fetch(`${BASE}/api/inventory/rules`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ inventoryId: target.id, ...orig }),
  });

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
})().catch(async (e) => {
  console.error("LỖI:", e.message, "| Cần backend: npm run dev");
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});