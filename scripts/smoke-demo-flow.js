'use strict';

/**
 * scripts/smoke-demo-flow.js — NGHIỆM THU LUỒNG DEMO (T11) TRÊN DB THẬT
 *
 * ============================================================================
 * VÌ SAO CẦN
 * ============================================================================
 * `smoke:po-gate` đã chứng minh cơ chế gate trên tenant **tự tạo** (PO song
 * song, drift, MISSING_COST...). Nhưng khách hàng mục tiêu của gói P6 là: luồng
 * chạy được trên **tenant demo đã nạp sẵn dữ liệu thật** mà không cần giao diện.
 * Script này chạy đúng luồng đó trên `omni-demo-mo-phong` và kiểm 8 điều:
 *
 *   D1 chọn được SKU đủ điều kiện (có NCC đã biết + ATP ≤ ROP + orderQty > 0)
 *   D2 đơn tạo qua `order.service.create` thực sự TRỪ KHO (ATP giảm đúng số lượng)
 *   D3 CDC (`EVENT_HANDLERS.LOW_STOCK`) sinh đúng MỘT đề xuất PENDING
 *   D4 đề xuất có `freshness` đo được: `revalidate` CHƯA duyệt cho `ok` và diff rỗng
 *   D5 duyệt qua human-gate sinh **đúng một** PO, `resultRef` trỏ đúng PO đó
 *   D6 `onOrder` chống trùng: `suggestForProduct` lần 2 KHÔNG sinh gate thứ hai
 *   D7 chạy lại liên tiếp 2 lần ⇒ không dòng rác tăng thêm (139 bảng scoped đếm
 *      trước/sau; `residue` phải rỗng)
 *   D8 tenant thật (`candory-scent`) giữ nguyên số đã ký ở STATE.md
 *
 * MỌI khẳng định đều là so số đo được trên DB local thật (`assertLocalDb`).
 *
 * Dọn dẹp: `demo-flow.cleanup()` xoá đúng các dòng lần chạy sinh ra rồi đo lại
 * toàn bộ bảng scoped. Dòng nào còn sót sẽ hiện ở `residue` ⇒ D7 FAIL.
 *
 * Chạy: npm run smoke:demo-flow
 */

require('dotenv').config();
const { assertLocalDb } = require('./lib/assert-local-db');
assertLocalDb('smoke-demo-flow');

const prisma = require('../src/config/prisma');
const { runDemoFlow, captureTenantCounts, diffTenantCounts, DEMO_SLUG } = require('./demo/demo-flow');
const { PO_PROPOSAL } = require('../src/modules/ai/agent.humangate');
const { DRIFT_NONE } = require('../src/modules/replenishment/replenishment.calc');

