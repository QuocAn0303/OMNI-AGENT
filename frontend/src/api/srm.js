/**
 * Frontend: src/api/srm.js — API module SRM (Supplier Relationship Management)
 *
 * Tổng quan:
 * - Churn Alerts (Mục 4): cảnh báo rời bỏ KH + voucher win-back (backend tự đóng vòng lặp
 *   bằng cron: PENDING → TRIGGERED → RETAINED/LOST — FE chỉ đọc).
 * - GRN (Mục 6.1): phiếu nhận hàng từ PO — create (DRAFT) → qcGRN (QC_DONE) → postGRN (POSTED).
 * - 3-Way Matching (Mục 6.2–6.3): hoá đơn NCC ↔ GRN ↔ PO, dung sai ±1% (server tự tính).
 * - Vendor Kraljic (Mục 5): điểm tác động lợi nhuận / rủi ro nguồn cung (1–10) —
 *   kraljicCategory do SERVER tự suy (>= 6 = Cao), FE không gửi category lên.
 *
 * Lưu ý: mọi hàm unwrap response qua res.data?.data ?? res.data (helper export từ api/accounting).
 */
import axios from "./axios";
import { unwrap } from "./accounting";

// ===== Churn Alerts (Mục 4) =====
// listChurnAlerts(params) → { alerts, pagination } — filter: riskLevel, status, page, limit
export const listChurnAlerts = (params) => axios.get("/churn-alerts", { params }).then(unwrap);
export const getChurnAlert = (id) => axios.get(`/churn-alerts/${id}`).then(unwrap);

// ===== GRN — Phiếu nhận hàng (Mục 6.1) =====
// listGRNs(params) → { grns, pagination } — filter: poId, status, page, limit
export const listGRNs = (params) => axios.get("/grn", { params }).then(unwrap);
export const getGRN = (id) => axios.get(`/grn/${id}`).then(unwrap);
// createGRN({ purchaseOrderId, warehouseId?, receivedAt?, items: [{ purchaseItemId, productId, receivedQty, lotCode?, expiryDate? }] })
export const createGRN = (data) => axios.post("/grn", data).then(unwrap);
// qcGRN(id, [{ itemId, passQty, rejectQty }]) — passQty + rejectQty <= receivedQty
export const qcGRN = (id, items) => axios.post(`/grn/${id}/qc`, { items }).then(unwrap);
// postGRN(id) — nhập kho, sinh Inventory/Lot, tính onTime (chỉ khi GRN đã QC_DONE)
export const postGRN = (id) => axios.post(`/grn/${id}/post`, {}).then(unwrap);
// quickReceive({ purchaseOrderId, warehouseId? }) — nhan nhanh 1 lan: create + QC dat + POSTED
export const quickReceiveGRN = (data) => axios.post("/grn/quick-receive", data).then(unwrap);

// ===== 3-Way Matching — Hoá đơn NCC (Mục 6.2–6.3) =====
// listMatchings(params) → { invoices, pagination } — filter: poId, matchStatus, page, limit
export const listMatchings = (params) => axios.get("/purchase-invoices", { params }).then(unwrap);
export const getMatching = (id) => axios.get(`/purchase-invoices/${id}`).then(unwrap);
// createMatching({ purchaseOrderId, invoiceNumber, invoiceAmount, invoiceTax? }) — tự match nếu có GRN POSTED
export const createMatching = (data) => axios.post("/purchase-invoices", data).then(unwrap);
// matchInvoice(id) — MATCHED (≤ ±1%) hoặc VARIANCE_HOLD (chặn thanh toán)
export const matchInvoice = (id) => axios.post(`/purchase-invoices/${id}/match`, {}).then(unwrap);
// approveVariance(id) — ADMIN chấp nhận lệch có kiểm soát → tạo công nợ
export const approveVariance = (id) => axios.post(`/purchase-invoices/${id}/approve-override`, {}).then(unwrap);

// ===== Vendor Kraljic (Mục 5) =====
// updateVendorKraljic(id, { profitImpactScore, supplyRiskScore }) → vendor kèm kraljicCategory
export const updateVendorKraljic = (id, data) =>
  axios.patch(`/accounting/vendors/${id}/kraljic`, data).then(unwrap);
