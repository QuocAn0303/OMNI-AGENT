'use strict';

/**
 * scripts/demo/demo-check.js — `npm run demo:check`
 *
 * ============================================================================
 * MỤC ĐÍCH: trước buổi trình bày, chứng minh bằng MÁY rằng luồng demo chạy được
 * và **chạy lại được nhiều lần không để lại rác** — không dựa vào "lần trước nó chạy".
 * ============================================================================
 * Khác `smoke:demo-flow`: script này **không** khẳng định hành vi sản phẩm (không có
 * assert nghiệp vụ nào), nó trả lời câu hỏi vận hành:
 *
 *   1. Dữ liệu demo có đủ không? (SKU, đơn, NCC, PO/GRN, user đăng nhập được)
 *   2. Chạy LUỒNG HAI LẦN liên tiếp có ra **cùng một SKU** không? (tất định)
 *   3. Lần thứ hai có để lại rác không? (0 bảng thay đổi)
 *   4. Con số in ra có **thân thiện khi trình bày** không? (lead time đo được, số
 *      lượng trong dải tình huống tạp hoá nhỏ)
 *   5. In ra **phiếu từng màn hình**: đúng số nào phải nói, màn hình nào phải mở.
 *
 * Thoát với mã khác 0 nếu bất kỳ điều kiện bắt buộc nào fail.
 */

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('demo:check');

const prisma = require(path.join(ROOT, 'src/config/prisma'));
const { runWithTenant } = require(path.join(ROOT, 'src/config/tenantContext'));
const { runDemoFlow, DEMO_SLUG } = require(path.join(ROOT, 'scripts/demo/demo-flow'));
const {
  loadLeadTimeReceipts, loadReplenishmentInput,
} = require(path.join(ROOT, 'src/modules/replenishment/replenishment.suggest'));
const { calcLeadTime } = require(path.join(ROOT, 'src/modules/replenishment/replenishment.calc'));

