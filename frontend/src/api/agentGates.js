/**
 * Frontend: src/api/agentGates.js — API module human-gate (đề xuất PO của AI agent)
 *
 * HỢP ĐỒNG (rút ra từ src/modules/ai/agent.routes.js — đừng đoán):
 *   GET  /api/agent/human-gates              → { success, data: Gate[] }  (chỉ PENDING)
 *   POST /api/agent/human-gates/:id/decide   → body { decision, note, acknowledgeDrift }
 *         decision ∈ 'APPROVED' | 'REJECTED'
 *         Từ chối mà `note` rỗng ⇒ server trả 400 (bắt buộc lý do — xem T12).
 *         Response 200: data = gate đã cập nhật + `po` ({ id, poCode, total }) nếu có.
 *         Response 409: lỗi drift / MISSING_COST — body có `code`, `drift`, `diff`,
 *         `missingCost` (xem `agent.gate.exec.js` throw + `error.middleware.js`).
 *   POST /api/agent/human-gates/:id/retry-execution → body { acknowledgeDrift }
 *
 * Lưu ý: đây là HAI hợp đồng khác nhau với `/workflows/approvals/:id/decide`
 * (body `{ status, comment }`). Gửi nhầm thì `decision` là undefined ⇒ 400.
 */
import axios from "./axios";

const unwrap = (res) => res.data?.data ?? res.data;

export const getPendingGates = () => axios.get("/agent/human-gates").then(unwrap);
export const decideGate = (id, body) => axios.post(`/agent/human-gates/${id}/decide`, body).then(unwrap);
export const retryGateExecution = (id, body = {}) =>
  axios.post(`/agent/human-gates/${id}/retry-execution`, body).then(unwrap);