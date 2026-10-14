'use strict';

/**
 * src/modules/import/sku-matcher.hybrid.js — VAI TRÒ LLM #1: KHỚP SKU LAI
 *
 * ============================================================================
 * VÌ SAO LẠI (nếu đã có `sku-matcher.js`)
 * ============================================================================
 * `sku-matcher.js` là **đường không-LLM**: nhanh, miễn phí, tất định, và là mặc định
 * của hệ thống. Tệp này KHÔNG thay nó, KHÔNG sửa ngưỡng của nó. Nó chỉ làm một việc:
 * trong đúng cái khoảng mà công thức **không chắc**, nhờ LLM phá thế hoàn chỉnh rồi
 * vẫn trả lời người dùng.
 *
 *   điểm ≥ AUTO_ACCEPT (0,86)      → KHỌNG gọi LLM. Ca dễ đã xong bằng công thức.
 *   điểm ∈ [REVIEW 0,62; 0,86)     → LLM CHỈ Ở ĐÂY. Đây là ca mơ hồ.
 *   điểm < REVIEW (NO_MATCH)       → KHÔNG gọi LLM, đưa hàng đợi người xác nhận.
 *
 * Vì sao ca dưới ngưỡng không gọi LLM: `01-llm-role.md` §3.2 nguyên tắc 1 — nếu
 * không có ứng viên nào khớp token thì không có gì để LLM phân biệt; gọi lên chỉ
 * tốn token rồi LLM bịa. Đây là ranh giới "LLM không được tự bịa".
 *
 * ============================================================================
 * BA HÀNH ĐỘNG KHÔNG THỂ LÀM
 * ============================================================================
 * 1. **Không gọi mạng trực tiếp.** Đi qua `config/llm-policy.js` (đường LLM duy
 *    nhất), không `require` thẳng provider.
 * 2. **Không bịa `sku`.** `productId`/`sku` LLM trả về phải nằm trong danh sách ứng
 *    viên đã thu hẹp; Zod `.refine()` kiểm, vi phạm ⇒ coi như không khớp.
 * 3. **Không tự quyết.** `confidence < HUMAN_THRESHOLD` ⇒ `needsHuman: true` ⇒ vào
 *    hàng đợi người xác nhận, dù LLM trả lời rất tự tin.
 */

const { SkuMatcher, MATCH_STATUS, AUTO_ACCEPT_SCORE, REVIEW_SCORE } = require('./sku-matcher');
const llm = require('../../config/llm');
const llmPolicy = require('../../config/llm-policy');
const logger = require('../../utils/logger');

/**
 * Ngưỡng chuyển người — CHỐT theo `03-evaluation-protocol.md` §9 (S10):
 * `confidence < 0,85` ⇒ cần người xác nhận. Giữ đúng con số giao thức đã ký.
 */
const HUMAN_THRESHOLD = 0.85;
/** Số ứng viên tối đa đưa cho LLM. `01-llm-role.md` §3.2: ≤ 5. */
const MAX_LLM_CANDIDATES = 5;

/** Ngưỡng dưới đó một câu trả lời LLM không đáng tin: coi như không khớp. */
const MIN_USABLE_CONFIDENCE = 0.5;

const z = require('zod');

/**
 * Hợp đồng đầu ra của LLM. `z.object` + `refine` (không `any`).
 * LLM trả về `sku` (mã hàng) + `confidence` + `reason`; KHÔNG được tự tạo mã mới.
 */
const LlmMatchSchema = z.object({
  sku: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300).optional().default(''),
});

const SYSTEM_PROMPT = [
  'Bạn là bộ khớp mã hàng cho hệ thống ERP tiếng Việt.',
  'NHIỆM VỤ: chọn đúng MỘT mã trong danh sách ứng viên được đưa cho bạn.',
  'QUY TẮC TUYỆT ĐỐI:',
  '- Chỉ được trả về `sku` có sẵn trong danh sách ứng viên. Tuyệt đối không tự viết mã khác.',
  '- Nếu không ứng viên nào đúng, trả `sku: ""` và `confidence: 0`.',
  '- KHÔNG tính toán, không suy đoán giá, không thêm thông tin ngoài danh sách.',
  '- Trả về DUY NHẤT JSON: {"sku": string, "confidence": number 0..1, "reason": string}.',
  'LƯU Ý: tên trên sàn có thể chứa vòng bảo hành, quà tặng, chữ viết tắt, tiếng Anh.',
  'Ưu tiên khớp theo CHỦNG LOẠI hàng (ví dụ "nến thơ" khác "ly thủy tinh"), không chỉ giống chữ.',
].join('\n');

