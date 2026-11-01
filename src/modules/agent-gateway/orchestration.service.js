/**
 * modules/agent-gateway/orchestration.service.js — API điều phối hợp nhất (Bước 9).
 *
 * ============================================================================
 * VÌ SAO CÓ TỆP NÀY
 * ============================================================================
 * Web UI / Telegram cần MỘT cửa vào thay vì tự gọi từng module. Cửa đó:
 *   1. dựng `AuthContext` từ `req.user` (không bao giờ từ body);
 *   2. nạp `AgentMemory` đang hiệu lực của actor (UC-007);
 *   3. giao từng subtask cho service nghiệp vụ đã có (UC-002/004/005);
 *   4. ghi AuditLog (fail-closed) + trace JSONL đã mask PII/token;
 *   5. trả báo cáo 4 nhóm: completed / denied_or_blocked / pending_approval / failed.
 *
 * Orchestrator KHÔNG sở hữu tool nào (`agentResources.orchestrator = []` trong
 * `policy.config.json`). Vì vậy tệp này chỉ ĐIỀU PHỐI — mọi thao tác thật vẫn
 * chạy qua service của module nghiệp vụ, sau đó gate mới là nơi con người duyệt.
 *
 * Trace nằm ở `traces/<runId>.jsonl` (append-only, một dòng một sự kiện). File
 * này KHÔNG phải nguồn quyết định — audit trong DB mới là bằng chứng kiểm soát.
 * `nodemon.json` bỏ qua `traces/**` để ghi trace không làm server restart.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ApiError = require('../../utils/apiError');
const logger = require('../../utils/logger');
const { maskPII } = require('../../utils/piiMask');
const service = require('./agent-gateway.service');
const finance = require('./finance.service');
const sales = require('./sales.service');
const memoryService = require('./memory.service');
const { describeApprovalRules } = require('./approval-policy');

const TRACE_DIR = path.resolve(__dirname, '../../../traces');

/** Role xem được trace của TOÀN tenant (cùng `department === 'EXEC'`). */
const TRACE_FULL_VIEW_ROLES = Object.freeze([
  'SUPER_OMEGA_ULTRA_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
]);

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

/** Khoá bí mật không được rơi vào trace, kể cả khi service trả nguyên payload. */
const SENSITIVE_KEY = /(token|authorization|password|passwd|secret|api[_-]?key|cookie|credential|private[_-]?key)/i;

const AGENT_ORDER = Object.freeze(['orchestrator', 'knowledge', 'finance', 'sales', 'hr']);

/**
 * Nạp `agents/dist` MỘT LẦN cho đường thực thi (Bước 10).
 *
 * Lý do vẫn dùng service nghiệp vụ cho subtask: `agents/dist` không được phép
 * chạm Prisma (xem `agents/src/index.ts`). Nhưng kế hoạch thì do dist kiểm:
 * `validateDag` quyết định thứ tự topo, `authorizeHandoff` là tầng HANDOFF thứ
 * nhất, `createOrchestrator` là đồ thị LangGraph thật (báo cáo `langgraph`).
 *
 * Thiếu `agents/dist` KHÔNG làm sập gateway: trả `available: false` và giữ
 * nguyên đường service-bridge — `GET /agents-overview` đã nói rõ trạng thái đó.
 */
let agentRuntimeCache = null;
const loadAgentRuntime = () => {
  if (agentRuntimeCache) return agentRuntimeCache;
  try {
    // eslint-disable-next-line global-require
    const mod = require('../../../agents/dist');
    agentRuntimeCache = {
      available: Boolean(mod && typeof mod.validateDag === 'function'),
      validateDag: typeof mod.validateDag === 'function' ? mod.validateDag : null,
      authorizeHandoff: typeof mod.authorizeHandoff === 'function' ? mod.authorizeHandoff : null,
      createOrchestrator: typeof mod.createOrchestrator === 'function' ? mod.createOrchestrator : null,
      policyVersion: mod?.policyVersion || null,
      error: null,
    };
  } catch (err) {
    logger.warn(`[agent-gateway] không nạp được agents/dist: ${err.message}`);
    agentRuntimeCache = {
      available: false,
      validateDag: null,
      authorizeHandoff: null,
      createOrchestrator: null,
      policyVersion: null,
      error: err.message,
    };
  }
  return agentRuntimeCache;
};

/**
 * Lý do DENY của tầng HANDOFF buộc phải chặn — đây là lỗi CẤU TRÚC (actor bị
 * sửa, run lệch, envelope rỗng), không phải tranh chấp policy mà ma trận quyền
 * của gateway có thể biện minh. Các lý do nghiệp vụ còn lại đã được
 * `authorizeSubtask` phán quyết, nên không ghi đè để giữ tương thích.
 */
const STRUCTURAL_HANDOFF_DENY = Object.freeze([
  'actor_mutated',
  'run_id_mismatch',
  'missing_actor_context',
  'no_allowed_tools',
]);

