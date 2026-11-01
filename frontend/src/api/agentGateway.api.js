/**
 * Frontend: api/agentGateway.api.js — client cho API điều phối Multi-Agent (Bước 9)
 *
 * HỢP ĐỒNG (rút ra từ `src/modules/agent-gateway/*.routes.js` — đừng đoán):
 *   GET  /api/agent-gateway/agents-overview      → { agents, skills, mcpServers, approvalRules, runtime, telegram }
 *   POST /api/agent-gateway/runs                 → body { message, opsRequest } → { runId, status, report, counts, traceSummary }
 *   GET  /api/agent-gateway/runs/:runId/trace    → { runId, total, events[], summary }
 *   POST /api/agent-gateway/kb/search            → body { query, asOf, topK } → { chunks[], total }
 *   POST /api/agent-gateway/finance/reconcile-invoice → body { invoice, poNumber, runId, nodeId }
 *   POST /api/agent-gateway/sales/quotes         → body { customer, lines, discountPercent, ... }
 *   POST /api/agent-gateway/gates/:id/decide     → body { decision, note }
 *   GET/POST/PUT/DELETE /api/agent-gateway/memories[...]
 *   GET  /api/agent-gateway/sessions/:id/checkpoint-summary
 *   GET  /api/agent-gateway/audit-logs           → phân trang
 *   GET  /api/agent-gateway/permission-matrix
 *   POST /api/agent-gateway/telegram/{webhook,callback}
 *
 * MỌI route đều yêu cầu JWT; `axios.js` tự gắn token và refresh khi 401 — KHÔNG
 * tạo instance riêng. Trang này cũng KHÔNG gửi `role`/`userId`: server ghi đè
 * bằng danh tính trong `req.user`, gửi lên cũng bị bỏ qua.
 */
import axios from './axios';

const BASE = '/agent-gateway';

const unwrap = (res) => res.data?.data ?? res.data;

/** Trang có `pagination` nằm CẠNH `data`, không lồng trong `data`. */
const unwrapPage = (res) => ({
  items: Array.isArray(res.data?.data) ? res.data.data : [],
  pagination: res.data?.pagination ?? null,
});

// ── Tab 1: đội agent + thực thi + trace ─────────────────────────────────────
export const getAgentsOverview = () => axios.get(`${BASE}/agents-overview`).then(unwrap);
export const startRun = (body) => axios.post(`${BASE}/runs`, body).then(unwrap);
export const getRunTrace = (runId) =>
  axios.get(`${BASE}/runs/${encodeURIComponent(runId)}/trace`).then(unwrap);

// ── Tab 2: hỏi đáp SOP có trích dẫn (UC-002) ────────────────────────────────
export const searchKb = (body) => axios.post(`${BASE}/kb/search`, body).then(unwrap);
export const ingestKb = (body) => axios.post(`${BASE}/kb/ingest`, body).then(unwrap);

// ── Tab 3: UC-004 đối chiếu 3 bên + UC-005 báo giá + hàng đợi gate ──────────
export const reconcileInvoice = (body) =>
  axios.post(`${BASE}/finance/reconcile-invoice`, body).then(unwrap);
export const createQuote = (body) => axios.post(`${BASE}/sales/quotes`, body).then(unwrap);
export const lookupPo = (body) => axios.post(`${BASE}/finance/po/lookup`, body).then(unwrap);

/**
 * Hàng đợi phê duyệt DÙNG CHUNG với module `ai` (`/api/agent/human-gates` chỉ trả
 * gate PENDING). Nhờ vậy một chỗ duy nhất hiển thị mọi đề xuất đang chờ, đúng
 * thiết kế "một hàng đợi phê duyệt" trong `agent-gateway.service.js`.
 */
export const listPendingGates = () =>
  axios.get('/agent/human-gates').then((res) => {
    const rows = unwrap(res);
    return Array.isArray(rows) ? rows : [];
  });

export const decideGatewayGate = (id, body) =>
  axios.post(`${BASE}/gates/${encodeURIComponent(id)}/decide`, body).then(unwrap);
export const getGatewayGate = (id) =>
  axios.get(`${BASE}/gates/${encodeURIComponent(id)}`).then(unwrap);

// ── Tab 4: bộ nhớ dài hạn + checkpoint 5 mục (UC-007) ──────────────────────
export const listMemories = (params = {}) =>
  axios.get(`${BASE}/memories`, { params }).then(unwrapPage);
export const createMemory = (body) => axios.post(`${BASE}/memories`, body).then(unwrap);
export const updateMemory = (id, body) =>
  axios.put(`${BASE}/memories/${encodeURIComponent(id)}`, body).then(unwrap);
export const deleteMemory = (id) =>
  axios.delete(`${BASE}/memories/${encodeURIComponent(id)}`).then(unwrap);
export const getCheckpointSummary = (sessionId) =>
  axios
    .get(`${BASE}/sessions/${encodeURIComponent(sessionId)}/checkpoint-summary`)
    .then(unwrap);
export const saveCheckpointSummary = (sessionId, body) =>
  axios
    .put(`${BASE}/sessions/${encodeURIComponent(sessionId)}/checkpoint-summary`, body)
    .then(unwrap);

// ── Tab 5: audit log + ma trận phân quyền (UC-009) ─────────────────────────
export const queryAuditLogs = (params = {}) =>
  axios.get(`${BASE}/audit-logs`, { params }).then(unwrapPage);
export const getPermissionMatrix = () => axios.get(`${BASE}/permission-matrix`).then(unwrap);

// ── Tab 6: kết quả eval Regression baseline vs improved (Bước 10) ───────────
// CHỈ ĐỌC: server trả nội dung `evals/results/*` do `npm run eval:all` sinh ra.
export const getEvalsSummary = () => axios.get(`${BASE}/evals/summary`).then(unwrap);

// ── Telegram gateway (Mục 5 của đề) — bot giao việc + nút Duyệt/Từ chối ────
export const telegramWebhook = (body) =>
  axios.post(`${BASE}/telegram/webhook`, body).then(unwrap);
export const telegramCallback = (body) =>
  axios.post(`${BASE}/telegram/callback`, body).then(unwrap);
