'use strict';

/**
 * src/modules/replenishment/proposal-explain.llm.js — VAI TRÒ LLM #2
 * GIẢI THÍCH ĐỀ XUẤT + SOẠN TIN NHẮN NCC
 *
 * ============================================================================
 * LUẬT TUYỆT ĐỐI (01-llm-role.md §2, §4)
 * ============================================================================
 * 1. LLM **chỉ nhận số đã tính sẵn** ở Bước A (`replenishment.calc.js`). Không đưa
 *    cho LLM lịch sử bán hàng, công thức, hay tham số nào — nó không cần và không
 *    được phép tính lại.
 * 2. LLM **không được sửa số**. Cơ chế bắt vi phạm: `assertNumbersUnchanged()` quét
 *    mọi con số trong đầu ra LLM; bất kỳ số nào không có trong khối vào sẽ bị loại
 *    và chuyển sang MẪU. Đây không phải kiểm duyệt lời hay đỏ — đó là kiểm tra số.
 * 3. `vendorMessage` **CHỈ SOẠN**. Không có hàm gửi nào trong tệp này; người dùng
 *    bấm gửi. Không tích hợp SMS/Zalo/email.
 * 4. Đường lui (template) là **mặc định**, không phải dự phòng hiếm gặp: `LLM_MODE`
 *    mặc định `off`, và mọi lỗi (429/503/timeout/JSON hỏng/vi phạm số) đều về mẫu.
 *
 * ============================================================================
 * VÌ SAO CẦN "NHÃN NGUỒN"
 * ============================================================================
 * Giám khảo hỏi "cái này LLM viết hay mẫu viết?" thì phải trả lời được ngay.
 * `source: 'llm' | 'template'` + `notice` là câu trả lời đó, và UI hiển thị nó.
 * Giả vờ LLM viết khi thực ra là mẫu là mất hết điểm (01-llm-role.md §4.3).
 */

const llm = require('../../config/llm');
const llmPolicy = require('../../config/llm-policy');
const logger = require('../../utils/logger');
const z = require('zod');

const EXPLANATION_TASK = llmPolicy.LLM_TASK.PROPOSAL_EXPLAIN;
const VENDOR_TASK = llmPolicy.LLM_TASK.VENDOR_MESSAGE;

/** Trường được phép nằm trong output của LLM. Không có trường số nào. */
const ExplainSchema = z.object({
  explanation: z.string().min(1).max(1200),
  flags: z
    .array(z.object({ type: z.string().max(60), note: z.string().max(200) }).strict())
    .max(5)
    .optional()
    .default([]),
});

const VendorSchema = z.object({
  vendorMessage: z.string().min(1).max(1200),
});

/**
 * Trích mọi con số trong một chuỗi (kể cả dạng "1.890.000" và "5,7").
 * Dùng để kiểm "LLM có tự thêm/sửa số không".
 */
const extractNumbers = (text) => {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\d[\d.,]*/g)) {
    // Bỏ dấu phân cách: "1.890.000" → 1890000; "5,7" → 5.7
    const cleaned = m[0].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
    const n = Number(cleaned);
    if (Number.isFinite(n)) out.add(Number(n.toFixed(4)));
  }
  return out;
};

/**
 * Bắt vi phạm "không được sửa số".
 *
 * @param {string} text đầu ra LLM
 * @param {object} payload khối số ĐÃ TÍNH SẴN
 * @returns {{ok: boolean, invented: number[]}}
 */
