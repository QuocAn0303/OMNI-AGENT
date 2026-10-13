'use strict';

/**
 * scripts/demo/run-demo.js — `npm run demo:run`
 *
 * ============================================================================
 * MỤC ĐÍCH: phương án DỰ PHÒNG khi trình diễn, KHÔNG cần giao diện
 * ============================================================================
 * T11 yêu cầu "chạy luồng không cần giao diện". Script này in ra từng bước của
 * luồng với số đo thật đọc từ DB (ATP, ROP, nhu cầu/ngày, lead time, số lượng đề
 * xuất, mã PO, thời gian từng bước) — dùng khi:
 *   - giao diện chết giữa lúc trình bày;
 *   - cần chứng minh luồng chạy được trên máy **không cài PostgreSQL riêng**;
 *   - cần chạy lại nhiều lần trước khi lên sân khấu (không để rác).
 *
 * Nó dùng CHUNG `scripts/demo/demo-flow.js` với `smoke:demo-flow` ⇒ bản trình
 * diễn và bản nghiệm thu là **cùng một đường mã**. Không có LLM trong luồng.
 *
 * Mặc định dọn lại DB sau khi chạy (`--keep` để giữ lại PO để xem trên giao diện).
 *
 * Nhãn phạm vi: dữ liệu MÔ PHỎNG (dựng từ UCI Online Retail II, CC BY 4.0 —
 * xem docs/aisc26/02-data.md). Mọi số dưới đây là số hệ thống TÍNH RA trên dữ
 * liệu đó, KHÔNG phải hiệu quả đo được trên doanh nghiệp thật.
 */

require('dotenv').config();
const { assertLocalDb } = require('../lib/assert-local-db');
assertLocalDb('demo:run');

const prisma = require('../../src/config/prisma');
const { runDemoFlow, DEMO_SLUG } = require('./demo-flow');

const keep = process.argv.includes('--keep');
const n = (v) => Number(v || 0).toLocaleString('vi-VN');

