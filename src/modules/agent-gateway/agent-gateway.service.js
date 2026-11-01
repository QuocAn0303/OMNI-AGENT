/**
 * modules/agent-gateway/agent-gateway.service.js — Cầu nối DB cho package `agents/`
 *
 * ============================================================================
 * VÌ SAO CÓ MODULE NÀY
 * ============================================================================
 * Package TypeScript `agents/` (multi-agent, UC-009) KHÔNG được require
 * `@prisma/client` hay `src/config/prisma`. Mọi truy cập DB của nó đi qua HTTP tới
 * module này. Nhờ vậy ranh giới quyền là biên giới VẬT LÝ, không phải quy ước:
 * agent không thể tự query để bỏ qua policy.
 *
 * Module này cung cấp đúng ba thứ:
 *   1. `getAuthContext`  — danh tính + phòng ban của actor, DỰNG TỪ JWT/DB (route
 *      đã qua `authenticate`), TUYỆT ĐỐI không đọc role/department từ body/query.
 *   2. `auditAgentEvent` — ghi AuditLog và THROW khi ghi hỏng (fail-closed). Khác
 *      `audit.service.log()` (nuốt lỗi) nên dùng được làm bằng chứng "100% tool
 *      call có audit".
 *   3. Gate cho hai `actionType` mới (`INVOICE_3WAY_APPROVAL`,
 *      `QUOTE_DISCOUNT_APPROVAL`) — TÁI DÙNG bảng `AgentHumanGate` để giữ một hàng
 *      đợi phê duyệt duy nhất trên UI (`/agent-approvals`).
 *
 * ============================================================================
 * RÀNG BUỘC ĐÃ CHỐT (đừng "cải tiến" thành khác)
 * ============================================================================
 * - Mọi thao tác AgentHumanGate đi qua `../ai/agent.humangate` (`createGate`,
 *   `buildDecisionData`, `clip`, `GATE_TTL_MS`). Không viết object literal
 *   `prisma.agentHumanGate.create(...)` ở đây: `actionSummary` là String @db.Text
 *   KHÔNG có default, thiếu là Prisma ném ValidationError ngay ở client.
 * - Gate tạo ra là PENDING và CHỈ có hiệu lực khi người khác duyệt — khác
 *   `buildWriteActionGate` (audit hậu kỳ, APPROVED sẵn). Không sửa hành vi đó.
 * - Duyệt bằng `updateMany({ where: { id, status: 'PENDING' } })` nguyên tử; hai
 *   người bấm cùng lúc thì một bên `count = 0` ⇒ 409, không ghi đè quyết định.
 *
 * Hàm:
 * - getAuthContext({ userId, runId })            → AuthContext
 * - auditAgentEvent(event)                        → AuditLog (throw nếu hỏng)
 * - queryAuditLogs({ query, actor })              → trang AuditLog đã ép phạm vi
 * - getPermissionMatrix({ actor })                → policy.config.json + hạn mức gate
 * - createGatewayGate({...})                      → { gate, reused }
 * - getGatewayGate(id)                            → AgentHumanGate
 * - decideGatewayGate({ gateId, decision, note, actor }) → AgentHumanGate
 * - resolveDepartment({...}), buildScopes(...)    → hàm thuần, unit-test được
 */
const fs = require('fs');
const path = require('path');

const prisma = require('../../config/prisma');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/apiError');
const { maskPII } = require('../../utils/piiMask');
const { getTenantId } = require('../../config/tenantContext');
const { GATE_TTL_MS, clip, buildDecisionData, createGate } = require('../ai/agent.humangate');
const {
  APPROVAL_POLICY,
  evaluateApproval,
  describeApprovalRules,
} = require('./approval-policy');

// ─────────────────────────────────────────────────────────────────────────────
// Phòng ban
// ─────────────────────────────────────────────────────────────────────────────

/** Mã phòng ban hợp lệ — khớp `agent-gateway` + `agents/src/policy/policy.config.json`. */
const DEPARTMENTS = Object.freeze(['FINANCE', 'SALES', 'HR', 'OPS', 'WAREHOUSE', 'EXEC']);

/** Suy ra phòng ban mặc định từ role — CHỈ dùng khi cả Employee lẫn User đều trống. */
const ROLE_DEFAULT_DEPARTMENT = Object.freeze({
  SUPER_OMEGA_ULTRA_ADMIN: 'EXEC',
  SUPER_ADMIN: 'EXEC',
  ADMIN: 'EXEC',
  MANAGER: 'OPS',
  ACCOUNTANT: 'FINANCE',
  CASHIER: 'SALES',
  WAREHOUSE: 'WAREHOUSE',
});

/**
 * Từ khoá nhận diện phòng ban từ `Department.name` (tiếng Việt có dấu hoặc tiếng Anh).
 *
 * VÌ SAO KHÔNG KHỚP CHUỖI CHÍNH XÁC: `Department.name` là text tự do do người dùng
 * nhập ("Phòng Kế toán", "Kế toán - Tài chính", "HR Dept."). Khớp chính xác sẽ biến
 * mọi tenant đặt tên khác đi thành phòng ban rỗng ⇒ policy default-deny chặn oan.
 *
 * Thứ tự QUAN TRỌNG: "kho vận" phải rơi vào WAREHOUSE chứ không phải OPS.
 */