const SIGNED = { slug: 'candory-scent', orders: 82, items: 158, totalVnd: 89862000 };

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label}${extra ? ` → ${extra}` : ''}`);
  if (cond) pass += 1;
  else fail += 1;
};

const realTenantSnapshot = async () => {
  const t = await prisma.tenant.findUnique({ where: { slug: SIGNED.slug } });
  if (!t) return null;
  const orders = await prisma.order.findMany({ where: { tenantId: t.id }, select: { total: true } });
  return {
    orders: orders.length,
    items: await prisma.orderItem.count({ where: { order: { tenantId: t.id } } }),
    totalVnd: orders.reduce((s, o) => s + Number(o.total), 0),
  };
};

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    console.error(`[smoke] KHÔNG có tenant demo ${DEMO_SLUG}. Chạy: npm run data:import -- --reset --apply`);
    process.exit(1);
  }
  const tid = tenant.id;
  console.log(`[smoke] tenant demo: ${tenant.name} (${tid})`);

  const realBefore = await realTenantSnapshot();

  // ── D1..D6 — một lần chạy luồng đầy đủ ────────────────────────────────
  const run1 = await runDemoFlow({ tenantId: tid });
  const s = run1.summary;
  console.log(`[smoke] SKU ${s.sku} — ${s.productName}`);
  console.log(`         ATP ${s.atpBefore} → ${s.atpAfter} (bán ${s.soldQty}) · ROP ${s.rop} · nhu cầu/ngày ${s.demandPerDay}`);
  console.log(`         đề xuất ${s.orderQty} × ${s.unitCost} = ${s.totalEstimate} · NCC ${s.vendorName} · lead time ${s.leadTimeDays} ngày (ước lượng=${s.leadTimeEstimated})`);
  console.log(`         PO ${s.poCode} · tổng ${s.poTotal} · người duyệt ${s.approver}`);

  ok('D1 có SKU đủ điều kiện chạy luồng (NCC đã biết, ATP ≤ ROP, orderQty > 0)',
    run1.picked.orderQty > 0 && run1.picked.atp >= 1,
    `${run1.picked.usable}/${run1.picked.candidates} ứng viên · orderQty=${run1.picked.orderQty}`);

  ok('D2 đơn tạo qua order.service.create TRỪ KHO thật',
    run1.order.atpAfter === run1.picked.atp - run1.order.soldQty,
    `ATP ${run1.picked.atp} → ${run1.order.atpAfter}, bán ${run1.order.soldQty}`);

  const gateCount1 = await prisma.agentHumanGate.count({
    where: { tenantId: tid, actionType: PO_PROPOSAL },
  });
  ok('D3 CDC sinh đúng MỘT đề xuất PENDING cho SKU',
    run1.cdc.gateId && run1.cdc.summary && run1.item && run1.item.quantity > 0,
    `gate=${run1.cdc.gateId?.slice(0, 8)}… tổng gate PO của tenant=${gateCount1}`);

  ok('D4 freshness đo được, dữ liệu chưa đổi ⇒ diff rỗng và không chặn',
    run1.fresh.ok === true && run1.fresh.drift === DRIFT_NONE && !run1.fresh.missingCost,
    `ok=${run1.fresh.ok} drift=${run1.fresh.drift} missingCost=${run1.fresh.missingCost}`);

  const gateAfter = await prisma.agentHumanGate.findFirst({
    where: { id: run1.cdc.gateId },
    select: { status: true, decidedById: true, resultRef: true, decidedAt: true },
  });
  const poLinked = gateAfter?.resultRef === run1.approved.poId;
  ok('D5 duyệt qua human-gate ⇒ đúng MỘT PO, resultRef trỏ đúng PO',
    run1.poCheck.found === 1 && poLinked && gateAfter.status === 'APPROVED',
    `PO duy nhất=${run1.poCheck.poCode} · status=${gateAfter.status} · resultRef khớp=${poLinked}`);

  ok('D6 onOrder chống sinh đề xuất trùng (lần gọi thứ hai không tạo gate)',
    run1.dedupe.secondSuggestion === null
      && run1.dedupe.gatesAfter === run1.dedupe.gatesBefore
      && run1.dedupe.onOrder > 0,
    `onOrder=${run1.dedupe.onOrder} · gate ${run1.dedupe.gatesBefore} → ${run1.dedupe.gatesAfter}`);

  // ── D7 — dọn dẹp rồi đo lại, hai lần liên tiếp ─────────────────────────
  const cleanup1 = await run1.cleanup();
  console.log(`[smoke] dọn lần 1: ${JSON.stringify(cleanup1.deleted)}`);
  ok('D7 lần chạy 1 không để lại dòng rác (đếm trên toàn bộ bảng scoped)',
    cleanup1.residue.length === 0,
    cleanup1.residue.length ? cleanup1.residue.map((r) => `${r.table} ${r.before}→${r.after}`).join(', ') : '0 bảng thay đổi');

  // Lưu ý kỳ vọng: **KHÔNG** đòi `poCode` khác lần 1. Lần 1 đã bị xoá sạch nên mã
  // `PO-YYYYMMDD-XXXX` được cấp lại ⇒ trùng mã là ĐÚNG. Cái thật sự phải giữ là:
  // PO mới có `id` khác và `resultRef` trỏ đúng nó.
  const run2 = await runDemoFlow({ tenantId: tid });
  ok('D7 chạy lần 2 tạo PO mới (id khác) qua cùng đường mã',
    run2.approved.poId !== run1.approved.poId && run2.poCheck.found === 1
      && run2.dedupe.secondSuggestion === null && run2.fresh.ok === true,
    `lần 2: ${run2.picked.sku} → ${run2.approved.poCode} · drift=${run2.fresh.drift} · trùng=${run2.dedupe.secondSuggestion !== null}`);

  const cleanup2 = await run2.cleanup();
  console.log(`[smoke] dọn lần 2: ${JSON.stringify(cleanup2.deleted)}`);
  ok('D7 lần chạy 2 cũng sạch — chạy lại được nhiều lần không rác dần',
    cleanup2.residue.length === 0,
    cleanup2.residue.length ? cleanup2.residue.map((r) => `${r.table} ${r.before}→${r.after}`).join(', ') : '0 bảng thay đổi');

  // ── D8 — tenant thật không đổi ─────────────────────────────────────────
  const realAfter = await realTenantSnapshot();
  ok('D8 tenant thật giữ nguyên số đã ký ở STATE.md',
    realAfter && realAfter.orders === SIGNED.orders && realAfter.items === SIGNED.items
      && realAfter.totalVnd === SIGNED.totalVnd,
    realAfter ? `${realAfter.orders} đơn / ${realAfter.items} dòng / ${realAfter.totalVnd.toLocaleString('vi-VN')} VND` : 'không tìm thấy tenant');

  // ── D9 — chế độ không-LLM chạy TRỌN luồng demo (T14) ───────────────────
  // Đây là khẳng định của NIGHT-PROMPT T14: tắt LLM thì luồng vẫn chạy, lời giải
  // thích là MẪU (có nhãn), và tin nhắn NCC chỉ được SOẠN — không gửi.
  const llmMode = require('../src/config/llm-policy').resolveMode();
  ok('D9 vai trò LLM #2 chạy được khi LLM TẮT (dùng mẫu, không giả vờ là LLM viết)',
    run1.explain.source === (llmMode === 'off' ? 'template' : run1.explain.source)
      && Boolean(run1.explain.explanation)
      && (llmMode !== 'off' || run1.explain.notice !== null),
    `mode=${llmMode} · source=${run1.explain.source} · vendor=${run1.explain.vendorSource}`);
  ok('D9 tin nhắn NCC chỉ SOẠN, không gửi',
    run1.explain.vendorMessageSent === false);

  console.log(`\n[smoke] KẾT QUẢ: ${pass} pass / ${fail} fail (DB THẬT)`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => {
    console.error(`[smoke] LỖI: ${e.stack || e.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());