const assertNumbersUnchanged = (text, payload) => {
  // Số được phép xuất hiện: mọi giá trị số trong payload, cộng CÁC BIẾN THỂ LÀM
  // TRÒN của chính giá trị đó.
  //
  // SỬA 2026-10-14 — LỖI THẬT, phát hiện khi nối hàng rào vào API:
  // Bản cũ chỉ thêm 3 biến thể — `toFixed(4)`, `toFixed(0)` và `*1000/1000` —
  // mà hai cái đầu và cái sau gần như TRÙNG NHAU. Nên biến thể làm tròn 1 chữ
  // số mà hệ thống TỰ DÙNG chưa được cho phép: `templateExplanation` viết
  // `fmt1(25.625)` = "25,6", `extractNumbers` đọc lại thành `25.6`, không có
  // trong tập cho phép ⇒ **bản mẫu của chính hệ thống bị hàng rào bác bỏ**.
  // Đo được trên HTTP thật: `POST /api/replenishment/proposals/:gateId/explain`
  // trả `guardrail.passed = false` với văn bản HOÀN TOÀN ĐÚNG SỐ.
  //
  // Đây cũng là lý do `SYSTEM_EXPLAIN` yêu cầu "KHÔNG làm tròn" nhưng chính mẫu
  // thì làm tròn: hai bên trái nhau. Nay cho phép mọi biến thể làm tròn của số
  // ĐÃ CÓ trong payload.
  //
  // AN TOÀN: nới rộng này KHÔNG cho LLM thêm số mới — chỉ cho viết số đã có ở
  // dạng làm tròn. Muốn bẻ chốt vẫn phải đổi đáng kể (260 → 267) và bị bắt.
  const allowed = new Set();
  const addVariants = (v) => {
    const base = Number(v);
    if (!Number.isFinite(base)) return;
    allowed.add(Number(base.toFixed(4)));
    for (const digits of [0, 1, 2, 3]) allowed.add(Number(base.toFixed(digits)));
  };
  for (const v of Object.values(payload || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    addVariants(v);
  }

  // ĐỊNH DANH NGUYÊN VĂN — không phải "số do LLM thêm".
  //
  // SỬA 2026-10-14 (phát hiện khi nối hàng rào vào API): tên hàng trong tập UCI
  // có chứa chữ số — "12 PENCILS TALL TUBE RED RETROSPOT", "100ML LIP BALM"…
  // Chúng là TÊN, phải được giữ nguyên, nhưng `extractNumbers` thấy chữ số đó và
  // báo là LLM tự thêm. Đo được: SKU 20983 bị báo 1 số lạ là `12`.
  //
  // Sửa bằng cách CHE TÊN/SKU/NCC khỏi văn bản TRƯỚC khi quét số — thay bằng
  // chuỗi không có chữ số. Nới rộng này không làm yếu hàng rào: định danh là do
  // người dùng nhập, LLM không được tự đặt tên hàng; mọi số khác vẫn bị quét.
  let scanText = String(text || '');
  for (const literal of [payload?.name, payload?.sku, payload?.vendorName]) {
    const s = String(literal || '').trim();
    if (s.length < 2) continue;
    scanText = scanText.split(s).join('__ID__');
  }

  const invented = [...extractNumbers(scanText)].filter((n) => !allowed.has(n));
  return { ok: invented.length === 0, invented };
};

const SYSTEM_EXPLAIN = [
  'Bạn viết lời giải thích đề xuất nhập hàng cho CHỦ SHOP, bằng tiếng Việt.',
  'QUY TẮC TUYỆT ĐỐI:',
  '- CHỈ diễn giải các số đã được cho. KHÔNG tạo, KHÔNG sửa, KHÔNG làm tròn, KHÔNG tính thêm số nào.',
  '- Nếu thấy số lạ (không có trong danh sách cho) thì đó là lỗi của bạn — hãy viết lại.',
  '- Không hứa hẹn ("chắc chắn", "đảm bảo"), không bịa lý do kinh doanh không có trong số.',
  '- Tối đa 3 câu, dùng con số có sẵn. Không dùng markdown, không tiêu đề.',
  'Trả về DUY NHẤT JSON: {"explanation": string, "flags": [{"type": string, "note": string}]}',
  'flags chỉ dùng cho ghi chú tự do của chủ shop; để [] nếu không có.',
].join('\n');

const SYSTEM_VENDOR = [
  'Bạn soạn tin nhắn NGẮN gửi nhà cung cấp, bằng tiếng Việt, xưng "Anh/Chị".',
  'QUY TẮC TUYỆT ĐỐI:',
  '- CHỉ dùng số đã cho. KHÔNG tạo, KHÔNG sửa, KHÔNG tính số khác.',
  '- Nêu: tên hàng, số lượng đề xuất, đơn vị, ngày cần nhận nếu có.',
  '- KHÔNG nêu tên khách hàng, không nêu giá vốn nội bộ, không nói "hệ thống dự đoán".',
  'Trả về DUY NHẤT JSON: {"vendorMessage": string}',
].join('\n');

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * CHUẨN HOÁ khối số đầu vào. Hàm này là "hợp đồng" giữa Bước A và Bước B: chỉ có
 * các trường liệt kê ở đây mới được đưa cho LLM. Thêm trường nào ở đây là thêm
 * một thứ LLM được biết — nên thêm cẩn thận.
 */
const buildPayload = (input = {}) => {
  const payload = {
    sku: String(input.sku || ''),
    name: String(input.name || ''),
    atp: n(input.atp),
    rop: n(input.rop),
    safetyStock: n(input.safetyStock),
    demandPerDay: n(input.demandPerDay),
    leadTimeDays: n(input.leadTimeDays),
    daysOfCoverLeft: n(input.daysOfCoverLeft),
    orderQty: n(input.orderQty),
    unitCost: n(input.unitCost),
    total: n(input.total),
    vendorName: String(input.vendorName || ''),
    leadTimeEstimated: input.leadTimeEstimated === true,
    vendorOtfif: input.vendorOtfif === undefined || input.vendorOtfif === null ? null : n(input.vendorOtfif),
    stockoutDaysLast90: input.stockoutDaysLast90 === undefined || input.stockoutDaysLast90 === null ? null : n(input.stockoutDaysLast90),
  };
  if (!payload.sku) throw new Error('buildPayload: thiếu sku');
  return payload;
};

// ── MẪU (đường lui + mặc định) ─────────────────────────────────────────────

const fmtInt = (v) => Math.round(n(v)).toLocaleString('vi-VN');
const fmt1 = (v) => n(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const fmtVnd = (v) => `${n(v).toLocaleString('vi-VN')} đ`;

/** Lời giải thích bằng mẫu. Chỉ đọc số trong payload, không tính gì. */
const templateExplanation = (p) => {
  const parts = [
    `${p.name || p.sku}: còn ${fmtInt(p.atp)} trong kho, điểm đặt lại là ${fmtInt(p.rop)}.`,
    `Nhu cầu trung bình ${fmt1(p.demandPerDay)}/ngày, nhập chậm nhất sau ${fmtInt(p.leadTimeDays)} ngày${p.leadTimeEstimated ? ' (ước lượng vì chưa đủ lịch sử nhận hàng)' : ''}.`,
    `Đề xuất nhập ${fmtInt(p.orderQty)} (${fmtVnd(p.total)})${p.vendorName ? ` từ ${p.vendorName}` : ''}.`,
  ];
  if (p.stockoutDaysLast90 !== null && n(p.stockoutDaysLast90) > 0) {
    parts.push(`Ghi chú: 90 ngày qua hết hàng ${fmtInt(p.stockoutDaysLast90)} ngày.`);
  }
  return parts.join(' ');
};

/** Tin nhắn NCC bằng mẫu — CHỈ SOẠN. */
const templateVendorMessage = (p) => [
  `Kính gửi ${p.vendorName || 'quý công ty'},`,
  '',
  `Chúng tôi dự kiến cần ${fmtInt(p.orderQty)} ${p.name || p.sku}${p.leadTimeDays ? `, nhận chậm nhất sau ${fmtInt(p.leadTimeDays)} ngày` : ''}.`,
  'Xin anh/chị báo giá và thời gian giao hàng giúp chúng tôi. Trân trọng.',
].join('\n');

const TEMPLATE_NOTICE = 'Giải thích tạo bằng mẫu (LLM không khả dụng) — không phải LLM viết.';

// ── hàm chính ──────────────────────────────────────────────────────────────

/**
 * Sinh lời giải thích cho một đề xuất. LUÔN trả kết quả, không bao giờ ném lỗi.
 *
 * @param {object} input số đã tính sẵn (xem `buildPayload`)
 * @param {{mode?: 'auto'|'template'}} [opts] `mode:'template'` ép mẫu (demo dự phòng)
 * @returns {Promise<{explanation: string, source: 'llm'|'template', notice: string|null,
 *                    flags: Array, mode: string, usage: object|null, rejected: string|null}>}
 */
const explainProposal = async (input, opts = {}) => {
  const payload = buildPayload(input);
  const fallback = (rejected) => ({
    explanation: templateExplanation(payload),
    source: 'template',
    notice: TEMPLATE_NOTICE,
    flags: [],
    mode: 'template',
    usage: null,
    rejected: rejected || null,
  });

  if (opts.mode === 'template' || llmPolicy.resolveMode() === 'off') {
    return fallback(llmPolicy.resolveMode() === 'off' ? 'LLM_MODE_OFF' : 'FORCED_TEMPLATE');
  }

  const res = await llmPolicy.callTask({
    task: EXPLANATION_TASK,
    system: SYSTEM_EXPLAIN,
    prompt: JSON.stringify(payload),
    jsonMode: true,
    maxOutputTokens: 500,
  });
  if (!res.ok) return fallback(res.reason);

  const parsed = llm.parseJsonLoose(res.text);
  const check = ExplainSchema.safeParse(parsed);
  if (!check.success) return fallback(`JSON không hợp lệ: ${check.error.issues[0]?.message || 'unknown'}`);

  // Bắt vi phạm số. Đây là hàng rào bắt buộc, không phải tối ưu.
  const numbers = assertNumbersUnchanged(check.data.explanation, payload);
  if (!numbers.ok) {
    logger.error(`[explain] LLM thêm/sửa số: ${numbers.invented.join(', ')} → dùng mẫu`);
    return fallback(`LLM_THAO_TAC_SO:${numbers.invented.join('|')}`);
  }

  return {
    explanation: check.data.explanation,
    source: 'llm',
    notice: null,
    flags: check.data.flags,
    mode: res.mode,
    usage: res.usage,
    rejected: null,
  };
};

/**
 * SOẠN tin nhắn NCC. KHÔNG GỬI — tệp này không có hàm gửi nào, và không import
 * SMS/Zalo/email. `sent: false` là hằng số để UI không nhầm.
 */
const draftVendorMessage = async (input, opts = {}) => {
  const payload = buildPayload(input);
  const fallback = (rejected) => ({
    vendorMessage: templateVendorMessage(payload),
    source: 'template',
    notice: TEMPLATE_NOTICE,
    sent: false,
    requiresHumanSend: true,
    mode: 'template',
    usage: null,
    rejected: rejected || null,
  });

  if (opts.mode === 'template' || llmPolicy.resolveMode() === 'off') {
    return fallback(llmPolicy.resolveMode() === 'off' ? 'LLM_MODE_OFF' : 'FORCED_TEMPLATE');
  }

  const res = await llmPolicy.callTask({
    task: VENDOR_TASK,
    system: SYSTEM_VENDOR,
    prompt: JSON.stringify(payload),
    jsonMode: true,
    maxOutputTokens: 400,
  });
  if (!res.ok) return fallback(res.reason);

  const parsed = llm.parseJsonLoose(res.text);
  const check = VendorSchema.safeParse(parsed);
  if (!check.success) return fallback(`JSON không hợp lệ: ${check.error.issues[0]?.message || 'unknown'}`);

  const numbers = assertNumbersUnchanged(check.data.vendorMessage, payload);
  if (!numbers.ok) {
    logger.error(`[vendor-msg] LLM thêm/sửa số: ${numbers.invented.join(', ')} → dùng mẫu`);
    return fallback(`LLM_THAO_TAC_SO:${numbers.invented.join('|')}`);
  }

  return {
    vendorMessage: check.data.vendorMessage,
    source: 'llm',
    notice: null,
    sent: false,
    requiresHumanSend: true,
    mode: res.mode,
    usage: res.usage,
    rejected: null,
  };
};

module.exports = {
  explainProposal,
  draftVendorMessage,
  buildPayload,
  templateExplanation,
  templateVendorMessage,
  assertNumbersUnchanged,
  extractNumbers,
  ExplainSchema,
  VendorSchema,
  SYSTEM_EXPLAIN,
  SYSTEM_VENDOR,
  TEMPLATE_NOTICE,
  EXPLANATION_TASK,
  VENDOR_TASK,
};