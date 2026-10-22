/**
 * Frontend: src/api/partners.js — API module phân hệ đối tác (PRM)
 *
 * Tổng quan:
 * - Gộp TOÀN BỘ endpoint PRM dưới tiền tố `/api/partners` (xem `src/modules/partners/index.js`):
 *   1. Hồ sơ đối tác:   /partners            (có tiền ⇒ quyền cao)
 *   2. Lượt giới thiệu: /partners/referrals
 *   3. Báo cáo hiệu quả: /partners/roi
 * - Mọi hàm unwrap response qua `res.data?.data ?? res.data` (tái dùng helper export từ
 *   api/accounting) — KHÔNG tạo axios instance riêng, dùng chung `api/axios.js` để giữ
 *   interceptor attach JWT và refresh 401.
 *
 * Phân trang: endpoint có phân trang trả `{ success, data, pagination }`. Các hàm
 * phân trang trả object `{ data, pagination }` (không unwrap) cho khớp với mẫu
 * `Tasks.jsx`; hàm không phân trang trả thẳng `data` qua `unwrap`.
 *
 * Lỗi nghiệp vụ cần xử lý ở giao diện:
 * - 409 từ POST /partners/referrals: số điện thoại đã được chính đối tác đó giới
 *   thiệu trước đó. Đây KHÔNG phải lỗi hệ thống mà là chuyện thường gặp — xem
 *   `referral.service.js` vì sao báo 409 thay vì im lặng bỏ qua.
 * - 409 từ DELETE /partners/:id khi đối tác đã ngừng hoạt động (idempotent).
 */
import axios from "./axios";
import { unwrap } from "./accounting";

/** Endpoint có phân trang: trả `{ data, pagination }`. */
const withPagination = (res) => ({
  data: res.data?.data ?? res.data,
  pagination: res.data?.pagination,
});

// ==================== Hồ sơ đối tác ====================

export const listPartners = (params) =>
  axios.get("/partners", { params }).then(withPagination);

export const getPartnerStats = () => axios.get("/partners/stats").then(unwrap);

export const getPartner = (id) => axios.get(`/partners/${id}`).then(unwrap);

export const createPartner = (data) => axios.post("/partners", data).then(unwrap);

export const updatePartner = (id, data) => axios.put(`/partners/${id}`, data).then(unwrap);

/** Ngừng hoạt động — XOÁ MỀM. Không xoá lịch sử giới thiệu (xem partner.service.js). */
export const deactivatePartner = (id) => axios.delete(`/partners/${id}`).then(unwrap);

export const restorePartner = (id) => axios.patch(`/partners/${id}/restore`).then(unwrap);

// ==================== Lượt giới thiệu ====================

export const listReferrals = (params) =>
  axios.get("/partners/referrals", { params }).then(withPagination);

/** Phễu chuyển đổi theo đối tác. Không truyền `partnerId` thì lấy tất cả. */
export const getReferralFunnel = (params) =>
  axios.get("/partners/referrals/funnel", { params }).then(unwrap);

export const getReferral = (id) => axios.get(`/partners/referrals/${id}`).then(unwrap);

/** Nhập tay một lượt giới thiệu. Có thể ném lỗi 409 — xem ghi chú đầu tệp. */
export const createReferral = (data) => axios.post("/partners/referrals", data).then(unwrap);

// ==================== Báo cáo hiệu quả ====================

/**
 * Bảng xếp hạng đối tác theo lợi nhuận ròng.
 *
 * @param {object} params
 * @param {'predicted'|'actual'} params.metric đo theo CLV dự báo hay giá trị thực tế
 * @param {'profit'|'revenue'|'conversion'|'referrals'} params.sortBy
 */
export const getPartnerRoi = (params) => axios.get("/partners/roi", { params }).then(unwrap);

/** Chi tiết một đối tác kèm danh sách khách đã chuyển đổi. */
export const getPartnerRoiDetail = (id) => axios.get(`/partners/roi/${id}`).then(unwrap);