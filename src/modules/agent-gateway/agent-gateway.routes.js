/**
 * modules/agent-gateway/agent-gateway.routes.js — Bề mặt HTTP cho package `agents/`
 *
 * ============================================================================
 * DANH TÍNH LUÔN LẤY TỪ `req.user`
 * ============================================================================
 * `authenticate` xác thực JWT rồi đọc lại user trong DB (role/tenant). Vì vậy mọi
 * route ở đây:
 *   - KHÔNG đọc `role`/`department`/`userId` từ body/query.
 *   - Ghi đè (không chỉ "ưu tiên") các trường đó bằng giá trị từ `req.user`.
 * Một request kèm `{"userId":"forged","role":"ADMIN"}` vẫn chạy dưới đúng người
 * đăng nhập — xem `scripts/check-agent-gateway.js`.
 *
 * Route:
 *   GET  /auth-context                 → AuthContext (department từ Employee → User → role)
 *   POST /audit-events                 → AuditLog, FAIL-CLOSED (throw khi lỗi)
 *   GET  /audit-logs                   → tra cứu AuditLog (ép phạm vi theo actor)
 *   GET  /permission-matrix            → policy.config.json + hạn mức duyệt gate
 *   POST /gates                        → gate PENDING, idempotent theo `${runId}:${nodeId}`
 *   GET  /gates/:id                    → trạng thái thật của gate
 *   POST /gates/:id/decide             → duyệt/từ chối (chặn tự duyệt, chặn ghi đè)
 *   POST /kb/ingest                    → nạp tài liệu SOP (chunk theo mục)
 *   POST /kb/search                    → tra cứu SOP, ACL + phiên bản lọc trong SQL
 *
 * Nhóm UC-004 (/finance/*) nằm ở `finance.routes.js` và được mount CUỐI CÙNG,
 * sau `authenticate`, để thừa hưởng `req.user` + tenant context. Các route trên
 * giữ nguyên thứ tự và hành vi — `scripts/check-agent-gateway.js` canh việc này.
 */
const express = require('express');

const { authenticate } = require('../../middleware/auth.middleware');
const { success, created, paginated } = require('../../utils/response');
const service = require('./agent-gateway.service');
const { chunkMarkdown } = require('./kb-chunker');
const financeRoutes = require('./finance.routes');
const salesRoutes = require('./sales.routes');
const memoryService = require('./memory.service');
const orchestration = require('./orchestration.service');
const telegramGateway = require('./telegram-gateway.service');
const evalsService = require('./evals.service');

const router = express.Router();

// Toàn bộ nhóm route yêu cầu JWT.
router.use(authenticate);

/** Actor dựng từ `req.user.id` (đã xác thực) — không nhận id từ tham số client. */
const actorOf = (req, runId = null) => service.getAuthContext({ userId: req.user.id, runId });

// ─────────────────────────────────────────────────────────────────────────────
// Auth context
// ─────────────────────────────────────────────────────────────────────────────

router.get('/auth-context', async (req, res, next) => {
  try {
    const runId = req.query.runId ? String(req.query.runId) : null;
    const ctx = await actorOf(req, runId);
    return success(res, ctx, 'Đã dựng ngữ cảnh xác thực');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/audit-events', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const row = await service.auditAgentEvent({
      ...body,
      // GHI ĐÈ, không phải ưu tiên: payload giả không thể đổi danh tính.
      userId: req.user.id,
      tenantId: req.user.tenantId || null,
    });
    return created(res, row, 'Đã ghi audit');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UC-009 — Tra cứu audit + ma trận phân quyền (màn hình 009-12)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/audit-logs', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    // `req.query.userId` chỉ là bộ lọc CHO ADMIN/EXEC; service ép cứng về actor
    // cho mọi role khác, nên không có đường đọc audit của người khác.
    const { items, pagination } = await service.queryAuditLogs({ query: req.query, actor });
    return paginated(res, items, pagination);
  } catch (e) {
    return next(e);
  }
});