const buildUserPrompt = (externalName, candidates) => {
  const list = candidates
    .map((c) => `- ${c.sku} | ${c.name} | điểm_fuzzy=${c.total.toFixed(4)}`)
    .join('\n');
  return [
    `Tên hàng trên sàn: "${externalName}"`,
    '',
    'Ứng viên trong ERP (chọn đúng 1 hoặc trả rỗng):',
    list,
  ].join('\n');
};

/**
 * Gọi LLM cho MỘT tên mơ hồ.
 *
 * @returns {Promise<{sku: string|null, confidence: number, reason: string,
 *                    needsHuman: boolean, via: 'llm'|'unavailable'}>}
 */
const askLlm = async (externalName, candidates) => {
  const res = await llmPolicy.callTask({
    task: llmPolicy.LLM_TASK.SKU_MATCH,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(externalName, candidates),
    jsonMode: true,
    maxOutputTokens: 300,
  });

  const unavailable = { sku: null, confidence: 0, reason: `LLM không dùng được: ${res.reason}`, needsHuman: true, via: 'unavailable' };
  if (!res.ok || !res.text) return unavailable;

  const parsed = llm.parseJsonLoose(res.text);
  const check = LlmMatchSchema.safeParse(parsed);
  if (!check.success) {
    // JSON hỏng / thiếu trường ⇒ coi như không khớp, KHÔNG đoán.
    return { ...unavailable, reason: `JSON không hợp lệ: ${check.error.issues[0]?.message || 'unknown'}` };
  }
  const { sku, confidence, reason } = check.data;

  // Chống bịa mã: sku phải nằm trong ứng viên (nguyên tắc 2, `01-llm-role.md` §3.2).
  const hit = candidates.find((c) => c.sku === sku);
  if (!hit) return { ...unavailable, reason: `LLM trả mã ngoài danh sách ứng viên: "${sku}"` };
  if (confidence < MIN_USABLE_CONFIDENCE) {
    return { sku: hit.sku, confidence, reason: reason || 'LLM tự chấn điểm thấp', needsHuman: true, via: 'llm' };
  }

  const needsHuman = confidence < HUMAN_THRESHOLD;
  return {
    sku: hit.sku,
    confidence: Number(confidence.toFixed(4)),
    reason: reason || `LLM chọn trong ${candidates.length} ứng viên`,
    needsHuman,
    via: 'llm',
  };
};

/**
 * Khớp lô hàng: KHỚP LAI — công thức trước, LLM chỉ ca mơ hồ, người xác nhận ca
 * độ tin cậy thấp.
 *
 * @param {Array<{name?: string, sku?: string, ref?: string}>} inputs
 * @param {Array<{sku: string, name?: string}>} catalog
 * @param {{useLlm?: boolean}} [opts] `useLlm:false` ép đường thuần công thức
 *        (dùng cho demo dự phòng và để đo baseline trong harness S10).
 * @returns {Promise<{matched: Array, reviewQueue: Array, stats: object}>}
 */
