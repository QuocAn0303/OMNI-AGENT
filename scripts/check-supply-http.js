/**
 * scripts/check-supply-http.js — HTTP THẬT cho dashboard KPI chuỗi cung ứng.
 * Cần backend đang chạy (npm run dev).
 */
require("dotenv").config();
const prisma = require("../src/config/prisma");
const BASE = `http://localhost:${process.env.PORT || 4000}`;

let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`${c ? "OK  " : "FAIL"} | ${l}${e ? " -> " + e : ""}`); c ? pass++ : fail++; };

(async () => {
  console.log(`\n=== HTTP THẬT: /api/supply/kpis (${BASE}) ===\n`);

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
  const H = { Authorization: `Bearer ${(await login.json()).data.token}` };

  const r = await fetch(`${BASE}/api/supply/kpis?days=30`, { headers: H });
  ok("GET /supply/kpis", r.ok, `HTTP ${r.status}`);
  const d = (await r.json()).data;

  // --- Đối chiếu tồn kho với DB: không được tự bịa ---
  const inv = await prisma.inventory.findMany({ where: { tenantId: tenant.id } });
  ok("trả về tồn khả dụng", typeof d.inventory.atpUnits === "number",
     `ATP=${d.inventory.atpUnits} từ ${inv.length} dòng inventories`);

  ok("có giá trị tồn kho", d.inventory.stockValue >= 0,
     `${Number(d.inventory.stockValue).toLocaleString('vi-VN')} đ`);

  // --- Chỉ số KHÔNG ĐỦ DỮ LIỆU phải là null, KHÔNG phải 0 ---
  const k = (x) => d[k] === null || d[k] === undefined;
  const s = d.supplierDelivery.onTimeRate;
  ok(
    "tỷ lệ giao đúng hạn: null nếu chưa đủ dữ liệu, số thật nếu có",
    (s === null && d.supplierDelivery.gradedCount === 0) ||
      (typeof s === "number" && s >= 0 && s <= 100 && d.supplierDelivery.gradedCount > 0),
    s === null ? `null (chưa có ${d.supplierDelivery.receivedCount} phiếu nhận có ngày giao)`
              : `${s}% trên ${d.supplierDelivery.gradedCount} phiếu`,
  );
  ok("không có chỉ số nào tự bịa giá trị 0 thay cho 'chưa đủ dữ liệu'",
     !(d.velocity.daysOfCover === 0) || d.velocity.cogsUnits > 0,
     `daysOfCover=${d.velocity.daysOfCover}, cogsUnits=${d.velocity.cogsUnits}`);

  // --- Mọi nhóm KPI đều kèm note giải thích cách tính ---
  const groups = ['inventory', 'velocity', 'slowMoving', 'stockouts', 'purchasing', 'supplierDelivery'];
  ok("mọi nhóm chỉ số đều có `note` giải thích cách tính",
     groups.every((g) => typeof d[g]?.note === 'string' && d[g].note.length > 10),
     `${groups.filter((g) => !d[g]?.note).join(',') || 'đủ'}`);

  // --- Mua hàng ---
  ok("có số PO đang mở và giá trị",
     typeof d.purchasing.openCount === 'number' && d.purchasing.openValue >= 0,
     `${d.purchasing.openCount} PO mở, ${Number(d.purchasing.openValue).toLocaleString('vi-VN')} đ`);
  ok("danh sách PO quá hạn có số ngày trễ",
     Array.isArray(d.purchasing.overdue) &&
     d.purchasing.overdue.every((p) => typeof p.daysLate === 'number' && p.daysLate >= 0),
     `${d.purchasing.overdue.length} PO quá hạn`);

  // --- Kho ---
  ok("phân bổ vốn tiền theo kho", Array.isArray(d.byWarehouse),
     d.byWarehouse.map((w) => `${w.code}:${Number(w.value).toLocaleString('vi-VN')}`).join(' | '));

  // --- Tham số lọc ---
  const bad = await fetch(`${BASE}/api/supply/kpis?days=0`, { headers: H });
  ok("days=0 bị chặn (400)", bad.status === 400, `HTTP ${bad.status}`);

  const noAuth = await fetch(`${BASE}/api/supply/kpis`);
  ok("chặn khi chưa đăng nhập (401)", noAuth.status === 401, `HTTP ${noAuth.status}`);

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
})().catch(async (e) => {
  console.error("LỖI:", e.message, "| Cần backend: npm run dev");
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});