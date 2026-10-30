'use strict';

/**
 * scripts/verify-seed-volume.js — BẰNG CHỨNG cho hạng mục R1 / AN.1
 * "đếm được >= 300 dòng mỗi bảng"
 *
 * Script này CHỈ ĐỌC, không ghi gì. Nó in ra bảng số dòng thật của 9 bảng CRM
 * trong tenant Phase 1 và THOÁT VỚI MÃ LỖI nếu bảng nào chưa đạt ngưỡng — để
 * khi trình bày, mở terminal chạy một lệ là có bảng số liệu ngay.
 *
 * Dùng:
 *   npm run verify:phase1
 *   node scripts/verify-seed-volume.js --tenant crm-phase1-demo   # tenant khác
 *   node scripts/verify-seed-volume.js --min 500 --json          # ngưỡng khác, xuất JSON
 *
 * Mã thoát: 0 = tất cả đạt, 1 = có bảng chưa đạt.
 */

require("dotenv").config();

const { assertLocalDb } = require("./lib/assert-local-db");

assertLocalDb("verify:phase1");

const prisma = require("../src/config/prisma");

const DEFAULT_TENANT = "crm-phase1-demo";
const DEFAULT_MIN = 300;

/**
 * Bảng cần kiểm chứng + cách đếm.
 * Ghi rõ tên bảng trong Postgres (khác tên model của Prisma) để khi đối chiếu
 * với `psql` / TableTree trên DataGrip thì khớp ngay.
 */
const CHECKS = [
  { table: "products", label: "sản phẩm", count: (tid) => prisma.product.count({ where: { tenantId: tid } }) },
  { table: "customers", label: "khách hàng", count: (tid) => prisma.customer.count({ where: { tenantId: tid } }) },
  { table: "orders", label: "đơn hàng", count: (tid) => prisma.order.count({ where: { tenantId: tid } }) },
  { table: "order_items", label: "chi tiết đơn", count: (tid) => prisma.orderItem.count({ where: { tenantId: tid } }) },
  { table: "payments", label: "thanh toán", count: (tid) => prisma.payment.count({ where: { tenantId: tid } }) },
  { table: "crm_leads", label: "lead", count: (tid) => prisma.crmLead.count({ where: { tenantId: tid } }) },
  { table: "crm_deals", label: "deal", count: (tid) => prisma.crmDeal.count({ where: { tenantId: tid } }) },
  { table: "crm_communications", label: "tương tác", count: (tid) => prisma.crmCommunication.count({ where: { tenantId: tid } }) },
  { table: "customer_tasks", label: "công việc CSKH", count: (tid) => prisma.customerTask.count({ where: { tenantId: tid } }) },
];

/** Vài con số phụ giúp dữ liệu mẫu "nhìn như thật" chứ không phải bảng rỗng có số. */
const detailStats = async (tenantId) => {
  const [byOrderStatus, byPayStatus, byLeadStatus, byDealKind, byTaskStatus, byCommType] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["paymentStatus"], where: { tenantId }, _count: { _all: true } }),
    prisma.crmLead.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    prisma.crmDeal.groupBy({ by: ["kind"], where: { tenantId }, _count: { _all: true } }),
    prisma.customerTask.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    prisma.crmCommunication.groupBy({ by: ["type"], where: { tenantId }, _count: { _all: true } }),
  ]);
  // groupBy trả về key đúng tên cột: `status` cho order/task/lead, `kind` cho
  // deal, `type` cho communication, `paymentStatus` cho order.
  const toMap = (rows) =>
    Object.fromEntries(rows.map((r) => [r.status || r.kind || r.type || r.paymentStatus, r._count._all]));
  return {
    donTheoTrangThai: toMap(byOrderStatus),
    donTheoThanhToan: toMap(byPayStatus),
    leadTheoTrangThai: toMap(byLeadStatus),
    dealTheoKind: toMap(byDealKind),
    taskTheoTrangThai: toMap(byTaskStatus),
    tuongTacTheoLoai: toMap(byCommType),
  };
};

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const out = { tenant: DEFAULT_TENANT, min: DEFAULT_MIN, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--tenant") out.tenant = String(argv[++i] ?? "");
    else if (argv[i] === "--min") out.min = Number(argv[++i]);
    else if (argv[i] === "--json") out.json = true;
  }
  if (!Number.isFinite(out.min) || out.min <= 0) out.min = DEFAULT_MIN;
  return out;
};

async function main() {
  const args = parseArgs();

  const tenant = await prisma.tenant.findUnique({
    where: { slug: args.tenant },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    console.error(`[verify:phase1] KHÔNG có tenant slug="${args.tenant}".`);
    console.error("[verify:phase1] Chạy `npm run seed:phase1` trước.");
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const rows = [];
  for (const c of CHECKS) {
    const n = await c.count(tenant.id);
    rows.push({ table: c.table, label: c.label, rows: n, ok: n >= args.min });
  }
  const detail = await detailStats(tenant.id);
  const missing = rows.filter((r) => !r.ok);

  if (args.json) {
    console.log(JSON.stringify({ tenant: tenant.slug, min: args.min, rows, detail }, null, 2));
  } else {
    console.log(`\n=== KIỂM CHỨNG DỮ LIỆU MẪU — tenant "${tenant.name}" (${tenant.slug}) ===`);
    console.log(`  ngày kiểm tra: ${new Date().toLocaleString("vi-VN")}`);
    console.log("");
    console.log(`  ${"bảng".padEnd(22)}${"mô tả".padEnd(16)}${"số dòng".padStart(9)}   >= ${args.min}?`);
    console.log(`  ${"-".repeat(60)}`);
    for (const r of rows) {
      console.log(`  ${r.table.padEnd(22)}${r.label.padEnd(16)}${String(r.rows).padStart(9)}   ${r.ok ? "OK" : "THIẾU"}`);
    }
    console.log("");
    console.log("  Phân bố dữ liệu mẫu:");
    console.log(`    đơn theo trạng thái     : ${JSON.stringify(detail.donTheoTrangThai)}`);
    console.log(`    đơn theo thanh toán     : ${JSON.stringify(detail.donTheoThanhToan)}`);
    console.log(`    lead theo trạng thái    : ${JSON.stringify(detail.leadTheoTrangThai)}`);
    console.log(`    deal theo kết quả       : ${JSON.stringify(detail.dealTheoKind)}`);
    console.log(`    công việc theo trạng thái: ${JSON.stringify(detail.taskTheoTrangThai)}`);
    console.log(`    tương tác theo loại     : ${JSON.stringify(detail.tuongTacTheoLoai)}`);
    console.log("");
    console.log(
      missing.length
        ? `  KẾT QUẢ: ${missing.length}/${rows.length} bảng CHƯA đạt ngưỡng ${args.min}.`
        : `  KẾT QUẢ: ĐẠT — ${rows.length}/${rows.length} bảng có >= ${args.min} dòng.`,
    );
    console.log("");
  }

  await prisma.$disconnect();
  if (missing.length) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("[verify:phase1] lỗi:", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