const AGENT_META = Object.freeze({
  orchestrator: {
    name: 'orchestrator',
    label: 'Bộ điều phối',
    useCases: ['UC-009'],
    implementation: 'orchestrator',
  },
  knowledge: {
    name: 'knowledge',
    label: 'Tri thức & SOP',
    useCases: ['UC-002'],
    implementation: 'runtime',
  },
  finance: {
    name: 'finance',
    label: 'Tài chính & đối chiếu 3 bên',
    useCases: ['UC-004'],
    implementation: 'runtime',
  },
  sales: {
    name: 'sales',
    label: 'Sales CRM & báo giá',
    useCases: ['UC-005'],
    implementation: 'runtime',
  },
  hr: {
    name: 'hr',
    label: 'Nhân sự (policy-only)',
    useCases: ['UC-009'],
    implementation: 'policy-only',
  },
});

const SKILL_FILES = Object.freeze([
  {
    dir: 'invoice-reconciliation',
    department: 'FINANCE',
    useCase: 'UC-004',
  },
  {
    dir: 'quote-generation',
    department: 'SALES',
    useCase: 'UC-005',
  },
]);

const MCP_FILES = Object.freeze([
  { name: 'crm-mcp', file: path.resolve(__dirname, '../../../mcp_servers/crm-mcp/index.js') },
  { name: 'sheets-mcp', file: path.resolve(__dirname, '../../../mcp_servers/sheets-mcp/index.js') },
  { name: 'mail-mcp', file: path.resolve(__dirname, '../../../mcp_servers/mail-mcp/index.js') },
]);

/** Cùng ngưỡng với `agents/src/agents/sales/mcpClient.ts`. */
const MCP_RUNTIME = Object.freeze({
  transport: 'stdio',
  timeoutMs: 5000,
  maxRetries: 2,
  retryDelayMs: 5,
  idempotency: 'sha1(runId + ":" + server + ":" + tool + ":" + stableJson(params))',
});