const DEPARTMENT_KEYWORDS = Object.freeze([
  ['HR', [/nh[âa]n\s*s[ựu]/i, /\bhr\b/i, /human\s*resource/i, /tuy[ểe]n\s*d[ụu]ng/i]],
  ['WAREHOUSE', [/kho/i, /warehouse/i, /\bstock/i, /th[ủu]\s*kho/i]],
  ['FINANCE', [/k[ếe]\s*to[áa]n/i, /t[àa]i\s*ch[íi]nh/i, /finance/i, /accounting/i]],
  ['SALES', [/kinh\s*doanh/i, /b[áa]n\s*h[àa]ng/i, /sales/i, /crm/i]],
  ['OPS', [/v[ậa]n\s*h[àa]nh/i, /\bops\b/i, /s[ảa]n\s*xu[ấa]t/i, /production/i, /operation/i]],
  ['EXEC', [/gi[áa]m\s*đ[ốo]c/i, /ban\s*l[ãa]nh\s*đ[ạa]o/i, /executive/i, /\bexec\b/i]],
]);

const normalizeCode = (value) => String(value || '').trim().toUpperCase();

/**
 * Chuẩn hoá một giá trị phòng ban (mã hoặc tên) về đúng 6 mã.
 * @returns {string|null}
 */
const normalizeDepartment = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (DEPARTMENTS.includes(code)) return code;
  for (const [department, patterns] of DEPARTMENT_KEYWORDS) {
    if (patterns.some((re) => re.test(raw))) return department;
  }
  return null;
};

/**
 * Phòng ban hiệu lực của actor.
 *
 * Thứ tự (theo yêu cầu Step 1): `Employee.department` → `User.department` → suy ra từ role.
 * Cả ba trống/không nhận diện được thì trả 'OPS'? KHÔNG: trả đúng mã suy từ role,
 * role lạ thì 'EXEC' là sai hướng. Trả 'OPS' cũng sai. Ta trả `null` để policy
 * default-deny chặn — an toàn hơn đoán bừa.
 *
 * @param {{ employeeDepartmentName?: string|null, userDepartment?: string|null, role?: string|null }} input
 * @returns {{ department: string|null, source: 'EMPLOYEE'|'USER'|'ROLE'|'NONE' }}
 */
const resolveDepartment = ({ employeeDepartmentName, userDepartment, role } = {}) => {
  const fromEmployee = normalizeDepartment(employeeDepartmentName);
  if (fromEmployee) return { department: fromEmployee, source: 'EMPLOYEE' };

  const fromUser = normalizeDepartment(userDepartment);
  if (fromUser) return { department: fromUser, source: 'USER' };

  const fromRole = ROLE_DEFAULT_DEPARTMENT[normalizeCode(role)] || null;
  if (fromRole) return { department: fromRole, source: 'ROLE' };

  return { department: null, source: 'NONE' };
};

/** Scope trả cho agent. Hẹp có chủ đích: agent không được tự quyết định quyền. */
const ROLE_SCOPES = Object.freeze({
  SUPER_OMEGA_ULTRA_ADMIN: ['*'],
  SUPER_ADMIN: ['tenant:admin', 'agent:handoff', 'tool:read', 'tool:write', 'gate:decide'],
  ADMIN: ['agent:handoff', 'tool:read', 'tool:write', 'gate:decide'],
  MANAGER: ['agent:handoff', 'tool:read', 'tool:write', 'gate:decide'],
  ACCOUNTANT: ['agent:handoff', 'tool:read', 'gate:decide:finance'],
  CASHIER: ['agent:handoff', 'tool:read:sales'],
  WAREHOUSE: ['agent:handoff', 'tool:read:inventory'],
});

/**
 * @param {string} role
 * @param {string|null} department
 * @returns {string[]}
 */
const buildScopes = (role, department) => {
  const base = ROLE_SCOPES[normalizeCode(role)] || [];
  const scopes = [...base];
  if (department) scopes.push(`dept:${department.toLowerCase()}`);
  return [...new Set(scopes)];
};

// ─────────────────────────────────────────────────────────────────────────────
// AuthContext
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Danh tính actor — CHỈ đọc từ DB theo `userId` đã xác thực.
 *
 * KHÔNG nhận `role`/`department` từ tham số: chữ ký hàm cố ý không có hai tham số
 * đó, để không có đường nào (kể cả vô tình) truyền giá trị do người dùng khai.
 *
 * @param {{ userId: string, runId?: string|null }} input
 */