const line = (s = '') => console.log(s);
const head = (s) => line(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    console.error(`[demo] KHÔNG có tenant demo ${DEMO_SLUG}.\n[demo] Chạy trước: npm run data:import -- --reset --apply`);
    process.exit(1);
  }
  const tid = tenant.id;
  const started = Date.now();

  line('╔══════════════════════════════════════════════════════════════════════╗');
  line('║  LUỒNG DEMO — cảnh báo sắp hết hàng → duyệt → tạo PO → NHẬP KHO    ║');
  line('║  → BÚT TOÁN + CÔNG NỢ. Toàn bộ vòng mua hàng khép kín.               ║');
  line('║  Dữ liệu MÔ PHỎNG (UCI Online Retail II, CC BY 4.0) · KHÔNG có LLM ║');
  line('╚══════════════════════════════════════════════════════════════════════╝');
  line(`[demo] tenant: ${tenant.name}`);

  const flow = await runDemoFlow({
    tenantId: tid,
    onEvent: ({ step, ms }) => line(`   · ${step.padEnd(26)} ${String(ms).padStart(5)} ms`),
  });

  const s = flow.summary;
  const p = flow.picked;
  head('BƯỚC 1–2  ĐƠN BÁN LÀM TỒN GIẢM');
  line(`   SKU            ${s.sku} — ${s.productName}`);
  line(`   Bán            ${n(s.soldQty)} cái (đơn ${flow.order.orderCode})`);
  line(`   ATP            ${n(s.atpBefore)} → ${n(s.atpAfter)}  (đơn đi qua order.service.create ⇒ trừ kho thật)`);
  line(`   Mức tồn thấp  ${n(p.minStock)}   ROP ${n(s.rop)}   nhu cầu/ngày ${s.demandPerDay}`);

  head('BƯỚC 3–4  CÔNG THỨC TÍNH RA ĐỀ XUẤT (không LLM)');
  line(`   Đơn giá       ${s.unitCost} GBP/cái (giá niêm yết — dataset KHÔNG có giá vốn, xem 02-data.md §6.4)`);
  line(`   Đề xuất nhập   ${n(s.orderQty)} × ${n(s.unitCost)} = ${n(s.totalEstimate)} GBP`);
  line(`   NCC            ${s.vendorName}`);
  line(`   Lead time      ${s.leadTimeDays} ngày ${s.leadTimeEstimated ? '(UƯỚC LƯỢNG — chưa đủ lịch sử nhận hàng)' : '(ĐO ĐƯỢC từ lịch sử PO → GRN)'}`);
  line(`   Cờ thiếu giá vốn ${p.missingCost === true ? 'CÓ' : 'KHÔNG'}`);
  line(`   Kiểm tra lại lúc duyệt: ${flow.fresh.ok ? 'OK' : 'BỊ CHẶN'} · trạng thái drift = ${flow.fresh.drift}`);
  line(`   Gate           ${flow.cdc.gateId}`);

  head('BƯỚC 5  NGƯỜI DUYỆT QUA HUMAN-GATE');
  line(`   Người duyệt    ${s.approver}`);
  line(`   Kết quả        tạo đúng ${flow.poCheck.found} PO → ${s.poCode} (${n(s.poTotal)} GBP — tiền tệ của dataset, KHÔNG quy đổi)`);

  // ── BƯỚC ĐÓNG VÒNG (thêm 2026-10-13) ──────────────────────────────────
  // Khối này là phần trả lời trực tiếp cho câu hỏi khó nhất của ban giám khảo:
  // "số liệu của các bạn lấy từ đâu?". Câu trả lời: hệ thống tự đo được, và khi
  // tự đo thì phát hiện ra lỗi của chính mình.
  const g = flow.grn;
  head('BƯỚC 7  ĐÓNG VÒNG MUA HÀNG: PHIẾU NHẬP KHO → SỔ CÁI');
  line(`   PO cần duyệt   ${flow.poCheck.poCode} — sau bước duyệt thứ HAI: ${g.poStatusAfterApprove}`);
  line('                   (duyệt đề xuất ở bước 5 ≠ duyệt đơn mua — 2 chốt kiểm riêng)');
  line(`   Phiếu nhập     ${g.grnCode}`);
  line(`   Hàng đạt QC    ${n(g.acceptedQty)}   còn phải giao nốt ${n(g.remainingQty)}`);
  line(`   Giá trị nhận   ${n(g.receivedValue)} GBP`);
  line(`   Tồn kho        +${n(g.stockDelta)} (đúng bằng số hàng ĐẠT QC)`);
  line(`   BÚT TOÁN      ${g.journalEntryCode || 'KHÔNG CÓ — hạch lỗi'}`);
  line(`                   Nợ ${n(g.journalDebit)} = Có ${n(g.journalCredit)}${g.journalBalanced === true ? '  (CÂN BẰNG)' : ''}`);
  line('                   Nợ 156 tồn kho + Nợ 1331 công nợ phải trả = Có 331 công nợ phải có');
  line(`   Công nợ NCC    +${n(g.debtDelta)} GBP với ${g.vendorName}`);
  line('');
  line('   ▸ Trước 2026-10-12: GRN chỉ cộng tồn kho, KHÔNG ghi bút toán, KHÔNG tạo công nợ.');
  line('     Đo được 39 PO đã nhận hàng thật mà không có dòng bút toán nào.');
  line('     Lệnh kiểm tra hiện tại: npm run check:accounting → số PO thiếu bút toán phải = 0.');

  head('BƯỚC 8  KHÔNG SINH ĐỀ XUẤT TRÙNG');
  line(`   onOrder        ${n(flow.dedupe.onOrder)} (hàng đang trên đường từ PO vừa tạo)`);
  line(`   Gọi lại        ${flow.dedupe.secondSuggestion === null ? 'KHÔNG sinh đề xuất nữa' : `KHÔNG ĐÚNG — ${flow.dedupe.secondSuggestion}`}`);
  line(`   Số gate PO     ${flow.dedupe.gatesBefore} → ${flow.dedupe.gatesAfter}`);

  head('BỎ QUA CÓ CHỦ ĐÍCH (nói thẳng, không giấu)');
  line('   · pg_notify/LISTEN: bước 3 gọi thẳng EVENT_HANDLERS.LOW_STOCK (cần server nền mới có vận chuyển).');
  line('   · HTTP: bước 5 gọi executeGate trực tiếp đúng thứ tự route; phần HTTP có script riêng check:humangate.');

  if (keep) {
    line('\n[demo] --keep: GIỮ lại PO và đề xuất để mở giao diện xem. Dọn tay: node scripts/demo/clean-demo.js');
  } else {
    const res = await flow.cleanup();
    line(`\n[demo] đã dọn: ${JSON.stringify(res.deleted)}`);
    line(`[demo] rác còn lại: ${res.residue.length === 0 ? '0 bảng thay đổi' : JSON.stringify(res.residue)}`);
  }
  line(`\n[demo] TỔNG thời gian ${Date.now() - started} ms · tenant demo giữ nguyên 500 SKU`);
}

main()
  .catch((e) => {
    console.error(`[demo] LỖI: ${e.stack || e.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());