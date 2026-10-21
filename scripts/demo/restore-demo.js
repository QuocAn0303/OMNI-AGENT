'use strict';

/**
 * scripts/demo/restore-demo.js — `npm run demo:restore -- --apply`
 *
 * ============================================================================
 * MỤC ĐÍCH
 * ============================================================================
 * Đưa tenant demo **về đúng trạng thái trước buổi demo** sau khi đã bấm
 * "Duyệt" (PO), "Nhập kho" (GRN), "Ghi sổ cái" (bút toán + công nợ) trên UI — để
 * buổi trình bày sau chạy lại được từ đầu mà không phải dựng lại dataset.
 *
 * Nó đọc tệp do `npm run demo:snapshot` ghi ra, rồi làm ĐÚNG HAI VIỆC:
 *   1. XOÁ mọi dòng sinh ra sau thời điểm chụp (PO/GRN/bút toán/công nợ/thẻ
 *      duyệt/phiên agent/đơn bán/audit…). Thứ tự xoá là thứ tự FK an toàn đã được
 *      `smoke:demo-flow` chạy thật — dùng lại `purgeFlowResidue` của
 *      `scripts/demo/demo-flow.js` để không tự chế thêm một thứ tự khác.
 *   2. HOÀN NGUYÊN GIÁ TRỊ: tồn kho (quantity/reserved), giá vốn trung bình
 *      (`Product.costPrice` bị GRN đổi khi nhập), tổng chi/tổng nợ khách, và
 *      trạng thái các PO có sẵn. Không có bước này thì "0 bảng thay đổi" mà số
 *      vẫn lệch — đúng bẫy đã ghi trong `demo-flow.js`.
 *
 * CUỐI CÙNG ĐO LẠI: đếm dòng trên toàn bộ bảng scoped và so với tệp snapshot.
 * Bảng nào lệch thì in ra tên + số lệch ⇒ không phải "chắc là ổn".
 *
 * AN TOÀN
 *   - `assertLocalDb`: chỉ chạy trên DB local.
 *   - **dry-run là mặc định**, phải thêm `--apply` mới ghi.
 *   - Chỉ đụng tenant của tệp snapshot; nếu tenant trong DB khác id thì dừng.
 *   - Phạm vi: mọi thứ tạo sau thời điểm chụp đều bị xoá — nghĩa là đừng chụp
 *     xong rồi làm việc thật khác trên tenant demo nếu không muốn mất.
 *
 *   npm run demo:restore                  # xem trước (không ghi)
 *   npm run demo:restore -- --apply       # hoàn nguyên thật
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('demo:restore');

const prisma = require(path.join(ROOT, 'src/config/prisma'));
const { runWithTenant } = require(path.join(ROOT, 'src/config/tenantContext'));
const {
  purgeFlowResidue, captureTenantCounts, diffTenantCounts,
} = require('./demo-flow');

const OUT_FILE = path.join(ROOT, 'data', 'demo-snapshot.json');
const APPLY = process.argv.includes('--apply');
const CHUNK = 2000;

const num = (v) => Number(v || 0);
const line = (s = '') => console.log(s);

/**
 * Hoàn nguyên một bảng theo id bằng `unnest` — nhanh hơn N lệnh `update` khi
 * dataset lớn (vài nghìn dòng tồn/sản phẩm/khách).
 *
 * @param {string} table      tên bảng trong Postgres
 * @param {Array<{id:string}>} rows
 * @param {Array<[string, 'numeric'|'text']>} valueCols  cột + kiểu ép
 */
const restoreById = async (tenantId, table, rows, valueCols) => {
  if (!rows.length) return 0;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const cols = ['id', ...valueCols.map(([c]) => c)];
    const unnestList = cols.map((c, k) => `unnest($${k + 2}::text[]) AS "${c}"`).join(', ');
    const setList = valueCols.map(([c, cast]) => `"${c}" = v."${c}"::${cast}`).join(', ');
    const arrays = cols.map((c) => (c === 'id' ? part.map((r) => r.id) : part.map((r) => String(r[c] ?? ''))));
    await runWithTenant(tenantId, () =>
      prisma.$executeRawUnsafe(
        `UPDATE "${table}" AS t SET ${setList}
           FROM (SELECT ${unnestList}) AS v
          WHERE t.id = v."id" AND t."tenantId" = $1`,
        // `$executeRawUnsafe` nhận tham số **rải rác** (query, ...values), không
        // nhận mảng — truyền mảng bị coi là đúng MỘT tham số và Postgres báo
        // "supplies 1 parameters ... requires N".
        tenantId,
        ...arrays,
      ),
    );
    done += part.length;
  }
  return done;
};

