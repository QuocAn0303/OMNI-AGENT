'use strict';

/**
 * scripts/demo/preflight-demo.js — `npm run demo:preflight`
 *
 * ============================================================================
 * MỤC ĐÍCH: trả lời trước khi lên sân khấu câu duy nhất quan trọng:
 * "bấm được nút Tạo đề xuất trên UI không?"
 * ============================================================================
 * Buổi trình bày hỏng KHÔNG phải vì hệ thống chết, mà vì màn hình **trống**:
 * tab `Đề xuất nhập` chỉ hiện SKU thật sự **dưới ROP** (còn đủ bán thì không
 * đề xuất — đúng công thức), và nút chỉ sáng khi SKU đó **đã có nhà cung cấp**
 * (`suggestForProduct` cố ý không bịa NCC). Hai điều kiện đó phụ thuộc DỮ LIỆU,
 * không phụ thuộc code — nên phải đo trước, không đoán trên sân khấu.
 *
 * Script đọc đúng hàm của sản phẩm (`smart-guide.service.getReorderSuggestions`)
 * ⇒ số in ra CHÍNH LÀ số dòng mà UI sẽ hiện.
 *
 *   npm run demo:preflight
 */

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('demo:preflight');

const prisma = require(path.join(ROOT, 'src/config/prisma'));
const { runWithTenant } = require(path.join(ROOT, 'src/config/tenantContext'));
const { DEMO_SLUG } = require('./demo-flow');
const { getReorderSuggestions } = require(path.join(ROOT, 'src/modules/smart-guide/smart-guide.service'));
const { PO_PROPOSAL } = require(path.join(ROOT, 'src/modules/ai/agent.humangate'));

const n = (v) => Number(v || 0).toLocaleString('vi-VN');

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    console.error(`[preflight] KHÔNG có tenant demo ${DEMO_SLUG}. Chạy: npm run data:import -- --reset --apply`);
    process.exit(1);
  }
  const tid = tenant.id;
  const inT = (fn) => runWithTenant(tid, fn);

  const [skuCount, orderCount, poCount, grnCount] = await Promise.all([
    inT(() => prisma.product.count({ where: { isActive: true } })),
    inT(() => prisma.order.count()),
    inT(() => prisma.purchaseOrder.count()),
    inT(() => prisma.goodsReceiptNote.count()),
  ]);

  console.log(`\n=== PREFLIGHT DEMO — ${tenant.name} ===\n`);
  console.log(`  SKU                 ${n(skuCount)}`);
  console.log(`  Đơn bán            ${n(orderCount)}`);
  console.log(`  PO / GRN           ${n(poCount)} / ${n(grnCount)}`);

  const out = await inT(() => getReorderSuggestions(tid));
  const rows = out.suggestions || [];
  const withVendor = rows.filter((r) => r.suggestedVendor);
  const pendingGates = await inT(() =>
    prisma.agentHumanGate.count({ where: { actionType: PO_PROPOSAL, status: 'PENDING' } }),
  );

  console.log(`\n  SKU DƯỚI ROP      ${n(rows.length)}   ← số dòng tab "Đề xuất nhập" sẽ hiện`);
  console.log(`  ...có NHÀ CUNG CẤP ${n(withVendor.length)}   ← số nút "Tạo đề xuất" BẤM ĐƯỢC`);
  console.log(`  Thẻ duyệt PENDING  ${n(pendingGates)}`);

  if (withVendor.length) {
    console.log('\n  Vài dòng sẽ bấm được:');
    for (const r of withVendor.slice(0, 5)) {
      console.log(`    ${r.sku.padEnd(12)} tồn ${String(r.currentStock).padStart(5)} / ROP ${String(r.rop).padStart(5)} · đề xuất ${String(r.suggestedReorderQty).padStart(5)} · ${r.suggestedVendor.name}`);
    }
  }

  console.log('');
  if (!rows.length) {
    console.log('  ⚠ KHÔNG có SKU nào dưới ROP ⇒ tab "Đề xuất nhập" SẼ TRỐNG.');
    console.log('    Nguyên nhân gần như luôn là DỮ LIỆU (tồn đầu kỳ cao hơn nhu cầu),');
    console.log('    không phải lỗi code. Nạp lại bộ dữ liệu demo rồi chạy lại preflight:');
    console.log('      npm run data:import -- --reset --apply --days 34');
    console.log('      npm run demo:setup');
  } else if (!withVendor.length) {
    console.log('  ⚠ CÓ SKU dưới ROP nhưng CHƯA SKU nào có NCC ⇒ mọi nút đều mờ (hệ thống');
    console.log('    không được bịa nhà cung cấp). Cần PO lịch sử cho các SKU đó:');
    console.log('      npm run demo:setup');
  } else {
    console.log('  ⇒ ĐỦ dữ liệu để trình bày trên UI.');
  }
  console.log('');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[preflight] LỖI:', e.stack || e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});