const num = (v) => Number(v || 0);
const nfmt = (v) => new Intl.NumberFormat('vi-VN').format(num(v));
const line = (s = '') => console.log(s);
const head = (s) => line(`\n${'─'.repeat(74)}\n${s}\n${'─'.repeat(74)}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  line(`  ${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const t0 = Date.now();
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    console.error(`Không thấy tenant demo "${DEMO_SLUG}".\nChạy trước:\n  npm run data:import -- --reset --apply\n  npm run demo:setup\n  npm run demo:login`);
    process.exit(1);
  }
  const inT = (fn) => runWithTenant(tenant.id, fn);

  head('1. DỮ LIỆU DEMO');
  const [skuCount, orderCount, vendorCount, poCount, grnCount, loginUser] = await Promise.all([
    inT(() => prisma.product.count({ where: { isActive: true } })),
    inT(() => prisma.order.count()),
    inT(() => prisma.vendor.count()),
    inT(() => prisma.purchaseOrder.count({ where: { status: 'RECEIVED' } })),
    inT(() => prisma.goodsReceiptNote.count({ where: { status: 'POSTED' } })),
    inT(() => prisma.user.count({ where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true } })),
  ]);
  line(`  tenant: ${tenant.name}`);
  check('có SKU', skuCount >= 100, `${skuCount} SKU`);
  check('có đơn bán (CDC cần lịch sử bán)', orderCount >= 500, `${nfmt(orderCount)} đơn`);
  check('có NCC', vendorCount >= 1, `${vendorCount} NCC`);
  check('có PO + GRN POSTED (đo được lead time)', poCount >= 3 && grnCount >= 3, `${poCount} PO · ${grnCount} GRN`);
  check('có user ADMIN/MANAGER để duyệt', loginUser >= 1, `${loginUser} user`);

  head('2. CHẠY LUỒNG HAI LẦN — tất định + không rác');
  const run1 = await runDemoFlow({ tenantId: tenant.id });
  const r1 = await run1.cleanup();
  const run2 = await runDemoFlow({ tenantId: tenant.id });
  const r2 = await run2.cleanup();

  check('lần 1 dọn sạch', r1.residue.length === 0,
    r1.residue.length ? `còn ${r1.residue.map((x) => x.table).join(', ')}` : '0 bảng thay đổi');
  check('lần 2 dọn sạch', r2.residue.length === 0,
    r2.residue.length ? `còn ${r2.residue.map((x) => x.table).join(', ')}` : '0 bảng thay đổi');
  check('hai lần chọn CÙNG một SKU (tất định)',
    run1.picked.sku === run2.picked.sku,
    `${run1.picked.sku} vs ${run2.picked.sku}`);
  check('chọn từ nhóm hero (lead time đo được)',
    String(run1.picked.pickedFrom || '').startsWith('hero'),
    run1.picked.pickedFrom || '(không rõ)');

  const p = run2.picked;
  const s = run2.summary;
  check('số lượng đề xuất trong dải xem được (1–500)', num(p.orderQty) >= 1 && num(p.orderQty) <= 500, `${nfmt(p.orderQty)} cái`);
  check('nhu cầu/ngày trong dải tạp hoá nhỏ (0,5–50)',
    num(p.demandPerDay) >= 0.5 && num(p.demandPerDay) <= 50, `${p.demandPerDay}/ngày`);
  check('lead time ĐO ĐƯỢC (không phải mặc định)', p.leadTimeEstimated === false, `${p.leadTimeDays} ngày`);
  check('không phải SKU bán hàng loạn của tệp công khai', num(p.demandPerDay) < 100, `${p.sku}`);

  // Bao nhiêu SKU trong tenant demo có lead time đo được? — câu hỏi giám khảo hay hỏi.
  const products = await inT(() => prisma.product.findMany({
    where: { isActive: true }, select: { id: true, sku: true }, orderBy: { sku: 'asc' }, take: 60,
  }));
  let measured = 0;
  for (const prod of products) {
    const receipts = await inT(() => loadLeadTimeReceipts(prod.id));
    if (!calcLeadTime({ receipts }).estimated) measured += 1;
  }
  line(`\n  (mẫu 60 SKU đầu: ${measured} SKU có lead time đo được)`);
  void loadReplenishmentInput;

  head('3. PHIẾU TỪNG MÀN HÌNH — in ra để đọc khi trình bày');
  const tell = (a, b) => line(`  ${a}\n      → ${b}`);
  tell('0:00 · Đứng, chưa mở màn hình',
    `"Đây là một trong ba món quy trình chúng tôi có: cảnh báo sắp hết hàng → hệ thống tính số lượng cần đặt → NGƯỜI DUYỆT → tạo đơn nhập. Dữ liệu trên màn hình là MÔ PHỎNG, từ UCI Online Retail II, CC BY 4.0; tiền tính bằng sterling của tệp đó."`);
  tell('1:10 · tab POS — bán để tồn rơi',
    `SKU ${p.sku} — ${p.productName}. Bán ${nfmt(s.soldQty)} cái. ATP ${nfmt(s.atpBefore)} → ${nfmt(s.atpAfter)}.`);
  tell('2:10 · tab "Đề xuất cần bạn duyệt" (/agent-approvals)',
    `Tồn khả dụng ${nfmt(s.atpAfter)} · ROP ${nfmt(s.rop)} · còn đủ bán ${(num(s.atpAfter) / Math.max(num(p.demandPerDay), 0.001)).toFixed(1)} ngày · đề xuất nhập ${nfmt(p.orderQty)} cái.`);
  tell('   · bấm Duyệt',
    `Kiểm tra lại lúc duyệt: ${run2.fresh.ok ? 'OK' : 'CHẶN'} · drift = ${run2.fresh.drift}. Tạo đúng 1 PO: ${s.poCode}.`);
  tell('3:35 · tab Đơn nhập',
    `Mã PO ${s.poCode}, tổng ${nfmt(s.poTotal)} GBP (tiền tệ của dataset, không quy đổi), NCC ${s.vendorName}.`);
  tell('4:20 · quay lại /agent-approvals',
    `Gọi lại không sinh đề xuất trùng: onOrder = ${nfmt(run2.dedupe.onOrder)}; số gate PO ${run2.dedupe.gatesBefore} → ${run2.dedupe.gatesAfter}.`);
  tell('4:35 · nói số đo được',
    `Thí nghiệm 1: chỉ số chính ưu tiên ROP nhưng bán ít hơn 9,5%, mất bán nhiều hơn 31,5%, tỉ lệ lấp đủ yêu cầu 69,51% so với 76,81% ⇒ KHÔNG kết luận "ROP tốt hơn". Thí nghiệm 2 (post-hoc): ở cùng mức phục vụ, ROP trói ít vốn hơn (−954,63/ngày, 132/500 SKU); ràng buộc 95% không khả thi, tối đa 88,66%.`);
  tell('4:50 · nói giới hạn',
    `"Còn ba ô chúng tôi chưa có dữ liệu: LLM thật, thời gian người dùng, phỏng vấn khách. Tôi ghi 'chưa có dữ liệu' thay vì điền số."`);

  head('4. GỌI LẠI HAI LẦN — những thứ phải giữ đúng');
  line('  - Số lượng đề xuất do CÔNG THỨC quyết định; LLM chỉ diễn giải/soạn tin. Không nói "AI tính".');
  line('  - Tiền là GBP của tệp dữ liệu. Không quy đổi, không ghi "đ".');
  line('  - Không nói "ROP tốt hơn", không nói "chính xác hơn KiotViet/Sapo", không nói "đa kênh".');
  line('  - Nói rõ nếu dữ liệu trên màn hình là MÔ PHỎNG (luôn luôn nói).');
  line(`  - Đã SỬA: dòng "[einvoice] autoIssue failed … Unique constraint (invoiceNo)" không còn`);
  line(`    xuất hiện (race số HĐĐT mock + thiếu dọn bảng invoices trong cleanup). Nếu thấy lại`);
  line(`    ⇒ KHÔNG trình bày, chạy lại npm run demo:check và đọc phần FAIL.`);

  const failed = checks.filter((c) => !c.ok);
  head('KẾT QUẢ');
  line(`  ${checks.length - failed.length}/${checks.length} điều kiện đạt · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (failed.length) {
    line(`  FAIL: ${failed.map((f) => f.name).join(' · ')}`);
    line('\n  Không trình bày được cho tới khi xanh hết. Nếu là dữ liệu: chạy');
    line('    npm run data:import -- --reset --apply && npm run demo:setup && npm run demo:login');
    await prisma.$disconnect();
    process.exit(1);
  }
  line('  ⇒ Đủ đi trình bày. Phương án dự phòng không-LLM: `npm run demo:run` (không cần giao diện).');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LỖI:', e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
