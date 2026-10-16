/**
 * src/modules/replenishment/proposal-explain.service.js
 *
 * ============================================================================
 * NỐI `proposal-explain.llm.js` VÀO SẢN PHẨM (thêm 2026-10-14)
 * ============================================================================
 * TẠI SAO CÓ:
 * `explainProposal` / `draftVendorMessage` / `assertNumbersUnchanged` đã tồn
 * tại và đã chạy thật trong `scripts/demo/demo-flow.js`, nhưng **không có route
 * API nào gọi tới** (khảo sát: 0 kết quả trong các file `*.routes.js` của `src`
 * và trong `src/app.js`). Nghĩa là cơ chế "AI được viết lời nhưng không được đổi số" —
 * thứ trả lời trực tiếp câu hỏi nặng nhất của ban giám khảo về vai trò LLM —
 * **không quan sát được trên giao diện web**. Chỉ chạy được bằng `npm run demo:run`.
 *
 * Tệp này làm ba việc:
 *   1. Lấy khối SỐ ĐÃ TÍNH SẮN từ `AgentHumanGate` (không tính lại — số quyết
 *      định thuộc Bước A của luồng demo, tính bằng công thức).
 *   2. Gọi `explainProposal` + `draftVendorMessage`.
 *   3. **Tự chạy `assertNumbersUnchanged` một lần nữa** để báo cáo trạng thái
 *      hàng rào cho UI — vì hai hàm kia chỉ *fallback* khi vi phạm, không
 *      *báo cáo* rằng đã kiểm.
 *
 * `simulateTamper` là chế độ BIỂU DIỄN: cố tình làm sai `orderQty` rồi đưa qua
 * hàm hàng rào THẬT để người xem thấy nó bắt được. Không gọi mạng, không ghi DB.
 *
 * Ràng buộc bất di bất dịch — giữ nguyên tinh thần của `01-llm-role.md`:
 *   LLM KHÔNG BAO GIỜ được tính số. Số ở đây là số của công thức.
 */

'use strict';

const prisma = require('../../config/prisma');
const logger = require('../../utils/logger');
// `src/utils/apiError.js` export TRỰC TIẾP class (`module.exports = ApiError`),
// không phải `{ ApiError }`. Destructure sẽ ra `undefined` và `new undefined()`
// ném "ApiError is not a constructor" — bắt nhầm ngay ở 404 đầu tiên.
const ApiError = require('../../utils/apiError');
const {
  explainProposal,
  draftVendorMessage,
  assertNumbersUnchanged,
} = require('./proposal-explain.llm');
const { PO_PROPOSAL } = require('../ai/agent.humangate');

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Lấy gate theo id (mặc định) hoặc theo productId (gate PENDING mới nhất).
 *
 * @param {object} args
 * @param {string} [args.gateId]
 * @param {string} [args.productId]
 * @param {string} args.tenantId
 */
const loadGate = async ({ tenantId, gateId, productId }) => {
  const base = {
    where: { tenantId, actionType: PO_PROPOSAL },
    orderBy: { createdAt: 'desc' },
    include: { session: { select: { id: true } } },
  };
  let gate;
  if (gateId) {
    gate = await prisma.agentHumanGate.findFirst({ ...base, where: { ...base.where, id: gateId } });
    if (!gate) throw new ApiError('Không tìm thấy thẻ duyệt đề xuất trong phạm vi tenant này', 404);
    return gate;
  }
  if (!productId) throw new ApiError('Cần `gateId` hoặc `productId`', 400);

  // Lấy productId ra khỏi payload để không phải đoán theo actionSummary.
  const recent = await prisma.agentHumanGate.findMany({
    ...base,
    take: 50,
    select: { id: true, actionPayload: true, status: true },
  });
  gate = recent.find((g) => {
    const items = g.actionPayload?.items || [];
    return items.some((i) => i.productId === productId);
  });
  if (!gate) throw new ApiError('SKU này chưa có thẻ duyệt đề xuất nào', 404);
  const full = await prisma.agentHumanGate.findFirst({ ...base, where: { ...base.where, id: gate.id } });
  return full;
};

