/**
 * scripts/diag-leaked-po.js — Liệt kê đơn mua sót (không kèm GRN) trong tenant demo
 *
 * `npm run diag:leaked-po`
 */
require('dotenv').config();
const { assertLocalDb } = require('./lib/assert-local-db');
assertLocalDb('diag-leaked-po');

const prisma = require('../src/config/prisma');

const SQL = `
  SELECT po.id, po."poCode", po.status, po."createdAt",
         left(coalesce(po.note, ''), 46) AS note_46,
         (SELECT count(*)::int FROM goods_receipt_notes g
           WHERE g."purchaseOrderId" = po.id) AS so_grn
    FROM purchase_orders po
   WHERE po."tenantId" = (SELECT id FROM tenants WHERE slug = 'omni-demo-mo-phong')
     AND po.note LIKE '%[gate:%'
   ORDER BY po."createdAt" DESC`;

(async () => {
  const rows = await prisma.$queryRawUnsafe(SQL);
  const withoutGrn = rows.filter((r) => r.so_grn === 0);
  console.log(`\n=== ĐƠN MUA DO LUỒNG DEMO SINH (note chứa "[gate:") — ${rows.length} ===\n`);
  console.table(rows.slice(0, 12));
  console.log(`\nCó GRN rồi : ${rows.length - withoutGrn.length}`);
  console.log(`CHƯA có GRN: ${withoutGrn.length}`);
  if (withoutGrn.length) {
    console.log('\nĐây là rác sót của lần chạy lỗi. Xoá bằng:');
    console.log('  npm run clean:leaked-grn -- --apply');
    console.log('(script đó xoá cả PO lẫn GRN, chỉ khi PO CHƯA ở trạng thái RECEIVED)');
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error('LỖI:', e.message); await prisma.$disconnect().catch(() => {}); process.exit(1); });