const FORBIDDEN_TOOLS = Object.freeze([
  'bash', 'sh', 'shell', 'zsh', 'cmd', 'powershell', 'pwsh', 'curl', 'wget',
  'eval', 'exec', 'system', 'node.child_process', 'child_process',
  'mail.send_external', 'mail.send', 'smtp.send', 'http.fetch',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Trace: ghi/đọc + mask
// ─────────────────────────────────────────────────────────────────────────────

const assertRunId = (runId) => {
  const value = String(runId || '').trim();
  if (!RUN_ID_PATTERN.test(value)) {
    throw new ApiError(400, 'runId không hợp lệ');
  }
  return value;
};

const tracePathOf = (runId) => path.join(TRACE_DIR, `${assertRunId(runId)}.jsonl`);

const countTraceEvents = (runId) => {
  try {
    return fs.readFileSync(tracePathOf(runId), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
};

/**
 * Chuẩn hoá dữ liệu trước khi ghi trace.
 *
 * `maskPII` chỉ mask theo TÊN field (phone/email/taxCode...). Hàm này bổ sung:
 *   - redact khoá bí mật (token/authorization/password/...);
 *   - redact chuỗi Bearer/JWT lỡ nằm trong giá trị;
 *   - cắt độ sâu để một payload lồng nhau không làm trace phình vô hạn.
 */
const sanitizeForTrace = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
      .slice(0, 4000);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeForTrace(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeForTrace(value[key], depth + 1);
    }
    return out;
  }
  return String(value);
};

let traceSequence = 0;

const appendTrace = (runId, actor, event) => {
  const id = assertRunId(runId);
  const record = sanitizeForTrace({
    ts: new Date().toISOString(),
    seq: ++traceSequence,
    runId: id,
    tenantId: actor?.tenantId || null,
    userId: actor?.userId || null,
    role: actor?.role || null,
    department: actor?.department || null,
    ...event,
  });
  const masked = maskPII(record, null);

  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    fs.appendFileSync(tracePathOf(id), `${JSON.stringify(masked)}\n`, 'utf8');
  } catch (err) {
    logger.error(`[agent-gateway] ghi trace THẤT BẠI (run=${id}): ${err.message}`);
    throw err;
  }
  return masked;
};

const traceActorOf = (events = []) => {
  const header = events.find((event) => event.event === 'run.started') || events[0] || {};
  return {
    userId: header.userId || null,
    tenantId: header.tenantId || null,
    role: header.role || null,
    department: header.department || null,
  };
};

const isFullTraceViewer = (actor = {}) => {
  const role = String(actor.role || '').trim().toUpperCase();
  const department = String(actor.department || '').trim().toUpperCase();
  return TRACE_FULL_VIEW_ROLES.includes(role) || department === 'EXEC';
};

const getRunTrace = async ({ runId, actor }) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');
  const id = assertRunId(runId);
  const file = tracePathOf(id);
  if (!fs.existsSync(file)) throw new ApiError(404, 'Không tìm thấy trace của run');

  const raw = fs.readFileSync(file, 'utf8');
  const events = raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new ApiError(500, `Trace hỏng ở dòng ${index + 1}: ${err.message}`);
      }
    });

  if (events.length === 0) throw new ApiError(404, 'Trace rỗng');

  const owner = traceActorOf(events);
  const requesterTenant = actor.tenantId || null;
  const isSuperOmega = String(actor.role || '').toUpperCase() === 'SUPER_OMEGA_ULTRA_ADMIN';

  if (!isSuperOmega && String(owner.tenantId || '') !== String(requesterTenant || '')) {
    throw new ApiError(403, 'Không được xem trace của doanh nghiệp khác');
  }

  if (!isFullTraceViewer(actor) && String(owner.userId || '') !== String(actor.userId)) {
    throw new ApiError(403, 'Chỉ được xem trace của chính mình');
  }

  return {
    runId: id,
    owner: {
      userId: owner.userId,
      role: owner.role,
      department: owner.department,
      tenantId: owner.tenantId,
    },
    viewer: {
      userId: actor.userId,
      role: actor.role,
      department: actor.department || null,
      scope: isFullTraceViewer(actor) ? 'TENANT' : 'SELF',
    },
    total: events.length,
    events,
    summary: {
      startedAt: events[0]?.ts || null,
      finishedAt: events[events.length - 1]?.ts || null,
      events: events.length,
      agents: [...new Set(events.map((event) => event.agent).filter(Boolean))],
      gates: [...new Set(events.map((event) => event.gateId).filter(Boolean))],
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tổng quan hệ Multi-Agent
// ─────────────────────────────────────────────────────────────────────────────

const parseSkillFrontmatter = (text) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!match) return null;

  const data = {};
  let currentList = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (listItem && currentList) {
      currentList.push(listItem[1]);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    if (!rawValue.trim()) {
      currentList = [];
      data[key] = currentList;
    } else {
      currentList = null;
      data[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return data;
};

const loadSkills = () => SKILL_FILES.map((definition) => {
  const file = path.resolve(__dirname, '../../../skills', definition.dir, 'SKILL.md');
  const relativePath = `skills/${definition.dir}/SKILL.md`;

  try {
    const raw = fs.readFileSync(file, 'utf8');
    const front = parseSkillFrontmatter(raw) || {};
    const allowedTools = Array.isArray(front.allowed_tools) ? front.allowed_tools : [];
    const blockedTools = allowedTools.filter((tool) => {
      const normalized = String(tool).toLowerCase();
      return FORBIDDEN_TOOLS.includes(normalized)
        || normalized.split(/[._-]/).some((segment) => ['bash', 'shell', 'curl', 'wget', 'eval', 'exec', 'child_process'].includes(segment));
    });
    const errors = [];
    if (!front.name) errors.push('thiếu name');
    if (!front.version) errors.push('thiếu version');
    if (!front.department) errors.push('thiếu department');
    if (allowedTools.length === 0) errors.push('allowed_tools rỗng');
    if (blockedTools.length > 0) errors.push(`tool bị cấm: ${blockedTools.join(', ')}`);
    if (front.name && front.name !== definition.dir) {
      errors.push(`name "${front.name}" khác thư mục "${definition.dir}"`);
    }

    return {
      name: front.name || definition.dir,
      version: front.version || null,
      department: front.department || definition.department,
      description: front.description || null,
      useCase: definition.useCase,
      path: relativePath,
      allowedTools,
      blockedTools,
      errors,
      valid: errors.length === 0,
    };
  } catch (err) {
    return {
      name: definition.dir,
      version: null,
      department: definition.department,
      description: null,
      useCase: definition.useCase,
      path: relativePath,
      allowedTools: [],
      blockedTools: [],
      errors: [`không đọc được ${relativePath}: ${err.message}`],
      valid: false,
    };
  }
});

const loadMcpServer = (definition) => {
  try {
    const mod = require(definition.file);
    const descriptor = mod?.descriptor || mod?.default?.descriptor || mod;
    if (!descriptor || !Array.isArray(descriptor.tools)) {
      throw new Error('descriptor.tools không tồn tại');
    }

    return {
      name: descriptor.serverName || definition.name,
      version: descriptor.version || null,
      description: descriptor.description || null,
      tools: descriptor.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || null,
        resource: tool.resource || null,
        action: tool.action || null,
        idempotent: tool.idempotent === true,
      })),
      resources: Array.isArray(descriptor.resources) ? descriptor.resources : [],
      scopes: Array.isArray(descriptor.scopes) ? descriptor.scopes : [],
      transport: MCP_RUNTIME.transport,
      timeoutMs: MCP_RUNTIME.timeoutMs,
      maxRetries: MCP_RUNTIME.maxRetries,
      retryDelayMs: MCP_RUNTIME.retryDelayMs,
      idempotency: MCP_RUNTIME.idempotency,
      valid: true,
    };
  } catch (err) {
    logger.error(`[agent-gateway] không nạp được MCP ${definition.name}: ${err.message}`);
    return {
      name: definition.name,
      version: null,
      description: null,
      tools: [],
      resources: [],
      scopes: [],
      transport: MCP_RUNTIME.transport,
      timeoutMs: MCP_RUNTIME.timeoutMs,
      maxRetries: MCP_RUNTIME.maxRetries,
      retryDelayMs: MCP_RUNTIME.retryDelayMs,
      idempotency: MCP_RUNTIME.idempotency,
      valid: false,
      error: err.message,
    };
  }
};