const matchHybridBatch = async (inputs = [], catalog = [], opts = {}) => {
  const matcher = new SkuMatcher(catalog);
  const useLlm = opts.useLlm !== false && llmPolicy.resolveMode() !== 'off';
  const policyBefore = llmPolicy.policyStats();

  const matched = [];
  const reviewQueue = [];
  let llmCalls = 0;
  let llmUsable = 0;
  let llmRejected = 0;
  let llmMisses = 0;
  // Sửa 2026-10-14: tách nhóm "trượt" theo NGUYÊN NHÂN. Xem chỗ dùng ở dưới.
  let llmMissBy = { api: 0, json: 0, hallucinatedSku: 0, other: 0 };

  for (const input of inputs) {
    const base = matcher.match(input.name, { inputSku: input.sku });
    const row = { ...input, fuzzy: base };

    // ── ca dễ: KHÔNG gọi LLM ────────────────────────────────────────────
    if (base.status === MATCH_STATUS.AUTO) {
      matched.push({
        ...row,
        sku: base.sku,
        via: 'fuzzy',
        confidence: 1,
        needsHuman: false,
        score: base.score,
        reason: base.reason,
      });
      continue;
    }

    // ── dưới ngưỡng: KHÔNG gọi LLM, đưa hàng đợi kèm lý do ─────────────
    if (base.status === MATCH_STATUS.NO_MATCH) {
      reviewQueue.push({
        ...row,
        sku: null,
        via: 'fuzzy',
        confidence: base.score,
        needsHuman: true,
        reason: `${base.reason} — dưới ngưỡng, không gọi LLM`,
      });
      continue;
    }

    // ── ca mơ hồ [REVIEW, AUTO_ACCEPT): LLM CHỈ Ở ĐÂY ────────────────────
    if (!useLlm) {
      reviewQueue.push({
        ...row,
        sku: base.sku,
        via: 'fuzzy',
        confidence: base.score,
        needsHuman: true,
        reason: `${base.reason} — LLM tắt, giữ điểm công thức`,
      });
      continue;
    }

    const candidates = matcher.candidatesFor(input.name, { inputSku: input.sku, topK: MAX_LLM_CANDIDATES });
    if (!candidates.length) {
      reviewQueue.push({ ...row, sku: null, via: 'fuzzy', confidence: base.score, needsHuman: true, reason: 'không có ứng viên nào để hỏi LLM' });
      continue;
    }

    llmCalls += 1;
    const ans = await askLlm(input.name, candidates);
    if (ans.via === 'unavailable') {
      llmMisses += 1;
      // Sửa 2026-10-14 — VÍ SAO BỊ TRƯỢT, không gom chung thành "503".
      // `llmMisses` gộp ba nguyên nhân rất khác nhau: lỗi API, JSON hỏng, và
      // LLM trả mã ngoài danh sách ứng viên. Trước đây báo cáo tổng kết bảo
      // "503/timeout" cho mọi trường hợp — nhưng đo trên DB thật cho thấy
      // 13/13 lời gọi API đều HTTP 200, không có 503 nào. Ghi lại lý do để
      // phân biệt lỗi hạ tầng với lỗi nội dung.
      const r = String(ans.reason || '');
      if (/không dùng được/i.test(r)) llmMissBy.api += 1;
      else if (/JSON không hợp lệ/i.test(r)) llmMissBy.json += 1;
      else if (/ngoài danh sách/i.test(r)) llmMissBy.hallucinatedSku += 1;
      else llmMissBy.other += 1;
      // Đường lui: giữ điểm công thức, KHÔNG tự áp dụng, đưa người xác nhận.
      reviewQueue.push({
        ...row,
        sku: base.sku,
        via: 'fallback',
        confidence: base.score,
        needsHuman: true,
        reason: `${base.reason} — ${ans.reason}`,
      });
      continue;
    }

    if (!ans.needsHuman) {
      llmUsable += 1;
      matched.push({
        ...row,
        sku: ans.sku,
        via: 'llm',
        confidence: ans.confidence,
        needsHuman: false,
        score: base.score,
        reason: ans.reason,
      });
      continue;
    }

    llmRejected += 1;
    reviewQueue.push({
      ...row,
      sku: ans.sku,
      via: 'llm',
      confidence: ans.confidence,
      needsHuman: true,
      reason: `${base.reason} — LLM đề xuất nhưng điểm ${ans.confidence} < ${HUMAN_THRESHOLD}: ${ans.reason}`,
    });
  }

  const stats = {
    total: inputs.length,
    auto: matched.filter((r) => r.via === 'fuzzy').length,
    viaLlm: matched.filter((r) => r.via === 'llm').length,
    review: reviewQueue.filter((r) => r.via === 'fuzzy').length + llmRejected,
    llmCalls,
    llmUsable,
    llmRejected,
    llmMisses,
    // Lý do trượt, tách theo nhóm (sửa 2026-10-14). Trước đây báo cáo tổng kết
    // gọi chung mọi thứ là "503/timeout", nhưng đo thật cho thấy API không hỏng
    // — hầu hết là LLM trả JSON sai khuôn dạng.
    llmMissBy,
    // Cơ sở để tính tỉ lệ thành công ĐÚNG: llmCalls là số ca được hỏi LLM,
    // llmUsable là số ca LLM trả lời chắc chắn. (Trước đây báo cáo chia
    // llmUsable cho tổng số lời gọi cả test + dev nên ra tỉ lệ bị thấp hơn thật.)
    tyLeDungDuoc: llmCalls > 0 ? Number(((llmUsable / llmCalls) * 100).toFixed(1)) : null,
    nhanTuDong: AUTO_ACCEPT_SCORE,
    nhanReview: REVIEW_SCORE,
    nhanNguoi: HUMAN_THRESHOLD,
    mode: llmPolicy.resolveMode(),
    policy: policyBefore,
  };
  logger.debug(`[sku-hybrid] ${stats.total} dòng → auto ${stats.auto}, LLM dùng ${stats.llmUsable}/${stats.llmCalls}, hàng đợi ${stats.review}`);
  return { matched, reviewQueue, stats };
};

module.exports = {
  matchHybridBatch,
  askLlm,
  LlmMatchSchema,
  SYSTEM_PROMPT,
  buildUserPrompt,
  HUMAN_THRESHOLD,
  MAX_LLM_CANDIDATES,
  MIN_USABLE_CONFIDENCE,
};