router.get('/permission-matrix', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const matrix = service.getPermissionMatrix({ actor });
    return success(res, matrix, 'Ma trận phân quyền hiện hành');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Human-gate cho hai actionType của multi-agent
// ─────────────────────────────────────────────────────────────────────────────

router.post('/gates', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const { gate, reused } = await service.createGatewayGate({
      actionType: body.actionType,
      runId: body.runId,
      nodeId: body.nodeId,
      summary: body.summary,
      details: body.details,
      amount: body.amount ?? null,
      actor,
    });
    return created(res, gate, reused ? 'Dùng lại gate đã tạo (idempotent)' : 'Đã tạo gate');
  } catch (e) {
    return next(e);
  }
});

router.get('/gates/:id', async (req, res, next) => {
  try {
    const gate = await service.getGatewayGate(req.params.id);
    return success(res, gate, 'Chi tiết gate');
  } catch (e) {
    return next(e);
  }
});

router.post('/gates/:id/decide', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req);
    const gate = await service.decideGatewayGate({
      gateId: req.params.id,
      decision: String(body.decision || '').trim().toUpperCase(),
      note: body.note ?? null,
      actor,
    });
    return success(res, gate, 'Đã xử lý gate');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UC-002 — Kho SOP/KB
// ─────────────────────────────────────────────────────────────────────────────

router.post('/kb/ingest', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);

    // Ưu tiên `chunks` (caller đã cắt); nếu chỉ có `content` thì cắt tại đây theo
    // đúng quy tắc mục/điều khoản — client không phải tự đoán ranh giới chunk.
    const chunks = Array.isArray(body.chunks) && body.chunks.length > 0
      ? body.chunks
      : chunkMarkdown(body.content || '');

    const result = await service.ingestKbDocument({
      docCode: body.docCode,
      title: body.title,
      department: body.department,
      accessLevel: body.accessLevel,
      version: body.version,
      effectiveDate: body.effectiveDate,
      supersededAt: body.supersededAt,
      supersedesVersion: body.supersedesVersion,
      chunks,
      actor,
    });
    return created(res, result, 'Đã nạp tài liệu SOP');
  } catch (e) {
    return next(e);
  }
});

router.post('/kb/search', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const result = await service.searchKb({
      query: body.query,
      asOf: body.asOf ?? null,
      topK: body.topK,
      includeHistorical: body.includeHistorical === true,
      actor,
    });
    return success(res, result, 'Kết quả tra cứu SOP');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UC-004 — Đối chiếu 3 bên PO ↔ GRN ↔ Invoice
// ─────────────────────────────────────────────────────────────────────────────

router.use('/finance', financeRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// UC-005 — Sales CRM + báo giá + thư nháp
// ─────────────────────────────────────────────────────────────────────────────
// Mount CUỐI CÙNG: các route gốc và `/finance` phía trên giữ nguyên thứ tự/hành
// vi. `sales.routes` có `GET /quotes/:id` nên không được đặt trước các prefix
// tĩnh khác — xem ghi chú thứ tự mount trong AGENTS.md.
router.use('/sales', salesRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// UC-007 — Bộ nhớ dài hạn + compaction 5 mục
// ─────────────────────────────────────────────────────────────────────────────
// Mount THÊM ở CUỐI file: 9 route gốc, `/finance`, `/sales` phía trên giữ nguyên
// thứ tự/hành vi. Danh tính (role/department/userId/tenantId) luôn lấy từ
// `req.user` đã xác thực — body chỉ mô tả nội dung cần nhớ.

/** POST /memories — tạo một fact (đã lọc PII + ranh giới nghiệp vụ). */
router.post('/memories', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const memory = await memoryService.createMemory({ input: body, actor });
    return created(res, memory, 'Đã lưu bộ nhớ');
  } catch (e) {
    return next(e);
  }
});

/** POST /memories/import — nhập hàng loạt, ALL-OR-NOTHING. */
router.post('/memories/import', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const items = Array.isArray(body.items) ? body.items : body.memories;
    const result = await memoryService.importMemories({ items, actor });
    return created(res, result, 'Đã nhập bộ nhớ');
  } catch (e) {
    return next(e);
  }
});

/** GET /memories — chỉ trả bản đang hiệu lực, còn TTL và trong phạm vi actor. */
router.get('/memories', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const result = await memoryService.loadContextMemories({ actor, query: req.query });
    return paginated(res, result.items, result.pagination);
  } catch (e) {
    return next(e);
  }
});

