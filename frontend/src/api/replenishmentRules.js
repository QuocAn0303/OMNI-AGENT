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
    ...(opts.quantity !== undefined ? { quantity: opts.quantity } : {}),
  }).then(unwrap);

/** Danh sách SKU dưới ROP kèm số lượng đề xuất (read-only). */
export const getReplenishmentSuggestions = (limit = 50, status) =>
  axios.get('/replenishment/suggestions', { params: { limit, status } })
    .then((r) => unwrap(r)?.items ?? unwrap(r));

/**
 * Tạo đề xuất nhập cho một SKU ⇒ sinh human-gate ở trạng thái PENDING.
 *
 * Thêm 2026-10-16. VÌ SAO CẦN: endpoint `POST /replenishment/products/:id/propose`
 * đã tồn tại từ trước nhưng **không hàm nào ở frontend gọi tới**. Hệ quả: màn
 * `Duyệt đề xuất nhập` luôn trống trừ khi ai đó chạy script ngoài terminal, và
 * luồng "AI đề xuất → người duyệt" không khởi động được từ trình duyệt — tức
 * tính năng quan trọng nhất của vòng 2 không demo nổi trên sân khấu.
 *
 * Server trả 400 nếu SKU còn tồn (chưa cần nhập), 409 nếu SKU cần nhập mà
 * chưa có nhà cung cấp. Hai lỗi đó là hành vi đúng — không bịa NCC.
 */
export const proposeReplenishment = (productId) =>
  axios.post(`/replenishment/products/${productId}/propose`).then(unwrap);
