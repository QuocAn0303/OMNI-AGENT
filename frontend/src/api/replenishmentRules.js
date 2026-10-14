/**
 * api/replenishmentRules.js — Quy tắc nhập hàng (Odoo Reordering Rules)
 *
 * Cấu hình theo (sản phẩm × kho). `null` = chưa cấu hình ⇒ động cơ dùng mặc định.
 */
import axios from './axios';

const unwrap = (r) => r.data?.data ?? r.data;

export const getReplenishmentRules = (params) =>
  axios.get('/inventory/rules', { params }).then(unwrap);

export const updateReplenishmentRule = (payload) =>
  axios.put('/inventory/rules', payload).then(unwrap);

// ── AI diễn giải đề xuất + soạn tin NCC (thêm 2026-10-14) ─────────────────
//
// VÌ SAO CÓ: `explainProposal` / `draftVendorMessage` / `assertNumbersUnchanged`
// đã tồn tại và đã chạy thật, nhưng TRƯỚC ĐÂY chỉ được gọi từ
// `scripts/demo/demo-flow.js` — không có route API, không có UI. Nghĩa là cơ chế
// "AI được viết lời nhưng không được đổi số" (thứ trả lời trực tiếp câu hỏi về
// vai trò LLM) không quan sát được trên trình duyệt.
//
// `simulateTamper` là chế độ biểu diễn: cố tình làm sai số lượng rồi đưa qua
// hàng rào thật. Không gọi mạng.
//
// LƯU Ý: tin nhắn NCC CHỈ SOẠN, KHÔNG GỬI. Không có hàm gửi nào — người dùng
// tự sao chép rồi gửi qua Zalo/SMS/email. `vendorMessageSent` luôn là `false`.

/** Sinh lời giải thích + tin nhắn NCC cho một thẻ duyệt. */
export const explainProposal = (gateId, opts = {}) =>
  axios.post(`/replenishment/proposals/${gateId}/explain`, {
    simulateTamper: opts.simulateTamper === true,
    mode: opts.mode === 'template' ? 'template' : 'auto',
  }).then(unwrap);

/** Danh sách SKU dưới ROP kèm số lượng đề xuất (read-only). */
export const getReplenishmentSuggestions = (limit = 50, status) =>
  axios.get('/replenishment/suggestions', { params: { limit, status } })
    .then((r) => unwrap(r)?.items ?? unwrap(r));