const getAuthContext = async ({ userId, runId = null } = {}) => {
  if (!userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      tenantId: true,
      department: true,
      reportsToId: true,
      isActive: true,
      employee: { select: { department: { select: { name: true } } } },
    },
  });

  if (!user || !user.isActive) {
    throw new ApiError(401, 'Tài khoản không tồn tại hoặc đã bị vô hiệu hoá');
  }

  const { department, source } = resolveDepartment({
    employeeDepartmentName: user.employee?.department?.name || null,
    userDepartment: user.department,
    role: user.role,
  });

  return {
    userId: user.id,
    tenantId: user.tenantId || null,
    role: user.role,
    department,
    departmentSource: source,
    managerId: user.reportsToId || null,
    scopes: buildScopes(user.role, department),
    runId: runId || null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Audit (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────

const DECISIONS = Object.freeze(['ALLOW', 'DENY']);

/**
 * Ghi một sự kiện audit của agent.
 *
 * KHÁC `audit.service.log()`: hàm đó bắt mọi lỗi và không ném, nên không thể dùng
 * làm bằng chứng "100% tool call có audit". Ở đây lỗi được LOG rồi NÉM LẠI để
 * caller (package `agents`) dừng an toàn trước khi chạy tool.
 *
 * `event.userId`/`event.tenantId` do ROUTE gắn từ `req.user` (đã xác thực); service
 * bỏ qua mọi giá trị cùng tên trong thân request.
 *
 * @param {object} event
 * @returns {Promise<object>} bản ghi AuditLog vừa tạo
 */
const auditAgentEvent = async (event = {}) => {
  const runId = String(event.runId || '').trim();
  if (!runId) throw new ApiError(400, 'runId là bắt buộc');
  const decision = String(event.decision || '').trim().toUpperCase();
  if (!DECISIONS.includes(decision)) throw new ApiError(400, "decision phải là 'ALLOW' hoặc 'DENY'");

  const meta = maskPII(
    {
      node: event.node ?? null,
      params: event.params ?? null,
      resultSummary: event.resultSummary ?? null,
      approvalDecision: event.approvalDecision ?? null,
      jobId: event.jobId ?? null,
      reportPeriod: event.reportPeriod ?? null,
    },
    null,
  );

  try {
    return await prisma.auditLog.create({
      data: {
        tenantId: event.tenantId === undefined ? getTenantId() : event.tenantId,
        userId: event.userId ?? null,
        action: decision === 'ALLOW' ? 'AGENT_TOOL_ALLOW' : 'AGENT_TOOL_DENY',
        entity: event.resource || event.toolName || event.agentName || 'AgentTool',
        entityId: event.toolName || event.agentName || null,
        runId,
        agentName: event.agentName ?? null,
        toolName: event.toolName ?? null,
        resource: event.resource ?? null,
        decision,
        reason: event.reason ?? null,
        department: event.department ?? null,
        skillName: event.skillName ?? null,
        skillVersion: event.skillVersion ?? null,
        meta,
      },
    });
  } catch (err) {
    logger.error(
      `[agent-gateway] ghi audit THẤT BẠI (run=${runId} tool=${event.toolName || '-'}): ${err.message}`,
    );
    // FAIL-CLOSED: KHÔNG nuốt lỗi (xem tests/agent-humangate.contract.test.js về
    // đúng lỗi này ở đường human-gate).
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UC-009 — Tra cứu audit (009-12)
// ─────────────────────────────────────────────────────────────────────────────

/** Role xem được TOÀN BỘ audit của tenant (cùng `department === 'EXEC'`). */
const AUDIT_FULL_VIEW_ROLES = Object.freeze([
  'ADMIN', 'SUPER_ADMIN', 'SUPER_OMEGA_ULTRA_ADMIN',
]);

const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 200;

const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
};

const parseAuditDate = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${field} không hợp lệ`);
  return date;
};

/**
 * Ai được xem audit của ai.
 *
 * ADMIN/SUPER_ADMIN/SUPER_OMEGA hoặc phòng EXEC xem toàn tenant. Mọi role khác
 * CHỈ thấy dòng của chính mình. Hàm tách riêng để unit-test được và để route
 * không thể vô tình bỏ qua.
 */
const buildAuditScope = (actor = {}) => {
  const role = normalizeCode(actor.role);
  const department = normalizeCode(actor.department);
  return {
    fullView: AUDIT_FULL_VIEW_ROLES.includes(role) || department === 'EXEC',
    userId: actor.userId || null,
  };
};

/**
 * Truy vấn AuditLog của agent.
 *
 * BẤT BIẾN: nếu actor KHÔNG có quyền xem toàn bộ, `where.userId` bị ÉP CỨNG về
 * `actor.userId` — bất kể query string truyền `userId` gì. Không có nhánh nào
 * đọc `userId` từ query cho actor thường.
 *
 * @param {{ query?: object, actor: object }} input
 * @returns {Promise<{ items: object[], pagination: object }>}
 */
const queryAuditLogs = async ({ query = {}, actor } = {}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const scope = buildAuditScope(actor);
  const page = parsePositiveInt(query.page, 1, { min: 1 });
  const requestedLimit = parsePositiveInt(query.limit, AUDIT_DEFAULT_LIMIT, { min: 1 });
  const limit = Math.min(requestedLimit, AUDIT_MAX_LIMIT);

  const where = {};

  const addText = (field, value, { upper = false } = {}) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    where[field] = upper ? text.toUpperCase() : text;
  };

  addText('runId', query.runId);
  addText('agentName', query.agentName);
  addText('toolName', query.toolName);
  addText('department', query.department, { upper: true });

  if (query.decision !== undefined && query.decision !== null && String(query.decision).trim()) {
    const decision = normalizeCode(query.decision);
    if (!DECISIONS.includes(decision)) {
      throw new ApiError(400, "decision phải là 'ALLOW' hoặc 'DENY'");
    }
    where.decision = decision;
  }

  // ── Phạm vi người dùng: ép cứng cho actor thường, tôn trọng filter cho admin.
  const requestedUserId = query.userId === undefined || query.userId === null
    ? ''
    : String(query.userId).trim();
  if (!scope.fullView) {
    where.userId = scope.userId;
  } else if (requestedUserId) {
    where.userId = requestedUserId;
  }

  const fromDate = parseAuditDate(query.fromDate, 'fromDate');
  const toDate = parseAuditDate(query.toDate, 'toDate');
  if (fromDate || toDate) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  const select = {
    id: true,
    tenantId: true,
    userId: true,
    runId: true,
    action: true,
    entity: true,
    entityId: true,
    agentName: true,
    toolName: true,
    resource: true,
    decision: true,
    reason: true,
    department: true,
    skillName: true,
    skillVersion: true,
    meta: true,
    createdAt: true,
  };

  // Tenant do Prisma extension tự inject cho `AuditLog` (TENANT_SCOPED_MODELS).
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select,
    }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// UC-009 — Ma trận phân quyền (009-12)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đường dẫn policy của package `agents/`. Ưu tiên nguồn TS (dev/test), sau đó
 * bản đã build (production có `agents/dist`).
 *
 * Docker image hiện chỉ COPY `src/`, nên nếu triển khai production cần COPY thêm
 * `agents/src/policy/policy.config.json` — xem Dockerfile.
 */
const POLICY_CONFIG_CANDIDATES = Object.freeze([
  path.resolve(__dirname, '../../../agents/src/policy/policy.config.json'),
  path.resolve(__dirname, '../../../agents/dist/policy/policy.config.json'),
]);

let policyConfigCache = null;

const loadPolicyConfig = () => {
  if (policyConfigCache) return policyConfigCache;

  const failures = [];
  for (const file of POLICY_CONFIG_CANDIDATES) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rules)) {
        throw new Error('thiếu mảng rules');
      }
      policyConfigCache = parsed;
      return policyConfigCache;
    } catch (err) {
      failures.push(`${file}: ${err.message}`);
    }
  }

  logger.error(`[agent-gateway] không đọc được policy.config.json — ${failures.join(' | ')}`);
  throw new ApiError(503, 'Không đọc được cấu hình phân quyền của agent');
};

/** Thứ tự role cố định để UI hiển thị ổn định giữa các lần gọi. */
const ROLE_ORDER = Object.freeze([
  'SUPER_OMEGA_ULTRA_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'WAREHOUSE',
]);

/**
 * Ma trận phân quyền hiện hành — ĐỌC TỪ `agents/src/policy/policy.config.json`,
 * không chép tay sang JS. Nhờ vậy UI tra cứu (009-12) không thể lệch với policy
 * mà agent thật sự thi hành.
 */
const getPermissionMatrix = ({ actor } = {}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const config = loadPolicyConfig();

  const roles = [...new Set([
    ...ROLE_ORDER,
    ...Object.keys(config.handoff?.targets || {}),
    ...(config.rules || []).map((rule) => normalizeCode(rule.role)).filter((role) => role && role !== '*'),
  ])];

  return {
    version: config.version || null,
    defaultEffect: config.defaultEffect || 'DENY',
    roles,
    departments: [...DEPARTMENTS],
    agentDepartments: config.agentDepartments || {},
    agentResources: config.agentResources || {},
    alwaysAllowedAgents: [...(config.handoff?.alwaysAllowedAgents || [])],
    handoffTargets: config.handoff?.targets || {},
    fieldProjection: config.fieldProjection || { default: [], individualSalary: [] },
    rules: config.rules || [],
    approval: {
      selfApprovalAllowed: describeApprovalRules()
        .filter((rule) => rule.selfApprovalAllowed)
        .map((rule) => rule.actionType),
      rules: describeApprovalRules(),
    },
    viewer: {
      userId: actor.userId,
      role: actor.role,
      department: actor.department || null,
    },
    generatedAt: new Date().toISOString(),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Gate: hai actionType mới
// ─────────────────────────────────────────────────────────────────────────────

/** `actionType` do agent-gateway quản lý. Gate khác vẫn thuộc /api/agent/*. */
const GATEWAY_ACTION_TYPES = Object.freeze(['INVOICE_3WAY_APPROVAL', 'QUOTE_DISCOUNT_APPROVAL']);

const GATEWAY_SESSION_INTENT = 'AGENT_GATEWAY';

/**
 * `APPROVAL_POLICY` + `evaluateApproval` nằm ở `./approval-policy` (hàm thuần,
 * KHÔNG Prisma). Tách ra để package `agents/` kiểm chứng được ca "tự duyệt Gate"
 * bằng đúng logic server mà không phải require Prisma. Hạn mức ở đây KHÔNG thay
 * cho policy trong `agents/`: đây là chốt chặn phía server cho trường hợp client
 * nói dối. Hai tầng độc lập, cố ý.
 */

/**
 * Tìm gate theo khoá idempotency `${runId}:${nodeId}`.
 *
 * Lọc Json bằng `path`/`equals` là đường chính. Có fallback quét 200 gate gần nhất
 * khi Prisma client không hỗ trợ filter đó (khác biệt phiên bản) — nếu không,
 * một lỗi validate sẽ biến mọi lần tạo gate thành 500 thay vì tái dùng gate cũ.
 */
const findGateByIdempotencyKey = async (actionType, idempotencyKey) => {
  try {
    return await prisma.agentHumanGate.findFirst({
      where: {
        actionType,
        actionPayload: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      orderBy: { createdAt: 'asc' },
    });
  } catch (err) {
    if (err?.name !== 'PrismaClientValidationError') throw err;
    logger.warn(
      `[agent-gateway] Prisma không hỗ trợ lọc Json path — dùng fallback quét gate gần nhất: ${err.message}`,
    );
    const recent = await prisma.agentHumanGate.findMany({
      where: { actionType },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return (
      recent.find(
        (g) => g.actionPayload && typeof g.actionPayload === 'object'
          && g.actionPayload.idempotencyKey === idempotencyKey,
      ) || null
    );
  }
};

/** Một AgentSession đại diện cho run của agent-gateway (gate cần `sessionId`). */
const ensureGatewaySession = async ({ runId, actor }) => {
  const existing = await prisma.agentSession.findFirst({
    where: {
      userId: actor.userId,
      intent: GATEWAY_SESSION_INTENT,
      contextSnapshot: { path: ['runId'], equals: runId },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;

  return prisma.agentSession.create({
    data: {
      userId: actor.userId,
      tenantId: actor.tenantId || null,
      status: 'RUNNING',
      intent: GATEWAY_SESSION_INTENT,
      triggerSource: 'SYSTEM_EVENT',
      userMessage: clip(`agent-gateway run ${runId}`, 400),
      contextSnapshot: { runId, source: 'agent-gateway' },
    },
  });
};

/**
 * Tạo gate PENDING cho INVOICE_3WAY_APPROVAL / QUOTE_DISCOUNT_APPROVAL.
 *
 * Idempotent theo `${runId}:${nodeId}`: LangGraph chạy lại node không sinh gate thứ
 * hai. Khoá nằm trong `actionPayload.idempotencyKey` (không thêm cột) — đủ cho tra
 * cứu và không cần migration ngoài phạm vi đã chốt.
 */
const createGatewayGate = async ({
  actionType,
  runId,
  nodeId,
  summary,
  details = {},
  amount = null,
  actor,
}) => {
  if (!GATEWAY_ACTION_TYPES.includes(actionType)) {
    throw new ApiError(400, `actionType không được agent-gateway hỗ trợ: ${actionType}`);
  }
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');
  if (!runId || !nodeId) throw new ApiError(400, 'runId và nodeId là bắt buộc');

  const idempotencyKey = `${runId}:${nodeId}`;

  // Kiểm tra TRƯỚC khi tạo — nhanh và không tốn session.
  const existing = await findGateByIdempotencyKey(actionType, idempotencyKey);
  if (existing) {
    logger.info(`[agent-gateway] gate ${existing.id} tái dùng cho idempotencyKey=${idempotencyKey}`);
    return { gate: existing, reused: true };
  }

  const session = await ensureGatewaySession({ runId, actor });

  const gate = await createGate({
    sessionId: session.id,
    actionType,
    actionPayload: {
      ...details,
      idempotencyKey,
      runId,
      nodeId,
      // Do SERVER ghi, không lấy từ body — dùng cho kiểm tra tự duyệt.
      createdByUserId: actor.userId,
      createdByRole: actor.role,
      department: actor.department || null,
      amount: amount == null ? null : Number(amount),
    },
    actionSummary: clip(summary || `Agent xin duyệt ${actionType}`),
    triggerRule: 'AGENT_GATEWAY_MULTI_AGENT',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + GATE_TTL_MS),
  });

  logger.info(`[agent-gateway] tạo gate ${gate.id} type=${actionType} run=${runId} node=${nodeId}`);
  return { gate, reused: false };
};

/** Đọc một gate của agent-gateway (gate loại khác → 404, không lộ dữ liệu chéo). */
const getGatewayGate = async (gateId) => {
  const gate = await prisma.agentHumanGate.findFirst({ where: { id: gateId } });
  if (!gate || !GATEWAY_ACTION_TYPES.includes(gate.actionType)) {
    throw new ApiError(404, 'Không tìm thấy gate');
  }
  return gate;
};

/**
 * Duyệt / từ chối gate.
 *
 * Thứ tự bắt buộc:
 *   1. Trạng thái + hạn (409/400) — không ghi đè quyết định đã có.
 *   2. Policy phía server: role, hạn mức, tự duyệt.
 *   3. `updateMany({ where: { id, status: 'PENDING' } })` NGUYÊN TỬ; `count !== 1`
 *      ⇒ 409 "người khác vừa xử lý" (đua hai request đồng thời).
 */
const decideGatewayGate = async ({ gateId, decision, note = null, actor }) => {
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new ApiError(400, 'decision phải là APPROVED hoặc REJECTED');
  }
  if (decision === 'REJECTED' && !String(note || '').trim()) {
    throw new ApiError(400, 'Từ chối đề xuất cần nhập lý do');
  }

  const gate = await getGatewayGate(gateId);

  if (gate.status !== 'PENDING') {
    throw new ApiError(409, `Gate đã ở trạng thái ${gate.status}`);
  }
  if (new Date(gate.expiresAt) < new Date()) {
    throw new ApiError(400, 'Gate đã hết hạn');
  }

  const payload = gate.actionPayload && typeof gate.actionPayload === 'object' ? gate.actionPayload : {};
  const check = evaluateApproval({
    actionType: gate.actionType,
    payload,
    amount: payload.amount,
    actor,
  });
  if (!check.allowed) {
    logger.warn(
      `[agent-gateway] từ chối duyệt gate ${gate.id} bởi ${actor?.userId} (${actor?.role}): ${check.reason}`,
    );
    throw new ApiError(403, `Không được duyệt gate này: ${check.reason}`);
  }

  const claimed = await prisma.agentHumanGate.updateMany({
    where: { id: gate.id, status: 'PENDING' },
    data: buildDecisionData({ decision, note, userId: actor.userId }),
  });
  if (claimed.count !== 1) {
    throw new ApiError(409, 'Gate đã được xử lý bởi người khác');
  }

  const updated = await prisma.agentHumanGate.findFirst({ where: { id: gate.id } });
  logger.info(`[agent-gateway] gate ${gate.id} → ${decision} bởi ${actor.userId}`);
  return updated;
};

// ─────────────────────────────────────────────────────────────────────────────
// UC-002 — Kho SOP: nạp theo mục + tra cứu có ACL/phiên bản trong SQL WHERE
// ─────────────────────────────────────────────────────────────────────────────

/** `entity_type` dành riêng cho tài liệu quy định nội bộ. */
const KB_ENTITY_TYPE = 'SOP';

/** `COMPANY` = quy định áp dụng toàn công ty (đọc được ở mọi phòng ban). */
const KB_DEPARTMENTS = Object.freeze([
  'FINANCE', 'SALES', 'HR', 'OPS', 'WAREHOUSE', 'EXEC', 'COMPANY',
]);

const KB_ACCESS_LEVELS = Object.freeze([
  'public', 'internal', 'department_only', 'manager_only', 'confidential',
]);

/** Role đọc được mọi mức tài liệu (tương đương `department = 'EXEC'`). */
const KB_FULL_ACCESS_ROLES = Object.freeze([
  'SUPER_OMEGA_ULTRA_ADMIN', 'SUPER_ADMIN', 'ADMIN',
]);

/** Role đọc thêm được `manager_only` trong phòng mình. */
const KB_MANAGER_ROLES = Object.freeze(['MANAGER']);

/** Chuẩn hoá để so khớp từ khoá tất định (bỏ dấu, bỏ ký tự lạ). */
const normalizeKbText = (value) => String(value ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokenizeKb = (value) => [...new Set(
  normalizeKbText(value).split(' ').filter((token) => token.length >= 2),
)];

const countToken = (text, token) =>
  text.split(' ').filter((word) => word === token).length;

/**
 * Chấm điểm BM25-style tất định trên tiêu đề mục + nội dung + mã tài liệu.
 *
 * Không dùng embedding ở đây: CI/test phải chạy được khi không có Ollama, và kết
 * quả phải giống nhau giữa các lần chạy. Vector (nếu có) chỉ là tín hiệu cộng
 * thêm, không phải nguồn duy nhất.
 */
const scoreKbChunk = (row, tokens) => {
  if (!tokens || tokens.length === 0) return 0;
  const heading = normalizeKbText(row.section_heading);
  const body = normalizeKbText(row.content);
  const code = normalizeKbText(row.doc_code);

  let raw = 0;
  for (const token of tokens) {
    const inHeading = countToken(heading, token);
    const inBody = countToken(body, token);
    const inCode = countToken(code, token);
    if (inHeading === 0 && inBody === 0 && inCode === 0) continue;
    raw += inHeading * 3 + Math.min(inBody, 5) + inCode * 2;
  }
  if (raw === 0) return 0;

  // Bù độ dài: chunk dài không được thắng chỉ vì nhắc từ khoá nhiều lần.
  const penalty = 1 / Math.sqrt(1 + body.split(' ').length / 120);
  return Number((raw * penalty).toFixed(6));
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const mapKbChunk = (row) => ({
  docCode: row.doc_code,
  title: row.title || row.doc_code,
  version: row.version,
  department: row.department,
  accessLevel: row.access_level,
  sectionHeading: row.section_heading || 'Mở đầu',
  chunkIndex: Number.isInteger(row.chunk_index) ? row.chunk_index : 0,
  content: row.content,
  effectiveDate: toIso(row.effective_date),
  supersededAt: toIso(row.superseded_at),
  score: Number(row.score ?? 0),
});

/**
 * Nạp tài liệu SOP (idempotent theo `tenant_id + doc_code + version + chunk_index`).
 *
 * `entity_id` = `${docCode}@${version}#${chunkIndex}` nên ràng buộc unique sẵn có của
 * `ai_documents` chính là khoá idempotency — chạy hai lần không nhân bản.
 *
 * Bản mới cùng `docCode` mà khai `supersedesVersion` sẽ đóng dấu `superseded_at`
 * cho toàn bộ chunk của bản cũ NGAY tại `effectiveDate` của bản mới, nên không có
 * khoảng thời gian hai phiên bản cùng "có hiệu lực".
 */
const ingestKbDocument = async ({
  docCode,
  title = null,
  department = 'COMPANY',
  accessLevel = 'public',
  version = '1.0',
  effectiveDate = null,
  supersededAt = null,
  supersedesVersion = null,
  chunks = [],
  actor,
}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const tenantId = actor.tenantId ? String(actor.tenantId) : null;
  if (!tenantId) throw new ApiError(400, 'Không xác định được doanh nghiệp để nạp tài liệu');

  const code = String(docCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{2,40}$/.test(code)) {
    throw new ApiError(400, 'docCode không hợp lệ (ví dụ: SOP-FIN-001)');
  }

  const dept = normalizeCode(department || 'COMPANY');
  if (!KB_DEPARTMENTS.includes(dept)) {
    throw new ApiError(400, `department phải thuộc: ${KB_DEPARTMENTS.join(', ')}`);
  }

  const level = String(accessLevel || 'public').trim().toLowerCase();
  if (!KB_ACCESS_LEVELS.includes(level)) {
    throw new ApiError(400, `accessLevel phải thuộc: ${KB_ACCESS_LEVELS.join(', ')}`);
  }

  const ver = String(version || '1.0').trim();
  if (!ver) throw new ApiError(400, 'version là bắt buộc');

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new ApiError(400, 'Tài liệu không có nội dung để nạp');
  }
  if (chunks.length > 500) {
    throw new ApiError(400, 'Tài liệu vượt quá 500 mục — hãy tách thành nhiều docCode');
  }

  const effective = effectiveDate ? new Date(effectiveDate) : new Date();
  if (Number.isNaN(effective.getTime())) throw new ApiError(400, 'effectiveDate không hợp lệ');
  const superseded = supersededAt ? new Date(supersededAt) : null;
  if (supersededAt && Number.isNaN(superseded.getTime())) {
    throw new ApiError(400, 'supersededAt không hợp lệ');
  }

  const seenIndexes = new Set();
  const prepared = chunks.map((chunk, index) => {
    const content = String(chunk?.content ?? '').trim();
    if (!content) throw new ApiError(400, `Mục ${index} không có nội dung`);
    const sectionHeading = String(chunk?.sectionHeading ?? '').trim() || 'Mở đầu';
    const chunkIndex = Number.isInteger(chunk?.chunkIndex) && chunk.chunkIndex >= 0
      ? chunk.chunkIndex
      : index;
    if (seenIndexes.has(chunkIndex)) {
      throw new ApiError(400, `chunkIndex bị trùng: ${chunkIndex}`);
    }
    seenIndexes.add(chunkIndex);
    return { content, sectionHeading, chunkIndex };
  });

  const result = await prisma.$transaction(async (tx) => {
    let upserted = 0;

    for (const chunk of prepared) {
      const entityId = `${code}@${ver}#${chunk.chunkIndex}`;
      const metadata = {
        title: title || code,
        docCode: code,
        version: ver,
        department: dept,
        accessLevel: level,
        sectionHeading: chunk.sectionHeading,
        chunkIndex: chunk.chunkIndex,
      };

      const affected = await tx.$executeRawUnsafe(
        `INSERT INTO ai_documents
           (id, entity_type, entity_id, content, metadata, tenant_id,
            doc_code, department, access_level, version, effective_date, superseded_at,
            section_heading, chunk_index, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5,
                 $6, $7, $8, $9, $10, $11,
                 $12, $13, NOW(), NOW())
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET
           content       = EXCLUDED.content,
           metadata      = EXCLUDED.metadata,
           doc_code      = EXCLUDED.doc_code,
           department    = EXCLUDED.department,
           access_level  = EXCLUDED.access_level,
           version       = EXCLUDED.version,
           effective_date = EXCLUDED.effective_date,
           superseded_at = EXCLUDED.superseded_at,
           section_heading = EXCLUDED.section_heading,
           chunk_index   = EXCLUDED.chunk_index,
           updated_at    = NOW()
         WHERE ai_documents.tenant_id = EXCLUDED.tenant_id`,
        KB_ENTITY_TYPE,
        entityId,
        chunk.content,
        JSON.stringify(metadata),
        tenantId,
        code,
        dept,
        level,
        ver,
        effective,
        superseded,
        chunk.sectionHeading,
        chunk.chunkIndex,
      );

      // 0 dòng ⇒ xung đột tenant: KHÔNG "chuyển quyền sở hữu" tài liệu của shop khác.
      if (affected === 0) {
        throw new ApiError(
          409,
          `Không ghi được mục ${chunk.chunkIndex}: mã tài liệu đã thuộc doanh nghiệp khác`,
        );
      }
      upserted += 1;
    }

    // Tài liệu rút ngắn: bỏ các mục cũ vượt quá số mục hiện tại.
    const removed = await tx.$executeRawUnsafe(
      `DELETE FROM ai_documents
        WHERE entity_type = $1 AND tenant_id = $2 AND doc_code = $3 AND version = $4
          AND chunk_index >= $5`,
      KB_ENTITY_TYPE,
      tenantId,
      code,
      ver,
      prepared.length,
    );

    let supersededCount = 0;
    if (supersedesVersion) {
      supersededCount = await tx.$executeRawUnsafe(
        `UPDATE ai_documents
            SET superseded_at = $1, updated_at = NOW()
          WHERE entity_type = $2 AND tenant_id = $3 AND doc_code = $4 AND version = $5
            AND superseded_at IS NULL`,
        effective,
        KB_ENTITY_TYPE,
        tenantId,
        code,
        String(supersedesVersion).trim(),
      );
    }

    return { upserted, removed, supersededCount };
  });

  logger.info(
    `[agent-gateway] nạp SOP ${code} v${ver} (${dept}/${level}) — ${result.upserted} mục`,
  );

  return {
    docCode: code,
    title: title || code,
    department: dept,
    accessLevel: level,
    version: ver,
    effectiveDate: effective.toISOString(),
    supersededAt: superseded ? superseded.toISOString() : null,
    chunks: prepared.length,
    upserted: result.upserted,
    removed: result.removed,
    superseded: result.supersededCount,
  };
};

/**
 * Tra cứu SOP.
 *
 * MỌI bộ lọc bảo mật nằm trong `WHERE` của SQL, TRƯỚC khi dữ liệu rời DB:
 *   - `tenant_id` (không trộn tài liệu shop khác).
 *   - `access_level` theo role/phòng ban của ACTOR GỐC lấy từ DB.
 *   - hiệu lực phiên bản tại `asOf` — không trộn bản cũ với bản mới.
 * Lọc sau khi lấy về (trong code hay trong prompt) là lỗi đã từng xảy ra: dữ liệu
 * mật vẫn đi qua ranh giới process và có thể lọt vào log/trace.
 *
 * Xếp hạng làm ở JS trên tập ĐÃ lọc — tất định, không phụ thuộc dịch vụ ngoài.
 */
const searchKb = async ({
  query,
  asOf = null,
  topK = 5,
  includeHistorical = false,
  actor,
}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const q = String(query ?? '').trim();
  if (q.length < 2) throw new ApiError(400, 'query quá ngắn');

  const asOfDate = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(asOfDate.getTime())) throw new ApiError(400, 'asOf không hợp lệ');

  const limit = Math.min(Math.max(Number(topK) || 5, 1), 20);
  const tenantId = actor.tenantId ? String(actor.tenantId) : null;

  const params = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];

  // ── Tenant
  if (tenantId) {
    const p = bind(tenantId);
    where.push(`(d.tenant_id = ${p} OR d.tenant_id IS NULL)`);
  } else {
    where.push('d.tenant_id IS NULL');
  }

  where.push(`d.entity_type = ${bind(KB_ENTITY_TYPE)}`);
  where.push('d.doc_code IS NOT NULL');

  // ── ACL
  const role = normalizeCode(actor.role);
  const actorDept = normalizeCode(actor.department);
  const fullAccess = KB_FULL_ACCESS_ROLES.includes(role) || actorDept === 'EXEC';

  if (!fullAccess) {
    const openLevels = ['public', 'internal'];
    const scopedLevels = ['department_only'];
    if (KB_MANAGER_ROLES.includes(role)) scopedLevels.push('manager_only');

    const openPh = openLevels.map((level) => bind(level)).join(', ');
    const scopedPh = scopedLevels.map((level) => bind(level)).join(', ');
    const deptPh = bind(actorDept || '__NONE__');
    const companyPh = bind('COMPANY');

    where.push(
      `(d.access_level IN (${openPh})
        OR (d.access_level IN (${scopedPh})
            AND (d.department = ${deptPh} OR d.department = ${companyPh})))`,
    );
  }

  // ── Phiên bản có hiệu lực tại `asOf`
  const asOfPh = bind(asOfDate);
  where.push(`d.effective_date <= ${asOfPh}`);
  if (!includeHistorical) {
    where.push(`(d.superseded_at IS NULL OR d.superseded_at > ${asOfPh})`);
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT d.doc_code, d.version, d.department, d.access_level, d.section_heading,
            d.chunk_index, d.content, d.effective_date, d.superseded_at,
            d.metadata->>'title' AS title
       FROM ai_documents d
      WHERE ${where.join(' AND ')}
      ORDER BY d.doc_code ASC, d.version ASC, d.chunk_index ASC
      LIMIT 2000`,
    ...params,
  );

  const tokens = tokenizeKb(q);
  const scored = rows
    .map((row) => ({ ...row, score: scoreKbChunk(row, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || String(a.doc_code).localeCompare(String(b.doc_code))
      || String(a.version).localeCompare(String(b.version))
      || Number(a.chunk_index) - Number(b.chunk_index)
    ));

  return {
    query: q,
    asOf: asOfDate.toISOString(),
    includeHistorical: Boolean(includeHistorical),
    topK: limit,
    total: scored.length,
    chunks: scored.slice(0, limit).map(mapKbChunk),
  };
};

module.exports = {
  DEPARTMENTS,
  KB_ENTITY_TYPE,
  KB_DEPARTMENTS,
  KB_ACCESS_LEVELS,
  ingestKbDocument,
  searchKb,
  scoreKbChunk,
  normalizeKbText,
  GATEWAY_ACTION_TYPES,
  APPROVAL_POLICY,
  ROLE_DEFAULT_DEPARTMENT,
  normalizeDepartment,
  resolveDepartment,
  buildScopes,
  getAuthContext,
  auditAgentEvent,
  queryAuditLogs,
  buildAuditScope,
  getPermissionMatrix,
  evaluateApproval,
  APPROVAL_POLICY,
  createGatewayGate,
  getGatewayGate,
  decideGatewayGate,
};