/**
 * Chuyển `actionPayload` của gate thành đúng input mà `buildPayload` chờ.
 *
 * Số lấy từ: `items[0].quantity` (số đề xuất), `rationale.*` (ATP/ROP/nhu cầu/
 * an toàn), `leadTimeDays`, `totalEstimate`. KHÔNG tính lại ở đây.
 */
const gateToExplainInput = (gate) => {
  const p = gate.actionPayload || {};
  const item = (p.items || [])[0] || {};
  const r = p.rationale || {};
  return {
    sku: item.sku || '',
    name: item.productName || item.sku || '',
    atp: r.atp,
    rop: r.rop,
    safetyStock: r.safetyStock,
    demandPerDay: r.demandPerDay,
    leadTimeDays: p.leadTimeDays,
    leadTimeEstimated: p.leadTimeEstimated === true,
    daysOfCoverLeft:
      r.demandPerDay > 0 ? Number((n(r.atp) / n(r.demandPerDay)).toFixed(1)) : null,
    orderQty: item.quantity,
    unitCost: item.unitCost,
    total: p.totalEstimate,
    vendorName: p.vendorName || '',
    stockoutDaysLast90: r.stockoutDaysLast90 ?? null,
  };
};

/**
 * Báo cáo trạng thái hàng rào số cho MỘT văn bản đầu ra.
 * Đây là lớp BÁO CÁO; hàng rào thật đã chạy bên trong `explainProposal`.
 */
const reportGuard = (text, payload) => {
  const check = assertNumbersUnchanged(text, payload);
  const payloadNumbers = Object.entries(payload)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([k, v]) => ({ truong: k, giaTri: v }));
  return {
    passed: check.ok,
    tampered: !check.ok,
    inventedNumbers: check.invented,
    checkedNumbers: payloadNumbers,
    note:
      'assertNumbersUnchanged() quét MỌI con số trong văn bản và so với khối số của công thức. '
      + 'Số nào không có trong khối số đó là LLM tự thêm ⇒ loại bỏ văn bản, dùng bản mẫu.',
  };
};

/**
 * Cố tình làm sai `orderQty` để MINH HOẠ hàng rào.
 *
 * Văn bản giả được dựng từ chính bản mẫu an toàn, chỉ thay SỐ LƯỢNG đề xuất bằng
 * một số khác. Nhờ vậy chữ vẫn đọc tự nhiên, và hàng rào bắt được đúng thứ nó
 * được thiết kế để bắt: LLM tự ý đổi con số quyết định.
 *
 * @returns {{text: string, tamperedNumber: number, originalNumber: number}}
 */
const buildTamperedText = (payload) => {
  const original = n(payload.orderQty);
  // +7 đơn vị: đủ khác để bị bắt, không quá xa để vẫn là con số "hợp lý" —
  // đúng loại sai lệch mà người duyệt khó phát hiện bằng mắt.
  const tampered = original + 7;
  const originalText = Math.round(original).toLocaleString('vi-VN');
  const tamperedText = Math.round(tampered).toLocaleString('vi-VN');
  const text =
    `Gửi anh/chị, đề xuất nhập ${tamperedText} đơn vị món này `
    + `(tăng so với ${originalText} đơn vị hệ thống tính) `
    + 'vì tốc độ bán gần đây tăng mạnh. Mong anh/chị kiểm tra và báo giá giúp. Trân trọng.';
  return { text, tamperedNumber: tampered, originalNumber: original };
};

/**
 * Sinh lời giải thích + tin nhắn NCC cho một thẻ duyệt, kèm trạng thái hàng rào.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} [args.gateId]
 * @param {string} [args.productId]
 * @param {boolean} [args.simulateTamper] chế độ biểu diễn hàng rào
 * @param {'auto'|'template'} [args.mode]
 * @returns {Promise<object>}
 */