/**
 * Xoá phần rác mà `purgeFlowResidue` chưa biết tới: các bảng con của `Order`
 * chỉ sinh ra khi bán hàng trên UI (POS / trả hàng / giao hàng / tách hoá đơn).
 *
 * `purgeFlowResidue` xoá `orders` theo `createdAt`; nếu còn `payments` /
 * `bill_splits` / `promotion_usages` trỏ tới thì Postgres chặn (FK RESTRICT) và
 * dọn dở dang — nên phải xoá con TRƯỚC rồi mới gọi hàm dọn chuẩn.
 */
const purgeOrderChildren = async (tenantId, since) => {
  const inT = (fn) => runWithTenant(tenantId, fn);
  const deleted = {};
  const orderIds = (await inT(() => prisma.order.findMany({
    where: { createdAt: { gte: since } }, select: { id: true },
  }))).map((o) => o.id);
  deleted.orders = orderIds.length;
  if (!orderIds.length) return deleted;

  const del = async (model, where, label) => {
    if (!prisma[model]) return;
    deleted[label] = (await inT(() => prisma[model].deleteMany({ where }))).count;
  };

  await del('delivery', { orderId: { in: orderIds } }, 'deliveries');
  await del('orderReturn', { orderId: { in: orderIds } }, 'returns');
  await del('payment', { orderId: { in: orderIds } }, 'payments');
  await del('billSplit', { orderId: { in: orderIds } }, 'billSplits');
  await del('promotionUsage', { orderId: { in: orderIds } }, 'promotionUsages');
  await del('invoice', { orderId: { in: orderIds } }, 'invoices');
  await del('electronicInvoice', { orderId: { in: orderIds } }, 'electronicInvoices');
  await del('serialNumber', { orderId: { in: orderIds } }, 'serialNumbers');
  const itemIds = (await inT(() => prisma.orderItem.findMany({
    where: { orderId: { in: orderIds } }, select: { id: true },
  }))).map((i) => i.id);
  if (itemIds.length) {
    await del('kdsTicket', { orderItemId: { in: itemIds } }, 'kdsTickets');
    await del('orderItemModifier', { orderItemId: { in: itemIds } }, 'orderItemModifiers');
  }
  await del('orderItem', { orderId: { in: orderIds } }, 'orderItems');
  await del('order', { id: { in: orderIds } }, 'ordersDeleted');
  return deleted;
};

/** Đếm (không ghi) những bảng chính mà lệnh sẽ xoá — phần "xem trước". */
const preview = async (tenantId, since) => {
  const inT = (fn) => runWithTenant(tenantId, fn);
  const rows = [];
  const models = [
    'purchaseOrder', 'goodsReceiptNote', 'journalEntry', 'debt',
    'agentHumanGate', 'agentSession', 'order', 'inventoryTransaction',
    'notification', 'auditLog', 'electronicInvoice', 'journalPostingError',
  ];
  for (const m of models) {
    if (!prisma[m]) continue;
    const n = await inT(() => prisma[m].count({ where: { createdAt: { gte: since } } }));
    if (n) rows.push({ table: m, rows: n });
  }
  return rows;
};

