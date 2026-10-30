'use strict';

/**
 * scripts/smoke-llm-usage.js — SMOKE REPLAY: `LlmUsageLog` GHI ĐÚNG TENANT KHÔNG?
 *
 * ============================================================================
 * VÌ SAO SMOKE NÀY TỒN TẠI
 * ============================================================================
 * T13 thêm bảng `llm_usage_logs` (một trong hai bảng được phép thêm ở Vòng 2). Rủi ro
 * lớn nhất của một bảng có `tenantId` là **ghi nhầm tenant** — số tiền của khách A
 * lọt sang báo cáo của khách B. Unit test với Prisma mock **không bắt được** lỗi đó:
 * extension `tenantId` chỉ chạy khi có AsyncLocalStorage thật.
 *
 * Vì vậy khẳng định ở đây chạy trên DB thật, trong tenant context thật.
 *
 * ============================================================================
 * CÁCH CHẠY REPLAY KHÔNG CẦN KEY
 * ============================================================================
 * `LLM_MODE=replay` + `LLM_RECORD_PATH` trỏ tới tệp bản ghi tạm mà script tự dựng,
 * trong đó mỗi dòng ghi rõ:
 *   `provenance: "hand-authored fixture"`, `liveRunPerformed: false`
 *
 * Nghĩa là: đây KHÔNG phải đầu ra thật của Gemini. Không được dùng để công bố số
 * hiệu năng. Mục đích duy nhất là chứng minh **đường ống** (tái lập bản ghi, Zod,
 * ghi `LlmUsageLog`, dọn dẹp) chạy đúng mà không cần key — đúng như yêu cầu
 * "chế độ không-LLM và replay chạy được ngay cả khi demo dự phòng mất mạng".
 *
 * Chạy: npm run smoke:llm-usage
 */

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { assertLocalDb } = require('./lib/assert-local-db');
assertLocalDb('smoke-llm-usage');

// Phải đặt TRƯỚC khi require các module LLM: `resolveMode()` đọc env mỗi lần gọi
// nhưng `recordUsage`/store đọc `LLM_RECORD_PATH` lúc require.
const RECORD_PATH = path.join(os.tmpdir(), `aisc26-llm-replay-${process.pid}.jsonl`);
process.env.LLM_RECORD_PATH = RECORD_PATH;
process.env.LLM_MODE = 'replay';