const explainProposalForGate = async ({
  tenantId,
  gateId,
  productId,
  simulateTamper = false,
  mode = 'auto',
}) => {
  const gate = await loadGate({ tenantId, gateId, productId });
  const input = gateToExplainInput(gate);
  if (!input.sku) {
    throw new ApiError('Thẻ duyệt này không có mã hàng trong payload — không giải thích được', 409);
  }

  const explain = await explainProposal(input, { mode });
  const vendor = await draftVendorMessage(input, { mode });

  // Hàng rào chạy LẠI ở đây để UI có con số "đã kiểm chứng" — hai hàm trên chỉ
  // fallback khi vi phạm mà không nói lại là đã kiểm.
  //
  // PHẢI CÓ `sku`/`name`/`vendorName` (không chỉ số): `assertNumbersUnchanged` che
  // các định danh này khỏi văn bản trước khi quét số, vì tên hàng trong tập UCI
  // có chữ số ("12 PENCILS…"). Bản đầu thiếu chúng ⇒ hàng rào báo nhầm số `12`
  // là của LLM. Đo được trên HTTP thật.
  const payloadForGuard = {
    sku: input.sku,
    name: input.name,
    vendorName: input.vendorName,
    atp: n(input.atp),
    rop: n(input.rop),
    safetyStock: n(input.safetyStock),
    demandPerDay: n(input.demandPerDay),
    leadTimeDays: n(input.leadTimeDays),
    orderQty: n(input.orderQty),
    unitCost: n(input.unitCost),
    total: n(input.total),
    // SỬA 2026-10-16 — HAI trường này ĐÃ được đưa cho LLM ở `input` (dòng
    // `daysOfCoverLeft` và `stockoutDaysLast90`) nhưng THIẾU ở `payloadForGuard`.
    // Hệ quả đo được trên HTTP thật với SKU 22577:
    //   input.daysOfCoverLeft = 83 / 157.5 = 0.5   (được LLM dùng hợp lệ)
    //   LLM viết: "tồn kho đủ dùng trong 0.5 ngày"
    //   ⇒ `assertNumbersUnchanged` không có 0.5 trong tập cho phép
    //   ⇒ `guardrail.passed = false`, `inventedNumbers: [0.5]`
    // LLM bị chặng vì dùng đúng số được cho. Đây là CÙNG loại lỗi với "hàng rào
    // số từ chối câu trả lời ĐÚNG" đã sửa ở `assertNumbersUnchanged` — biến thể
    // mới: lần này thất lạ ở chỗ KHỐI SỐ LỆCH NHAU, không phải ở cách làm tròn.
    //
    // Cách sửa: cho `payloadForGuard` đúng bằng những gì LLM được cho. KHÔNG nới
    // rộng tập số cho phép — nếu không thì hàng rào vô nghĩa.
    daysOfCoverLeft: Number.isFinite(Number(input.daysOfCoverLeft))
      ? Number(input.daysOfCoverLeft)
      : null,
    stockoutDaysLast90: Number.isFinite(Number(input.stockoutDaysLast90))
      ? Number(input.stockoutDaysLast90)
      : null,
  };
  // `checkedNumbers` chỉ liệt kê phần SỐ — đó là thứ UI hiển thị.
  const numericGuard = {
    atp: payloadForGuard.atp,
    rop: payloadForGuard.rop,
    safetyStock: payloadForGuard.safetyStock,
    demandPerDay: payloadForGuard.demandPerDay,
    leadTimeDays: payloadForGuard.leadTimeDays,
    orderQty: payloadForGuard.orderQty,
    unitCost: payloadForGuard.unitCost,
    total: payloadForGuard.total,
  };

  if (!simulateTamper) {
    const guardExplanation = reportGuard(explain.explanation, payloadForGuard);
    const guardVendor = reportGuard(vendor.vendorMessage, payloadForGuard);
    const passed = guardExplanation.passed && guardVendor.passed;
    return {
      gateId: gate.id,
      gateStatus: gate.status,
      sku: input.sku,
      productName: input.name,
      vendorName: input.vendorName,
      // Số của công thức — UI hiển thị để người xem đối chiếu văn bản.
      numbers: numericGuard,
      leadTimeDays: input.leadTimeDays ?? null,
      leadTimeEstimated: input.leadTimeEstimated === true,
      explanation: explain.explanation,
      explanationSource: explain.source,
      explanationNotice: explain.notice,
      explanationRejected: explain.rejected,
      vendorMessage: vendor.vendorMessage,
      vendorMessageSource: vendor.source,
      // Hằng số: tệp này không có hàm gửi nào, không import SMS/Zalo/email.
      vendorMessageSent: vendor.sent,
      requiresHumanSend: vendor.requiresHumanSend === true,
      vendorRejected: vendor.rejected,
      llmMode: explain.mode,
      guardrail: {
        passed,
        checkedNumbers: guardExplanation.checkedNumbers,
        inventedNumbers: [
          ...new Set([...guardExplanation.inventedNumbers, ...guardVendor.inventedNumbers]),
        ],
        fallbackApplied: false,
        note: guardExplanation.note,
      },
      simulateTamper: false,
    };
  }

  // ── chế độ biểu diễn hàng rào ─────────────────────────────────────────────
  // Cố tình làm sai SỐ LƯỢNG, đưa qua `assertNumbersUnchanged` THẬT, rồi trả về
  // bản an toàn (mẫu) — đúng những gì hệ thống sẽ làm nếu LLM thật sự sửa số.
  const tampered = buildTamperedText(input);
  const guard = assertNumbersUnchanged(tampered.text, payloadForGuard);
  logger.info(
    `[proposal-explain] simulateTamper: so ${tampered.originalNumber} -> `
    + `${tampered.tamperedNumber}; hàng rào ${guard.ok ? 'BO SOT' : 'BAT DUOC'} `
    + `(phat hien: ${guard.invented.join(', ') || 'khong'})`,
  );
  // Nếu hàng rào KHÔNG bắt được thì đó là lỗi nghiêm trọng — báo rõ thay vì
  // im lặng để người xem tưởng đã chặn thành công.
  if (guard.ok) {
    throw new ApiError(
      'Hàng rào số KHÔNG bắt được thao tác sửa số — đây là lỗi, không phải kết quả mong muốn',
      500,
    );
  }

  return {
    gateId: gate.id,
    gateStatus: gate.status,
    sku: input.sku,
    productName: input.name,
    vendorName: input.vendorName,
    numbers: numericGuard,
    leadTimeDays: input.leadTimeDays ?? null,
    leadTimeEstimated: input.leadTimeEstimated === true,
    // Bản AN TOÀN — đây là thứ hệ thống thật sự dùng sau khi bác bỏ văn bản sai.
    explanation: explain.explanation,
    explanationSource: explain.source,
    explanationNotice: explain.notice,
    vendorMessage: vendor.vendorMessage,
    vendorMessageSource: vendor.source,
    vendorMessageSent: vendor.sent,
    requiresHumanSend: vendor.requiresHumanSend === true,
    llmMode: explain.mode,
    // Văn bản sai đã bị bác — trả về để UI hiển thị minh hoạ.
    tamperedSample: tampered.text,
    guardrail: {
      passed: false,
      blockedBy: 'assertNumbersUnchanged',
      tamperedNumber: tampered.tamperedNumber,
      originalNumber: tampered.originalNumber,
      inventedNumbers: guard.invented,
      checkedNumbers: Object.entries(numericGuard)
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
        .map(([k, v]) => ({ truong: k, giaTri: v })),
      fallbackApplied: true,
      note:
        'Đây là mô phỏng có chủ đích: số lượng đề xuất bị đổi, hàng rào phát hiện, '
        + 'văn bản bị bác và hệ thống dùng bản mẫu. Không có lời gọi mạng nào ở chế độ này.',
    },
    simulateTamper: true,
  };
};

module.exports = {
  explainProposalForGate,
  loadGate,
  gateToExplainInput,
  assertNumbersUnchanged,
  reportGuard,
};