const actionsForResource = (rules, resource) => {
  const actions = new Set();
  for (const rule of rules || []) {
    const pattern = String(rule.resource || '').trim();
    if (!pattern) continue;
    const matches = pattern === '*'
      || pattern === resource
      || pattern.replace(/\.\*$/, '') === resource
      || (pattern.endsWith('.*') && resource.startsWith(`${pattern.slice(0, -2)}.`));
    if (!matches) continue;
    for (const action of rule.actions || []) actions.add(action);
  }
  return [...actions];
};

const getAgentsOverview = async ({ actor } = {}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const matrix = service.getPermissionMatrix({ actor });
  const skills = loadSkills();
  const mcpServers = MCP_FILES.map(loadMcpServer);
  const alwaysAllowed = new Set(matrix.alwaysAllowedAgents || []);

  const agents = AGENT_ORDER.map((name) => {
    const meta = AGENT_META[name];
    const department = matrix.agentDepartments?.[name] || null;
    const resources = Array.isArray(matrix.agentResources?.[name]) ? matrix.agentResources[name] : [];

    return {
      ...meta,
      department,
      status: 'ACTIVE',
      alwaysAllowed: alwaysAllowed.has(name),
      resources,
      actions: [...new Set(resources.flatMap((resource) => actionsForResource(matrix.rules, resource)))],
      resourceActions: resources.map((resource) => ({
        resource,
        actions: actionsForResource(matrix.rules, resource),
      })),
      handoffTargets: Object.entries(matrix.handoffTargets || {})
        .filter(([, targets]) => targets.includes('*') || targets.includes(department))
        .map(([role]) => role),
      requiresHumanGate: name === 'finance' || name === 'sales',
    };
  });

  const distEntry = path.resolve(__dirname, '../../../agents/dist/index.js');
  const distAvailable = fs.existsSync(distEntry);
  const runtime = loadAgentRuntime();

  return {
    generatedAt: new Date().toISOString(),
    policyVersion: matrix.version,
    defaultEffect: matrix.defaultEffect,
    agents,
    skills,
    mcpServers,
    approvalRules: describeApprovalRules(),
    runtime: {
      distPath: 'agents/dist',
      distAvailable,
      execution: runtime.available
        ? 'langgraph-orchestrator+service-bridge'
        : 'service-bridge',
      executionNote: runtime.available
        ? 'agents/dist kiểm DAG + tầng HANDOFF và dựng đồ thị LangGraph; subtask vẫn chạy qua service nghiệp vụ của gateway (ranh giới: agents không chạm Prisma).'
        : 'Không thấy agents/dist — subtask chạy qua service nghiệp vụ của gateway.',
      langgraphAvailable: Boolean(runtime.createOrchestrator),
      dagValidator: Boolean(runtime.validateDag),
      handoffGuard: Boolean(runtime.authorizeHandoff),
      policyVersion: runtime.policyVersion,
      traceDir: 'traces',
      traceFormat: 'JSONL',
    },
    telegram: {
      configured: Boolean(String(process.env.TELEGRAM_BOT_TOKEN || '').trim()),
      webhookPath: '/api/agent-gateway/telegram/webhook',
      callbackPath: '/api/agent-gateway/telegram/callback',
      callbackPrefix: 'gate_decide',
      buttons: [
        { label: '✅ Duyệt', decision: 'APPROVED' },
        { label: '❌ Từ chối', decision: 'REJECTED' },
      ],
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Chạy một lượt điều phối
// ─────────────────────────────────────────────────────────────────────────────

const inferSubtasks = (message) => {
  const text = String(message || '').trim();
  if (/báo giá|bao gia|quote|chiết khấu|chiet khau/i.test(text)) {
    return [{ id: 'inferred-sales', agent: 'sales', action: 'read_price_list', params: {} }];
  }
  if (/hóa đơn|hoa don|invoice|đối chiếu|doi chieu/i.test(text)) {
    return [{ id: 'inferred-finance', agent: 'finance', action: 'lookup_po', params: {} }];
  }
  return [{ id: 'inferred-knowledge', agent: 'knowledge', action: 'search', params: { query: text } }];
};

const normalizeSubtasks = ({ message, opsRequest }) => {
  const ops = opsRequest && typeof opsRequest === 'object' ? opsRequest : {};
  const source = Array.isArray(ops.subtasks)
    ? ops.subtasks
    : Array.isArray(message?.subtasks)
      ? message.subtasks
      : null;

  const raw = source || inferSubtasks(message);
  return raw.slice(0, 20).map((subtask, index) => {
    const item = subtask && typeof subtask === 'object' ? subtask : {};
    return {
      id: String(item.id || `subtask-${index + 1}`).slice(0, 80),
      agent: String(item.agent || item.agentName || '').trim().toLowerCase(),
      action: String(item.action || item.task || item.type || 'execute').trim().toLowerCase(),
      objective: String(item.objective || item.description || '').slice(0, 500),
      params: item.params && typeof item.params === 'object' && !Array.isArray(item.params)
        ? item.params
        : {},
      dependsOn: Array.isArray(item.depends_on)
        ? item.depends_on.map(String)
        : Array.isArray(item.dependsOn)
          ? item.dependsOn.map(String)
          : [],
    };
  });
};

const authorizeSubtask = ({ matrix, actor, agent }) => {
  if (!AGENT_ORDER.includes(agent)) {
    return { allowed: false, reason: `agent_not_registered:${agent}` };
  }
  if ((matrix.alwaysAllowedAgents || []).includes(agent)) {
    return { allowed: true, reason: 'always_allowed' };
  }
  if (agent === 'orchestrator') {
    return { allowed: false, reason: 'orchestrator_has_no_tools' };
  }

  const role = String(actor.role || '').trim().toUpperCase();
  const agentDepartment = matrix.agentDepartments?.[agent] || null;
  const targets = matrix.handoffTargets?.[role] || [];
  if (targets.includes('*') || (agentDepartment && targets.includes(agentDepartment))) {
    return { allowed: true, reason: `handoff_allowed:${agentDepartment}` };
  }
  return { allowed: false, reason: `handoff_not_allowed:${role}->${agentDepartment || agent}` };
};

const blocked = (summary, detail = {}) => ({
  group: 'denied_or_blocked',
  status: 'BLOCKED',
  summary,
  ...detail,
});

const executeKnowledge = async ({ subtask, message, actor }) => {
  const query = String(subtask.params.query || subtask.objective || message || '').trim();
  if (query.length < 2) return blocked('Thiếu câu hỏi cho agent knowledge', { reason: 'MISSING_QUERY' });

  const result = await service.searchKb({
    query,
    asOf: subtask.params.asOf ?? null,
    topK: subtask.params.topK ?? 5,
    includeHistorical: subtask.params.includeHistorical === true,
    actor,
  });

  return {
    group: 'completed',
    status: 'COMPLETED',
    summary: result.chunks.length
      ? `Tìm thấy ${result.chunks.length} trích dẫn SOP`
      : 'Không tìm thấy đoạn SOP phù hợp — cần hỏi lại phòng ban nghiệp vụ',
    output: {
      total: result.total,
      asOf: result.asOf,
      citations: result.chunks.map((chunk) => ({
        docCode: chunk.docCode,
        version: chunk.version,
        department: chunk.department,
        sectionHeading: chunk.sectionHeading,
        effectiveDate: chunk.effectiveDate,
        score: chunk.score,
        excerpt: String(chunk.content || '').slice(0, 600),
      })),
    },
  };
};

const executeFinance = async ({ subtask, runId, actor }) => {
  const invoice = subtask.params.invoice;
  const poNumber = subtask.params.poNumber || invoice?.poNumber || '';

  if (!poNumber) {
    return blocked('Thiếu số PO để đối chiếu', { reason: 'MISSING_PO_NUMBER' });
  }

  if (subtask.action === 'lookup_po' || subtask.action === 'po_lookup') {
    const po = await finance.lookupPurchaseOrder({ poNumber });
    if (!po) return blocked(`Không tìm thấy PO ${poNumber}`, { reason: 'PO_NOT_FOUND' });
    return {
      group: 'completed',
      status: 'COMPLETED',
      summary: `Đã đọc PO ${po.poCode || poNumber}`,
      output: { poCode: po.poCode || poNumber, vendor: po.vendor?.name || null, itemCount: po.items?.length || 0 },
    };
  }

  if (!invoice) {
    return blocked('Thiếu dữ liệu hoá đơn để đối chiếu 3 bên', { reason: 'MISSING_INVOICE' });
  }

  const result = await finance.reconcileAndCreateGate({
    invoice,
    poNumber,
    runId,
    nodeId: subtask.id,
    summary: subtask.objective || null,
    actor,
  });

  if (result.gateId) {
    return {
      group: 'pending_approval',
      status: 'PENDING_APPROVAL',
      summary: `Đã đối chiếu ${result.classification}; đề nghị thanh toán chờ duyệt`,
      gateId: result.gateId,
      gateStatus: result.gateStatus,
      classification: result.classification,
      amount: result.paymentDraft?.amount ?? null,
      output: {
        invoiceNumber: result.invoiceNumber,
        poCode: result.paymentDraft?.poCode || poNumber,
        paymentDraftStatus: result.paymentDraft?.status || null,
      },
    };
  }

  return blocked(
    `Không thể tạo đề nghị thanh toán: ${result.classification}`,
    {
      reason: 'THREE_WAY_MATCH_FAILED',
      classification: result.classification,
      issues: result.issues,
    },
  );
};

const executeSales = async ({ subtask, runId, actor }) => {
  const wantsQuote = subtask.action.includes('quote') || Array.isArray(subtask.params.lines);

  if (wantsQuote) {
    const result = await sales.createQuote({
      runId,
      nodeId: subtask.id,
      customer: subtask.params.customer,
      lines: subtask.params.lines,
      discountPercent: subtask.params.discountPercent ?? 0,
      vatRate: subtask.params.vatRate,
      quoteNumber: subtask.params.quoteNumber,
      dealId: subtask.params.dealId,
      email: subtask.params.email,
      priceListId: subtask.params.priceListId,
      idempotencyKey: subtask.params.idempotencyKey || `${runId}:${subtask.id}:quote`,
      actor,
    });

    if (result.status === 'PENDING_APPROVAL') {
      return {
        group: 'pending_approval',
        status: 'PENDING_APPROVAL',
        summary: `Báo giá ${result.quote?.quoteNumber || ''} vượt hạn mức chiết khấu — chờ duyệt`,
        gateId: result.gateId,
        gateStatus: 'PENDING',
        classification: 'QUOTE_DISCOUNT_OVER_THRESHOLD',
        amount: result.quote?.totalAmount ?? null,
        output: {
          quoteNumber: result.quote?.quoteNumber || null,
          discountPercent: result.quote?.discountPercent ?? null,
          totalAmount: result.quote?.totalAmount ?? null,
        },
      };
    }

    return {
      group: 'completed',
      status: 'COMPLETED',
      summary: `Đã tạo báo giá ${result.quote?.quoteNumber || ''} và thư nháp (không gửi)`,
      output: {
        quoteNumber: result.quote?.quoteNumber || null,
        draftId: result.draft?.id || null,
        sent: result.draft?.sent === true,
      },
    };
  }

  if (subtask.action.includes('price')) {
    const list = await sales.readPriceList({ priceListId: subtask.params.priceListId });
    return {
      group: 'completed',
      status: 'COMPLETED',
      summary: `Đã đọc bảng giá ${list.priceList?.id || ''}`,
      output: { priceListId: list.priceList?.id || null, items: list.priceList?.items?.length || 0 },
    };
  }

  if (subtask.action.includes('customer')) {
    const found = await sales.searchCustomers({
      query: subtask.params.query,
      phone: subtask.params.phone,
      email: subtask.params.email,
      limit: subtask.params.limit,
    });
    return {
      group: 'completed',
      status: 'COMPLETED',
      summary: `Tìm thấy ${found.total} khách hàng`,
      output: { total: found.total },
    };
  }

  return blocked(`Hành động sales chưa hỗ trợ: ${subtask.action}`, { reason: 'UNKNOWN_SALES_ACTION' });
};

const executeSubtask = async ({ subtask, message, runId, actor }) => {
  if (subtask.agent === 'knowledge') return executeKnowledge({ subtask, message, actor });
  if (subtask.agent === 'finance') return executeFinance({ subtask, runId, actor });
  if (subtask.agent === 'sales') return executeSales({ subtask, runId, actor });
  if (subtask.agent === 'hr') {
    return blocked('Agent HR mới có policy, chưa có runtime xử lý lương/nhân sự', {
      reason: 'AGENT_POLICY_ONLY',
    });
  }
  return blocked(`Agent chưa đăng ký: ${subtask.agent || '(trống)'}`, { reason: 'AGENT_NOT_REGISTERED' });
};

const startRun = async ({ message, opsRequest, actor, source = 'WEB' } = {}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');
  const text = String(message ?? '').trim();
  const subtasks = normalizeSubtasks({ message: text, opsRequest });

  if (!text && subtasks.length === 0) {
    throw new ApiError(400, 'message hoặc opsRequest.subtasks là bắt buộc');
  }
  if (subtasks.length === 0) {
    throw new ApiError(400, 'opsRequest.subtasks phải có ít nhất một việc');
  }

  const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();
  const matrix = service.getPermissionMatrix({ actor });

  let memories = [];
  let memoryWarning = null;
  try {
    const loaded = await memoryService.loadContextMemories({ actor, query: { limit: 20 } });
    memories = loaded.items || [];
  } catch (err) {
    memoryWarning = err.message;
    logger.warn(`[agent-gateway] không nạp được memory cho run ${runId}: ${err.message}`);
  }

  appendTrace(runId, actor, {
    event: 'run.started',
    source,
    message: text.slice(0, 1000),
    subtaskCount: subtasks.length,
    memoriesUsed: memories.map((memory) => ({
      scope: memory.scope,
      memoryKey: memory.memoryKey,
      version: memory.version,
      content: String(memory.content || '').slice(0, 500),
    })),
    memoryWarning,
  });

  await service.auditAgentEvent({
    runId,
    userId: actor.userId,
    tenantId: actor.tenantId,
    agentName: 'orchestrator',
    toolName: 'orchestrator.dispatch',
    resource: 'agent.orchestrator',
    decision: 'ALLOW',
    reason: `source=${source};subtasks=${subtasks.length}`,
    department: actor.department,
    params: { source, subtaskIds: subtasks.map((subtask) => subtask.id) },
    resultSummary: 'Nhận việc và bắt đầu điều phối',
  });

  // ── Bước 10: agents/dist tham gia đường thực thi ──────────────────────────
  // 1) validateDag: chặn chu trình/ID trùng/việc ma TRƯỚC khi giao việc, và
  //    dùng thứ tự topo tất định của dist. DAG hỏng ⇒ chạy theo thứ tự khai báo
  //    nhưng ghi rõ trong trace/report (không im lặng sửa kế hoạch).
  // 2) authorizeHandoff: tầng HANDOFF thứ nhất; chỉ các lỗi CẤU TRÚC mới chặn.
  const runtime = loadAgentRuntime();
  const plan = subtasks.map((subtask) => ({
    id: subtask.id,
    department: matrix.agentDepartments?.[subtask.agent] || actor.department || 'EXEC',
    targetAgent: subtask.agent,
    action: subtask.action,
    depends_on: subtask.dependsOn || [],
    inputs: subtask.params || {},
  }));

  const dag = runtime.available
    ? runtime.validateDag(plan)
    : { valid: true, errors: [], order: subtasks.map((subtask) => subtask.id) };

  const orderedSubtasks = dag.valid
    ? dag.order.map((id) => subtasks.find((subtask) => subtask.id === id)).filter(Boolean)
    : subtasks;

  appendTrace(runId, actor, {
    event: 'orchestrator.dag',
    execution: runtime.available ? 'langgraph-orchestrator+service-bridge' : 'service-bridge',
    dagValid: dag.valid,
    dagErrors: dag.errors,
    order: orderedSubtasks.map((subtask) => subtask.id),
  });

  const handoffs = [];
  const handoffCtx = { ...actor, runId };

  const report = {
    completed: [],
    denied_or_blocked: [],
    pending_approval: [],
    failed: [],
  };

  for (const subtask of orderedSubtasks) {
    const subtaskStartedAt = Date.now();
    appendTrace(runId, actor, {
      event: 'subtask.started',
      subtaskId: subtask.id,
      agent: subtask.agent,
      action: subtask.action,
      objective: subtask.objective,
    });

    // Tầng HANDOFF của `agents/dist` — actor GỐC đi xuyên, không nâng quyền.
    const handoffDecision = runtime.available && runtime.authorizeHandoff
      ? runtime.authorizeHandoff(handoffCtx, {
        runId,
        actor: handoffCtx,
        fromAgent: 'orchestrator',
        toAgent: subtask.agent,
        department: matrix.agentDepartments?.[subtask.agent] || actor.department || 'EXEC',
        allowedTools: (matrix.agentResources?.[subtask.agent] || []).length > 0
          ? matrix.agentResources[subtask.agent]
          : [`agent.${subtask.agent}`],
      })
      : { layer: 'HANDOFF', effect: 'ALLOW', reason: 'runtime_unavailable', fieldProjection: [] };

    const structuralDeny = handoffDecision.effect === 'DENY'
      && STRUCTURAL_HANDOFF_DENY.includes(String(handoffDecision.reason || '').split(':')[0]);

    handoffs.push({
      subtaskId: subtask.id,
      toAgent: subtask.agent,
      effect: handoffDecision.effect,
      reason: handoffDecision.reason,
      blocking: structuralDeny,
    });
    appendTrace(runId, actor, {
      event: 'orchestrator.handoff',
      subtaskId: subtask.id,
      toAgent: subtask.agent,
      decision: handoffDecision.effect,
      reason: handoffDecision.reason,
      blocking: structuralDeny,
    });

    const authz = authorizeSubtask({ matrix, actor, agent: subtask.agent });
    const toolName = `${subtask.agent || 'unknown'}.${subtask.action || 'execute'}`;

    if (!authz.allowed || structuralDeny) {
      const denialReason = structuralDeny ? `handoff:${handoffDecision.reason}` : authz.reason;
      const entry = {
        subtaskId: subtask.id,
        agent: subtask.agent,
        action: subtask.action,
        status: 'DENIED',
        reason: denialReason,
        summary: `Bị chặn bởi policy: ${denialReason}`,
        durationMs: Date.now() - subtaskStartedAt,
      };
      report.denied_or_blocked.push(entry);

      appendTrace(runId, actor, {
        event: 'policy.decision',
        subtaskId: subtask.id,
        agent: subtask.agent,
        tool: toolName,
        decision: 'DENY',
        reason: denialReason,
      });
      await service.auditAgentEvent({
        runId,
        userId: actor.userId,
        tenantId: actor.tenantId,
        agentName: subtask.agent || null,
        toolName,
        resource: `agent.${subtask.agent}`,
        decision: 'DENY',
        reason: denialReason,
        department: actor.department,
        params: { subtaskId: subtask.id, action: subtask.action },
        resultSummary: entry.summary,
      });
      continue;
    }

    appendTrace(runId, actor, {
      event: 'policy.decision',
      subtaskId: subtask.id,
      agent: subtask.agent,
      tool: toolName,
      decision: 'ALLOW',
      reason: authz.reason,
    });

    try {
      const result = await executeSubtask({ subtask, message: text, runId, actor });
      const entry = {
        subtaskId: subtask.id,
        agent: subtask.agent,
        action: subtask.action,
        status: result.status,
        summary: result.summary,
        ...(result.gateId ? { gateId: result.gateId, gateStatus: result.gateStatus } : {}),
        ...(result.classification ? { classification: result.classification } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.amount != null ? { amount: result.amount } : {}),
        ...(result.output ? { output: result.output } : {}),
        durationMs: Date.now() - subtaskStartedAt,
      };

      const bucket = report[result.group] || report.failed;
      bucket.push(entry);

      appendTrace(runId, actor, {
        event: result.group === 'pending_approval' ? 'subtask.pending_approval' : `subtask.${result.group}`,
        subtaskId: subtask.id,
        agent: subtask.agent,
        tool: toolName,
        status: result.status,
        summary: result.summary,
        gateId: result.gateId || null,
        classification: result.classification || null,
        reason: result.reason || null,
        output: result.output || null,
        durationMs: entry.durationMs,
      });

      await service.auditAgentEvent({
        runId,
        userId: actor.userId,
        tenantId: actor.tenantId,
        agentName: subtask.agent,
        toolName,
        resource: `agent.${subtask.agent}`,
        decision: 'ALLOW',
        reason: result.reason || result.status,
        department: actor.department,
        params: { subtaskId: subtask.id, action: subtask.action },
        resultSummary: result.summary,
        approvalDecision: result.group === 'pending_approval' ? 'PENDING' : null,
      });
    } catch (err) {
      const isClientError = Number(err?.status) >= 400 && Number(err?.status) < 500;
      const entry = {
        subtaskId: subtask.id,
        agent: subtask.agent,
        action: subtask.action,
        status: isClientError ? 'BLOCKED' : 'FAILED',
        reason: err?.details?.code || err?.code || (isClientError ? 'REJECTED_BY_SERVICE' : 'EXECUTION_ERROR'),
        summary: err?.message || 'Lỗi không xác định',
        durationMs: Date.now() - subtaskStartedAt,
      };
      (isClientError ? report.denied_or_blocked : report.failed).push(entry);

      appendTrace(runId, actor, {
        event: isClientError ? 'subtask.blocked' : 'subtask.failed',
        subtaskId: subtask.id,
        agent: subtask.agent,
        tool: toolName,
        status: entry.status,
        reason: entry.reason,
        error: err?.message || String(err),
        durationMs: entry.durationMs,
      });

      await service.auditAgentEvent({
        runId,
        userId: actor.userId,
        tenantId: actor.tenantId,
        agentName: subtask.agent,
        toolName,
        resource: `agent.${subtask.agent}`,
        decision: isClientError ? 'DENY' : 'ALLOW',
        reason: entry.reason,
        department: actor.department,
        params: { subtaskId: subtask.id, action: subtask.action },
        resultSummary: entry.summary,
      });
    }
  }

  const counts = {
    completed: report.completed.length,
    denied_or_blocked: report.denied_or_blocked.length,
    pending_approval: report.pending_approval.length,
    failed: report.failed.length,
  };

  let status = 'COMPLETED';
  if (counts.failed > 0) status = counts.completed || counts.pending_approval ? 'PARTIAL' : 'FAILED';
  else if (counts.denied_or_blocked > 0) status = counts.completed || counts.pending_approval ? 'PARTIAL' : 'BLOCKED';
  else if (counts.pending_approval > 0) status = 'PENDING_APPROVAL';

  const finishedAt = Date.now();
  const summary = appendTrace(runId, actor, {
    event: 'run.completed',
    status,
    counts,
    durationMs: finishedAt - startedAt,
  });

  return {
    runId,
    source,
    actor: {
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: actor.role,
      department: actor.department || null,
      scopes: actor.scopes || [],
    },
    status,
    memoriesUsed: memories.length,
    report,
    counts,
    orchestration: {
      execution: runtime.available ? 'langgraph-orchestrator+service-bridge' : 'service-bridge',
      dag: { valid: dag.valid, errors: dag.errors, order: dag.order },
      handoffs,
      langgraph: Boolean(runtime.createOrchestrator),
    },
    traceSummary: {
      file: `traces/${runId}.jsonl`,
      events: countTraceEvents(runId),
      lastSeq: summary.seq || null,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
    },
  };
};

module.exports = {
  TRACE_DIR,
  getAgentsOverview,
  startRun,
  getRunTrace,
  sanitizeForTrace,
  loadSkills,
  loadMcpServer,
};