async function main() {
  if (!fs.existsSync(OUT_FILE)) {
    console.error(
      `[demo:restore] CHƯA có tệp snapshot.\n` +
      `  ⇒ Chạy "npm run demo:snapshot" TRƯỚC buổi demo, xong demo thì chạy lại lệnh này.`,
    );
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  if (snap.version !== 1) {
    console.error(`[demo:restore] tệp snapshot phiên bản ${snap.version} — script này hiểu phiên bản 1.`);
    process.exit(1);
  }
  const tenant = await prisma.tenant.findUnique({ where: { slug: snap.tenant.slug }, select: { id: true, name: true } });
  if (!tenant) {
    console.error(`[demo:restore] tenant demo ${snap.tenant.slug} không còn trong DB.`);
    process.exit(1);
  }
  if (tenant.id !== snap.tenant.id) {
    console.error(
      `[demo:restore] tenant trong DB đã đổi id (${tenant.id} ≠ ${snap.tenant.id}).\n` +
      `  ⇒ Tệp snapshot cũ, KHÔNG áp dụng. Chụp lại: npm run demo:snapshot`,
    );
    process.exit(1);
  }
  const tid = tenant.id;
  const since = new Date(snap.takenAt);

  line(`[demo:restore] tenant : ${tenant.name}`);
  line(`[demo:restore] chụp   : ${snap.takenAt}${snap.label ? ` (${snap.label})` : ''}`);
  line(`[demo:restore] mô hình: ${APPLY ? 'APPLY — sẽ ghi DB' : 'DRY-RUN — thêm --apply để ghi'}`);

  const toDelete = await preview(tid, since);
  line('\n  Sẽ XOÁ (dòng tạo sau thời điểm chụp):');
  if (toDelete.length) for (const r of toDelete) line(`    ${r.table.padEnd(24)} ${r.rows}`);
  else line('    (không có dòng nào)');

  line('\n  SẼ HOÀN NGUYÊN GIÁ TRỊ:');
  line(`    inventory      ${snap.inventory.length} dòng tồn (quantity/reserved)`);
  line(`    product        ${snap.products.length} giá vốn trung bình`);
  line(`    customer       ${snap.customers.length} tổng chi / tổng nợ`);
  line(`    purchaseOrder  ${snap.purchaseOrders.length} trạng thái PO có sẵn`);

  if (!APPLY) {
    line('\n  ⇒ CHƯA ghi gì. Chạy: npm run demo:restore -- --apply');
    await prisma.$disconnect();
    return;
  }

  line('\n  Đang hoàn nguyên...');
  const uiDeleted = await purgeOrderChildren(tid, since);
  const deleted = await purgeFlowResidue(tid, since);
  const merged = { ...uiDeleted, ...deleted };

  const restored = {
    // Tên bảng Postgres, không phải tên model Prisma: `Inventory` → `inventories`.
    inventory: await restoreById(tid, 'inventories', snap.inventory, [['quantity', 'numeric'], ['reserved', 'numeric']]),
    products: await restoreById(tid, 'products', snap.products, [['costPrice', 'numeric']]),
    customers: await restoreById(tid, 'customers', snap.customers, [['totalSpent', 'numeric'], ['totalDebt', 'numeric']]),
  };

  // PO có sẵn: trạng thái có thể đã đổi (nhận hàng vào PO lịch sử) ⇒ trả về.
  let poRestored = 0;
  for (const po of snap.purchaseOrders) {
    await runWithTenant(tid, () => prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: po.status,
        paymentStatus: po.paymentStatus,
        paidAmount: po.paidAmount,
        receivedAt: po.receivedAt ? new Date(po.receivedAt) : null,
      },
    })).catch(() => null);
    poRestored += 1;
  }
  restored.purchaseOrders = poRestored;

  line('\n  ĐÃ XOÁ:');
  for (const [k, v] of Object.entries(merged)) {
    if (num(v)) line(`    ${k.padEnd(24)} ${v}`);
  }
  line('\n  ĐÃ HOÀN NGUYÊN:');
  for (const [k, v] of Object.entries(restored)) line(`    ${k.padEnd(24)} ${v}`);

  const after = await captureTenantCounts(tid);
  const vsSnapshot = diffTenantCounts(snap.counts, after);
  line('\n  ĐO LẠI so với tệp snapshot:');
  if (!vsSnapshot.length) {
    line('    0 bảng lệch ⇒ tenant demo đã về đúng trạng thái trước buổi demo.');
  } else {
    line(`    ${vsSnapshot.length} bảng LỆCH (xem trước khi trình bày):`);
    for (const r of vsSnapshot) line(`      ${r.table}: ${r.before} → ${r.after} (${r.delta > 0 ? '+' : ''}${r.delta})`);
  }
  line('\n  ⇒ Demo lại được từ đầu. Nếu tab "Đề xuất nhập" vẫn trống: Ctrl+F5.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[demo:restore] LỖI:', e.stack || e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});