'use strict';

/**
 * scripts/demo/snapshot-demo.js — `npm run demo:snapshot`
 *
 * ============================================================================
 * VÌ SAO FILE NÀY TỒN TẠI
 * ============================================================================
 * Demo trên UI **tiêu tốn dữ liệu**: bấm "Duyệt" là sinh PO thật, bấm "Ghi sổ cái"
 * ở GRN là cộng tồn + ghi bút toán + dựng công nợ NCC. Xong buổi trình bày, tenant
 * demo **không còn ở trạng thái ban đầu** ⇒ buổi sau bấm lại thì:
 *   - SKU đã có PO đang trên đường (`onOrder > 0`) ⇒ hệ thống cố ý KHÔNG sinh
 *     đề xuất trùng ⇒ nút "Tạo đề xuất" trả về rỗng/không bấm được;
 *   - thẻ duyệt đã ở trạng thái APPROVED ⇒ màn "Duyệt đề xuất nhập" trống.
 *
 * Có hai cách đưa về trạng thái cũ:
 *   1. dựng lại toàn bộ dataset (`data:import` / `scripts/seed/supermarket`) —
 *      mất vài phút và phụ thuộc đúng tham số lần trước;
 *   2. **chụp trạng thái trước buổi demo rồi hoàn nguyên** — vài giây, đúng bằng
 *      những gì đã có. Đây là cách script này + `restore-demo.js` làm.
 *
 * VÌ SAO CHỤP "GIÁ TRỊ" CHỨ KHÔNG CHỤP SỐ DÒNG:
 *   GRN cộng tồn kho và **đổi giá vốn trung bình** (`Product.costPrice`), bán hàng
 *   trừ tồn và cộng `Customer.totalSpent`. Đếm số dòng thấy "0 bảng thay đổi" mà
 *   số thực tế vẫn lệch — đúng cái bẫy `smoke:demo-flow` đã ghi lại. Vì vậy tệp
 *   snapshot ghi luôn: tồn kho (quantity/reserved), giá vốn, tổng chi/tổng nợ khách,
 *   trạng thái PO, và số dòng từng bảng để **đo lại** sau khi hoàn nguyên.
 *
 * AN TOÀN: chỉ đọc, không ghi DB; chỉ chạy trên DB local (`assertLocalDb`).
 *
 *   npm run demo:snapshot                  # chụp (ghi đè tệp cũ)
 *   npm run demo:snapshot -- --label "trước buổi demo 16/10"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('demo:snapshot');

const prisma = require(path.join(ROOT, 'src/config/prisma'));
const { runWithTenant } = require(path.join(ROOT, 'src/config/tenantContext'));
const { DEMO_SLUG, captureTenantCounts } = require('./demo-flow');

const OUT_FILE = path.join(ROOT, 'data', 'demo-snapshot.json');
const VERSION = 1;

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const num = (v) => Number(v || 0);

/** Tách khối để không đụng giới hạn tham số của Prisma khi dataset lớn. */
async function chunked(model, tenantId, select, chunk = 2000) {
  const out = [];
  let skip = 0;
  for (;;) {
    const rows = await runWithTenant(tenantId, () =>
      prisma[model].findMany({ where: { tenantId }, select, skip, take: chunk, orderBy: { id: 'asc' } }),
    );
    out.push(...rows);
    if (rows.length < chunk) break;
    skip += chunk;
  }
  return out;
}

async function main() {
  const label = argOf('label');
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, name: true, slug: true } });
  if (!tenant) {
    console.error(`[demo:snapshot] KHÔNG có tenant demo ${DEMO_SLUG}.\n[demo:snapshot] Chạy trước: npm run data:import -- --reset --apply`);
    process.exit(1);
  }
  const tid = tenant.id;

  console.log(`[demo:snapshot] tenant: ${tenant.name} (${tid})`);
  console.log('[demo:snapshot] đang đọc trạng thái...');

  const counts = await captureTenantCounts(tid);
  const inventory = await chunked('inventory', tid, { id: true, quantity: true, reserved: true });
  const products = await chunked('product', tid, { id: true, costPrice: true });
  const customers = await chunked('customer', tid, { id: true, totalSpent: true, totalDebt: true });
  const purchaseOrders = await chunked('purchaseOrder', tid, {
    id: true, status: true, paymentStatus: true, paidAmount: true, receivedAt: true,
  });

  const snapshot = {
    version: VERSION,
    takenAt: new Date().toISOString(),
    label: label || null,
    tenant: { id: tid, slug: tenant.slug, name: tenant.name },
    counts,
    inventory: inventory.map((r) => ({ id: r.id, quantity: num(r.quantity), reserved: num(r.reserved) })),
    products: products.map((r) => ({ id: r.id, costPrice: String(r.costPrice) })),
    customers: customers.map((r) => ({ id: r.id, totalSpent: String(r.totalSpent), totalDebt: String(r.totalDebt) })),
    purchaseOrders: purchaseOrders.map((r) => ({
      id: r.id,
      status: r.status,
      paymentStatus: r.paymentStatus,
      paidAmount: String(r.paidAmount ?? 0),
      receivedAt: r.receivedAt ? new Date(r.receivedAt).toISOString() : null,
    })),
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2), 'utf8');

  const totalRows = Object.values(counts).reduce((s, n) => s + num(n), 0);
  console.log('');
  console.log(`[demo:snapshot] chụp lúc   : ${snapshot.takenAt}${label ? ` (${label})` : ''}`);
  console.log(`[demo:snapshot] bảng scoped : ${Object.keys(counts).length} · tổng ${totalRows.toLocaleString('vi-VN')} dòng`);
  console.log(`[demo:snapshot] giá trị     : ${inventory.length} dòng tồn · ${products.length} giá vốn · ${customers.length} khách · ${purchaseOrders.length} PO`);
  console.log(`[demo:snapshot] tệp         : ${path.relative(ROOT, OUT_FILE)}`);
  console.log('');
  console.log('  ⇒ Demo xong (đã bấm Duyệt / Ghi sổ cái) thì chạy:');
  console.log('      npm run demo:restore -- --apply');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[demo:snapshot] LỖI:', e.stack || e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});