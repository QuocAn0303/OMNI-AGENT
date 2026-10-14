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
// Thêm 2026-10-14: phủ bước 7 (đóng vòng mua hàng) và chốt chặn LLM.
const { explainProposalForGate } = require(path.join(ROOT, 'src/modules/replenishment/proposal-explain.service'));
const { assertNumbersUnchanged } = require(path.join(ROOT, 'src/modules/replenishment/proposal-explain.llm'));

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
  // Kiểm tra chốt chặn LLM phải chạy TRƯỚC `cleanup()`: `runDemoFlow.cleanup()`
  // xoá `AgentHumanGate` ⇒ sau đó `loadGate` trả 404. Đo được: lần đầu chạy
  // `demo:check` sau khi thêm mục 2c báo "LỖI: 404".
  const ai = await runWithTenant(tenant.id, () => explainProposalForGate({
    tenantId: tenant.id, gateId: run1.gate.id, simulateTamper: false, mode: 'template',
  }));
  const tampered = await runWithTenant(tenant.id, () => explainProposalForGate({
    tenantId: tenant.id, gateId: run1.gate.id, simulateTamper: true, mode: 'template',
  }));
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

  // ── BƯỚC 7 + CHỐT CHẶN LLM ───────────────────────────────────────────
  //
  // THÊM 2026-10-14. `demo:check` trước đây dừng ở "tạo PO": 13 điều kiện không
  // điều kiện nào chạm tới GRN, bút toán, công nợ NCC hay hàng rào số của LLM.
  // Nghĩa là bước 7 mới thêm vào luồng demo chỉ được `smoke:demo-flow` bảo vệ
  // (17/17), còn lệnh mà đội chạy NGAY TRƯỚC khi lên sân khấu thì không.
  head('2b. BƯỚC 7 — ĐÓNG VÒNG MUA HÀNG (PO → GRN → QC → BÚT TOÁN → CÔNG NỢ)');
  const g = run2.grn || {};
  check('PO qua bước duyệt thứ HAI trước khi nhận hàng',
    ['APPROVED', 'ORDERED', 'RECEIVED'].includes(g.poStatusAfterApprove),
    `sau duyệt: ${g.poStatusAfterApprove}`);
  check('phiếu nhập kho có số (GRN-…)',
    !!g.grnCode, `${g.grnCode || 'KHÔNG CÓ'}`);
  check('GRN nhận MỘT PHẦN ⇒ còn hàng phải giao nốt',
    num(g.remainingQty) > 0 && num(g.acceptedQty) > 0,
    `đã nhận ${nfmt(g.acceptedQty)} · còn lại ${nfmt(g.remainingQty)}`);
  check('tồn kho tăng ĐÚNG bằng số hàng đạt QC',
    num(g.stockDelta) === num(g.acceptedQty),
    `tồn +${nfmt(g.stockDelta)} · đạt QC ${nfmt(g.acceptedQty)}`);
  check('BÚT TOÁN tồn tại và CÂN BẰNG Nợ = Có (Nợ 156 + Nợ 1331 = Có 331)',
    !!g.journalEntryCode && g.journalBalanced === true,
    `${g.journalEntryCode || 'KHÔNG CÓ BÚT TOÁN'} · N=${nfmt(g.journalDebit)} C=${nfmt(g.journalCredit)}`);
  check('công nợ NCC tăng ⇒ vòng mua hàng khép kín',
    num(g.debtDelta) > 0,
    `+${nfmt(g.debtDelta)} · NCC ${g.vendorName || '?'}`);

  head('2c. CHỐT CHẶN LLM — assertNumbersUnchanged');
  // `ai` và `tampered` đã tính ở trên, TRƯỚC `run1.cleanup()` — vì cleanup xoá hẳn
  // thẻ duyệt khỏi DB. Gọi đúng service mà endpoint HTTP dùng ⇒ kiểm được cả
  // logic lẫn cách nó đọc số từ `AgentHumanGate.actionPayload`.
  check('AI sinh được lời giải thích + tin nhắn NCC',
    !!ai.explanation && !!ai.vendorMessage,
    `${(ai.explanation || '').slice(0, 48)}…`);
  check('hàng rào số ĐẠT trên văn bản thật của hệ thống',
    ai.guardrail.passed === true && ai.guardrail.inventedNumbers.length === 0,
    ai.guardrail.passed ? '0 số lạ' : `phát hiện: ${ai.guardrail.inventedNumbers.join(', ')}`);
  check('tin nhắn NCC CHỈ soạn, không gửi',
    ai.vendorMessageSent === false && ai.requiresHumanSend === true,
    `sent=${ai.vendorMessageSent} · requiresHumanSend=${ai.requiresHumanSend}`);

  // Chế độ biểu diễn: sửa số phải bị bắt.
  check('đổi số lượng ⇒ hàng rào BẮT ĐƯỢC và khôi phục số chuẩn',
    tampered.guardrail.passed === false
      && tampered.guardrail.blockedBy === 'assertNumbersUnchanged'
      && tampered.guardrail.fallbackApplied === true
      && tampered.guardrail.inventedNumbers.length > 0,
    `${tampered.guardrail.originalNumber} → ${tampered.guardrail.tamperedNumber}, bắt ${tampered.guardrail.inventedNumbers.join(', ')}`);
  // Hàm rào phải giữ đúng vai trò: đổi số nhỏ (1 đơn vị) cũng phải bắt.
  const tinyPayload = { orderQty: 260, total: 221 };
  const tiny = assertNumbersUnchanged('Đề xuất nhập 261 đơn vị', tinyPayload);
  check('hàng rào bắt cả sai số NHỎ (+1) — không chỉ sai số lớn',
    tiny.ok === false && tiny.invented.includes(261),
    `phát hiện: ${tiny.invented.join(', ')}`);
  // Nhưng số ĐÃ CÓ ở dạng làm tròn thì không được báo động giả.
  const roundedOk = assertNumbersUnchanged('Nhu cầu trung bình 25,6/ngày', { demandPerDay: 25.625 });
  check('không báo động giả khi LLM làm tròn số đã có (25,625 → 25,6)',
    roundedOk.ok === true, `số lạ: ${roundedOk.invented.join(', ') || 'không'}`);

  head('3. PHIẾU TỪNG MÀN HÌNH — in ra để đọc khi trình bày');
  const tell = (a, b) => line(`  ${a}\n      → ${b}`);
  tell('0:00 · Đứng, chưa mở màn hình',
    `"Đây là MỘT quy trình, đi trọn từ cảnh báo đến sổ cái: cảnh báo sắp hết hàng → hệ thống tính số lượng cần đặt → NGƯỜI DUYỆT → tạo đơn nhập → nhập kho → hạch bút toán. Dữ liệu trên màn hình là MÔ PHỎNG, từ UCI Online Retail II, CC BY 4.0; tiền tính bằng sterling của tệp đó."`);
  tell('1:10 · tab POS — bán để tồn rơi',
    `SKU ${p.sku} — ${p.productName}. Bán ${nfmt(s.soldQty)} cái. ATP ${nfmt(s.atpBefore)} → ${nfmt(s.atpAfter)}.`);
  tell('2:10 · tab "Đề xuất cần bạn duyệt" (/agent-approvals)',
    `Tồn khả dụng ${nfmt(s.atpAfter)} · ROP ${nfmt(s.rop)} · còn đủ bán ${(num(s.atpAfter) / Math.max(num(p.demandPerDay), 0.001)).toFixed(1)} ngày · đề xuất nhập ${nfmt(p.orderQty)} cái.`);
  tell('   · bấm Duyệt',
    `Kiểm tra lại lúc duyệt: ${run2.fresh.ok ? 'OK' : 'CHẶN'} · drift = ${run2.fresh.drift}. Tạo đúng 1 PO: ${s.poCode}.`);
  tell('3:35 · tab Đơn nhập',
    `Mã PO ${s.poCode}, tổng ${nfmt(s.poTotal)} GBP (tiền tệ của dataset, không quy đổi), NCC ${s.vendorName}.`);
  tell('3:45 · tab Phiếu nhập kho (/grn)',
    `Phiếu ${g.grnCode}: đã nhận ${nfmt(g.acceptedQty)} / còn giao nốt ${nfmt(g.remainingQty)}. Bấm "Ghi sổ cái" (post).`);
  tell('4:00 · tab Sổ cái (kế toán)',
    `Bút toán ${g.journalEntryCode}: Nợ ${nfmt(g.journalDebit)} = Có ${nfmt(g.journalCredit)} — Nợ 156 tồn kho + Nợ 1331 công nợ phải trả = Có 331 công nợ phải có. Công nợ NCC tăng ${nfmt(g.debtDelta)} GBP.`);
  tell('4:30 · quay lại /agent-approvals — bấm "AI Giải thích và Soạn tin NCC"',
    `Lời giải thích + tin nhắn NCC sinh ra; hàng rào số báo ĐÃ KIỂM CHỨNG.`);
  tell('4:40 · bấm "Test Chốt chặn AI sửa số"',
    `Hàng rào báo ĐÃ CHẶN: ${tampered.guardrail.originalNumber} → ${tampered.guardrail.tamperedNumber}, bắt số ${tampered.guardrail.inventedNumbers.join(', ')}, khôi phục số chuẩn từ công thức.`);
  tell('4:50 · nói số đo được',
    `Thí nghiệm 1: chỉ số chính ưu tiên ROP nhưng bán ít hơn 9,5%, mất bán nhiều hơn 31,5%, tỉ lệ lấp đủ yêu cầu 69,51% so với 76,81% ⇒ KHÔNG kết luận "ROP tốt hơn". Thí nghiệm 2 (post-hoc): ở cùng mức phục vụ, ROP trói ít vốn hơn (−954,63/ngày, 132/500 SKU); ràng buộc 95% không khả thi, tối đa 88,66%.`);
  tell('5:00 · nói giới hạn',
    `"Còn hai ô chúng tôi chưa có dữ liệu: số token LLM chạy hàng ngày và thời gian người dùng. Tôi ghi 'chưa có dữ liệu' thay vì điền số."`);

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