const prisma = require('../src/config/prisma');
const { runWithTenant } = require('../src/config/tenantContext');
const llmPolicy = require('../src/config/llm-policy');
const { matchHybridBatch } = require('../src/modules/import/sku-matcher.hybrid');
const { explainProposal, draftVendorMessage, buildPayload, SYSTEM_EXPLAIN, SYSTEM_VENDOR: VENDOR_SYSTEM } = require('../src/modules/replenishment/proposal-explain.llm');
const hybridModule = require('../src/modules/import/sku-matcher.hybrid');
const { captureTenantCounts, diffTenantCounts, DEMO_SLUG } = require('./demo/demo-flow');
const { SkuMatcher } = require('../src/modules/import/sku-matcher');
const { readCsvObjects } = require('./lib/csv');

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label}${extra ? ` → ${extra}` : ''}`);
  if (cond) pass += 1;
  else fail += 1;
};

/** Danh mục SKU thật của tenant demo (đọc từ DB, không bịa). */
const loadCatalog = (tid) => runWithTenant(tid, () =>
  prisma.product.findMany({
    where: { tenantId: tid },
    orderBy: { sku: 'asc' },
    take: 400,
    select: { sku: true, name: true },
  }));

/**
 * Dựng bản ghi replay từ chính tên hàng thật + ứng viên thật của catalog ⇒ hợp đồng
 * JSON khớp với `LlmMatchSchema`, và tên/mã trong bản ghi là dữ liệu MÔ PHỎNG.
 */
const buildRecordFixture = (externalName, candidates, payload) => {
  // Prompt phải dựng ĐÚNG qua `buildPayload` của module, không tự chế JSON: nếu khác
  // thứ tự khoá thì hash khác ⇒ `replay` trượt bản ghi ⇒ nhầm là "chế độ không
  // hoạt động". Bài học này đã làm hỏng L5 ở lần chạy đầu.
  const explainPrompt = JSON.stringify(buildPayload(payload));
  const matchPrompt = hybridModule.buildUserPrompt(externalName, candidates);
  const rows = [
    {
      key: llmPolicy.callKey({
        task: llmPolicy.LLM_TASK.SKU_MATCH,
        system: hybridModule.SYSTEM_PROMPT,
        prompt: matchPrompt,
      }),
      task: llmPolicy.LLM_TASK.SKU_MATCH,
      model: 'replay-fixture',
      // Cố ý ghi số khác 0 để chứng minh token KHÔNG phải 0 và được ghi vào DB.
      usage: { promptTokens: 412, completionTokens: 38, totalTokens: 450 },
      text: JSON.stringify({ sku: candidates[0].sku, confidence: 0.91, reason: 'Bản ghi mô phỏng (không phải lần gọi live)' }),
      provenance: 'hand-authored fixture',
      liveRunPerformed: false,
      recordedAt: new Date().toISOString(),
    },
    {
      key: llmPolicy.callKey({
        task: llmPolicy.LLM_TASK.PROPOSAL_EXPLAIN,
        system: SYSTEM_EXPLAIN,
        prompt: explainPrompt,
      }),
      task: llmPolicy.LLM_TASK.PROPOSAL_EXPLAIN,
      model: 'replay-fixture',
      usage: { promptTokens: 260, completionTokens: 71, totalTokens: 331 },
      text: JSON.stringify({
        explanation: `Bản ghi mô phỏng: ${buildPayload(payload).name} còn ${buildPayload(payload).atp}, điểm đặt lại ${buildPayload(payload).rop}.`,
        flags: [],
      }),
      provenance: 'hand-authored fixture',
      liveRunPerformed: false,
      recordedAt: new Date().toISOString(),
    },
    {
      key: llmPolicy.callKey({
        task: llmPolicy.LLM_TASK.VENDOR_MESSAGE,
        system: VENDOR_SYSTEM,
        prompt: explainPrompt,
      }),
      task: llmPolicy.LLM_TASK.VENDOR_MESSAGE,
      model: 'replay-fixture',
      usage: { promptTokens: 240, completionTokens: 64, totalTokens: 304 },
      text: JSON.stringify({
        vendorMessage: `Bản ghi mô phỏng: đề nghị gửi báo giá cho ${buildPayload(payload).orderQty} ${buildPayload(payload).name}.`,
      }),
      provenance: 'hand-authored fixture',
      liveRunPerformed: false,
      recordedAt: new Date().toISOString(),
    },
  ];
  fs.writeFileSync(RECORD_PATH, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return rows.length;
};

/**
 * Tìm một tên hàng rơi vào ĐÚNG khoảng mơ hồ [REVIEW 0,62; 0,86).
 *
 * Vì sao phải tìm mà không tự chế: khi LLM tắt hoặc ca dễ, `matchHybridBatch` cố ý
 * KHÔNG gọi LLM ⇒ smoke sẽ "xanh" mà không chạm vào đường replay. Cần một ca mơ hồ
 * thật thì bản ghi replay mới được đọc. Dòng này in ra trạng thái fuzzy để thấy rõ.
 */
const findAmbiguousName = (catalog, matcher) => {
  const strategies = [
    (name) => String(name).split(' ').slice(0, Math.ceil(String(name).split(' ').length / 2)).join(' '),
    (name) => `${String(name).split(' ').slice(0, 2).join(' ')} SALE`,
    (name) => `${String(name).split(' ').slice(-2).join(' ')}`,
    (name) => `${String(name).toLowerCase()} (vn)`,
  ];
  for (const [i, product] of catalog.entries()) {
    for (const f of strategies) {
      const name = f(product.name || product.sku);
      const r = matcher.match(name, {});
      if (r.status === 'NEEDS_REVIEW') return { name, product, score: r.score, strategy: i };
    }
    if (i > 120) break; // giữ tìm kiếm có giới hạn: script phải chạy nhanh
  }
  return null;
};

async function main() {
  const tenantA = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  const tenantB = await prisma.tenant.findFirst({
    where: { slug: { not: DEMO_SLUG } },
    orderBy: { createdAt: 'asc' },
  });
  if (!tenantA || !tenantB) {
    console.error('[smoke] cần tenant demo + ít nhất 1 tenant khác để chứng minh cách ly.');
    process.exit(1);
  }
  const A = tenantA.id;
  const B = tenantB.id;
  console.log(`[smoke] tenant A = ${tenantA.slug} (${A}) · tenant B = ${tenantB.slug} (${B})`);
  console.log(`[smoke] LLM_MODE=${llmPolicy.resolveMode()} · có key: ${llmPolicy.describe().configured ? 'có' : 'KHÔNG (đúng — replay không cần key)'}`);

  const catalog = await loadCatalog(A);
  if (!catalog.length) {
    console.error('[smoke] tenant demo chưa nạp SKU. Chạy: npm run data:import -- --reset --apply');
    process.exit(1);
  }

  // Chọn một ca MƠ HỒ thật (điểm ∈ [REVIEW, AUTO_ACCEPT)) — đúng dải mà vai trò #1
  // được phép gọi LLM.
  const probePick = findAmbiguousName(catalog, new SkuMatcher(catalog));
  if (!probePick) {
    console.error('[smoke] KHÔNG tìm được ca mơ hồ nào trong catalog — không chứng minh được đường replay.');
    process.exit(1);
  }
  const { name: noisy, product: probe, score } = probePick;
  console.log(`[smoke] ca mo ho: "${noisy}" → fuzzy NEEDS_REVIEW (điểm ${score}) · ứng viên đúng: ${probe.sku}`);

  const payload = {
    sku: probe.sku,
    name: probe.name,
    atp: 12, rop: 30, safetyStock: 9, demandPerDay: 2.1,
    leadTimeDays: 7, leadTimeEstimated: true, daysOfCoverLeft: 5.7,
    orderQty: 42, unitCost: 45000, total: 1890000,
    vendorName: 'NCC mô phỏng', vendorOtfif: 0.86, stockoutDaysLast90: 3,
  };
  const candidates = new SkuMatcher(catalog).candidatesFor(noisy, { topK: 5 });
  const nFixture = buildRecordFixture(noisy, candidates, payload);
  console.log(`[smoke] bản ghi replay tạm: ${nFixture} dòng (${path.basename(RECORD_PATH)}) — provenance=hand-authored, KHÔNG phải live`);

  const beforeA = await captureTenantCounts(A);
  const beforeB = await captureTenantCounts(B);

  // ── chạy trong context tenant A ────────────────────────────────────────
  const resA = await runWithTenant(A, async () => {
    const hybrid = await matchHybridBatch([{ name: noisy, ref: 'SMOKE-A' }], catalog, { useLlm: true });
    const explain = await explainProposal(payload);
    const vendor = await draftVendorMessage(payload);
    return { hybrid, explain, vendor };
  });

  // ── chạy lại trong context tenant B (cùng đầu vào) ─────────────────────
  const resB = await runWithTenant(B, async () => {
    const hybrid = await matchHybridBatch([{ name: noisy, ref: 'SMOKE-B' }], catalog, { useLlm: true });
    return { hybrid };
  });

  const rowsA = await prisma.llmUsageLog.findMany({ where: { tenantId: A }, orderBy: { createdAt: 'asc' } });
  const rowsB = await prisma.llmUsageLog.findMany({ where: { tenantId: B }, orderBy: { createdAt: 'asc' } });

  ok('L1 replay đọc được bản ghi (không gọi mạng, không cần key)',
    resA.hybrid.stats.llmCalls >= 1 && resA.hybrid.stats.mode === 'replay',
    `llmCalls=${resA.hybrid.stats.llmCalls} · mode=${resA.hybrid.stats.mode}`);

  ok('L2 vai trò #1 dùng được bản ghi: khớp SKU trả về sku trong ứng viên',
    resA.hybrid.matched.length + resA.hybrid.reviewQueue.length === 1
      && (resA.hybrid.matched[0]?.via === 'llm' || resA.hybrid.reviewQueue[0]?.via === 'llm'),
    `via=${(resA.hybrid.matched[0] || resA.hybrid.reviewQueue[0])?.via} sku=${(resA.hybrid.matched[0] || resA.hybrid.reviewQueue[0])?.sku}`);

  ok('L3 vai trò #2: lời giải thích có nguồn rõ ràng (llm | template)',
    ['llm', 'template'].includes(resA.explain.source) && ['llm', 'template'].includes(resA.vendor.source),
    `explanation=${resA.explain.source} · vendorMessage=${resA.vendor.source}`);
  ok('L4 tin nhắn NCC CHỈ SOẠN: sent=false, requiresHumanSend=true',
    resA.vendor.sent === false && resA.vendor.requiresHumanSend === true);

  ok('L5 ghi đúng tenant A (mọi dòng đều mang tenantId = A)',
    rowsA.length >= 2 && rowsA.every((r) => r.tenantId === A),
    `${rowsA.length} dòng · task=${[...new Set(rowsA.map((r) => r.task))].join(',')}`);

  ok('L6 CÁCH LY: chạy trong context tenant B chỉ ghi vào B, không đụng dòng của A',
    rowsB.length >= 1 && rowsB.every((r) => r.tenantId === B) && rowsB.every((r) => r.tenantId !== A),
    `A=${rowsA.length} dòng · B=${rowsB.length} dòng`);

  const tokenRow = rowsA.find((r) => r.totalTokens > 0);
  ok('L7 token lấy từ usageMetadata được ghi xuống DB (totalTokens > 0)',
    Boolean(tokenRow) && tokenRow.promptTokens > 0 && tokenRow.completionTokens > 0,
    tokenRow ? `${tokenRow.task}: ${tokenRow.promptTokens}+${tokenRow.completionTokens}=${tokenRow.totalTokens} (mode=${tokenRow.mode})` : 'chưa có dòng nào có token');

  ok('L8 dòng ghi có mode đúng để không ai đọc nhầm là số live',
    rowsA.every((r) => ['replay', 'live', 'record', 'fallback'].includes(r.mode)),
    `mode=${[...new Set(rowsA.map((r) => r.mode))].join(',')}`);

  // ── dọn dẹp: CHỈ xoá các dòng chính lần chạy này sinh ra ───────────────
  // Không `deleteMany({tenantId})` — cách đó xoá luôn dữ liệu của lần chạy khác và,
  // tệ hơn, làm cho mọi lỗi dở dang trước đó biến mất ⇒ smoke thành "tự dọn giùm
  // chính bằng chứng". Dòng còn sót từ lần chạy bị hủy phải hiện ra ở `leftover`.
  const since = new Date(Date.now() - 60_000); // độ trễ nhỏ cho lệch đồng hồ DB
  const freshA = await prisma.llmUsageLog.findMany({ where: { tenantId: A, createdAt: { gte: since } }, select: { id: true } });
  const freshB = await prisma.llmUsageLog.findMany({ where: { tenantId: B, createdAt: { gte: since } }, select: { id: true } });
  const idsA = freshA.map((r) => r.id);
  const idsB = freshB.map((r) => r.id);
  const deleted = {
    A: idsA.length ? (await prisma.llmUsageLog.deleteMany({ where: { id: { in: idsA } } })).count : 0,
    B: idsB.length ? (await prisma.llmUsageLog.deleteMany({ where: { id: { in: idsB } } })).count : 0,
  };
  const residueA = diffTenantCounts(beforeA, await captureTenantCounts(A));
  const residueB = diffTenantCounts(beforeB, await captureTenantCounts(B));
  const leftover = {
    A: (await prisma.llmUsageLog.count({ where: { tenantId: A } })) - (beforeA.llm_usage_logs ?? 0),
    B: (await prisma.llmUsageLog.count({ where: { tenantId: B } })) - (beforeB.llm_usage_logs ?? 0),
  };
  ok('L9 dọn sạch — chạy lại nhiều lần không rác dần',
    residueA.length === 0 && residueB.length === 0 && leftover.A === 0 && leftover.B === 0,
    `xoá ${deleted.A}+${deleted.B} dòng · residue A=${residueA.length} B=${residueB.length} · dòng sót từ lần chạy cũ A=${leftover.A} B=${leftover.B}`);

  console.log(`\n[smoke] KẾT QUẢ: ${pass} pass / ${fail} fail (DB THẬT, chế độ replay, không cần key)`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => {
    console.error(`[smoke] LỖI: ${e.stack || e.message}`);
    process.exit(1);
  })
  .finally(async () => {
    try { fs.unlinkSync(RECORD_PATH); } catch { /* tệp tạm, không cần báo */ }
    await prisma.$disconnect();
  });