/** PUT /memories/:id — sửa nội dung (vẫn qua PII 100%). */
router.put('/memories/:id', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const memory = await memoryService.updateMemory({
      id: req.params.id,
      input: body,
      actor,
    });
    return success(res, memory, 'Đã cập nhật bộ nhớ');
  } catch (e) {
    return next(e);
  }
});

/** DELETE /memories/:id — chỉ chủ sở hữu (user) / quản trị (company). */
router.delete('/memories/:id', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const result = await memoryService.deleteMemory({ id: req.params.id, actor });
    return success(res, result, 'Đã xoá bộ nhớ');
  } catch (e) {
    return next(e);
  }
});

/** GET /sessions/:id/checkpoint-summary — đọc bản nén 5 mục đã lưu. */
router.get('/sessions/:id/checkpoint-summary', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const result = await memoryService.getSessionCheckpoint({ id: req.params.id, actor });
    return success(res, result, 'Checkpoint của phiên');
  } catch (e) {
    return next(e);
  }
});

/** PUT /sessions/:id/checkpoint-summary — validate 5 mục + bảo toàn gate. */
router.put('/sessions/:id/checkpoint-summary', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const summary = body.summary ?? body.checkpointSummary ?? null;
    const expectedOpenGates = Array.isArray(body.expectedOpenGates)
      ? body.expectedOpenGates
      : null;
    const result = await memoryService.saveSessionCheckpoint({
      id: req.params.id,
      summary,
      actor,
      expectedOpenGates,
    });
    return success(res, result, 'Đã lưu checkpoint');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BƯỚC 9 — Phần mềm: API điều phối hợp nhất + Telegram bot + tổng quan
// ─────────────────────────────────────────────────────────────────────────────
// Mount THÊM ở CUỐI file. Toàn bộ route phía trên (9 route gốc, `/finance`,
// `/sales`, `/memories`, `/sessions/...`) giữ nguyên thứ tự/hành vi.
// Danh tính vẫn lấy từ `req.user` — không route nào đọc role/userId từ body.

/** GET /agents-overview — 5 agent, 2 skill, 3 MCP server, quy tắc duyệt gate. */
router.get('/agents-overview', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const overview = await orchestration.getAgentsOverview({ actor });
    return success(res, overview, 'Tổng quan hệ Multi-Agent');
  } catch (e) {
    return next(e);
  }
});

/** POST /runs — nhận việc từ Web UI/Telegram, điều phối và trả báo cáo 4 nhóm. */
router.post('/runs', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = await actorOf(req);
    const run = await orchestration.startRun({
      message: body.message,
      opsRequest: body.opsRequest,
      actor,
      source: body.source ? String(body.source).slice(0, 40) : 'WEB',
    });
    return success(res, run, 'Đã chạy điều phối Multi-Agent');
  } catch (e) {
    return next(e);
  }
});

/** GET /runs/:runId/trace — trace JSONL đã mask; ACL theo actor. */
router.get('/runs/:runId/trace', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const trace = await orchestration.getRunTrace({ runId: req.params.runId, actor });
    return success(res, trace, 'Trace của run');
  } catch (e) {
    return next(e);
  }
});

/** POST /telegram/webhook — tin nhắn giao việc + nút Duyệt/Từ chối trong chat. */
router.post('/telegram/webhook', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await telegramGateway.handleWebhook({ body, reqUser: req.user });
    return success(res, result, 'Đã xử lý tin nhắn Telegram');
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /evals/summary — kết quả Regression `baseline` vs `improved` (Bước 10).
 * CHỈ ĐỌC: trả nội dung `evals/results/*` do `npm run eval:all` sinh ra và tình
 * trạng hợp lệ của `evals/datasets/*`. Route này không kích hoạt eval.
 */
router.get('/evals/summary', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const summary = evalsService.getEvalsSummary({ actor });
    return success(res, summary, 'Tổng hợp kết quả eval Multi-Agent');
  } catch (e) {
    return next(e);
  }
});

/** POST /telegram/callback — bấm nút; gọi trực tiếp `decideGatewayGate`. */
router.post('/telegram/callback', async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await telegramGateway.handleCallback({ body, reqUser: req.user });
    return success(res, result, 'Đã xử lý callback Telegram');
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
