/**
 * policy/policyEngine.ts — Xương sống bảo mật UC-009 (hai tầng, default-deny).
 *
 * ============================================================================
 * BỐN MỆNH ĐỀ CỦA UC-009
 * ============================================================================
 * 1. Policy engine RBAC/ABAC trong TỆP CẤU HÌNH, default-deny.
 * 2. Kiểm quyền HAI TẦNG: `authorizeHandoff` (lúc orchestrator giao việc) VÀ
 *    `authorizeTool` (lúc agent gọi tool). Không tầng nào dựa vào prompt.
 * 3. Actor GỐC đi xuyên mọi handoff, không nâng quyền (`assertActorUnchanged`).
 * 4. Audit tách khỏi trace — việc ghi nằm ở telemetry/, không ở đây.
 *
 * ============================================================================
 * KHÔNG DÙNG PROMPT ĐỂ CHẶN
 * ============================================================================
 * Mọi quyết định đọc từ `AuthContext` do gateway trả về (JWT + DB). Văn bản
 * người dùng gõ không đi vào hàm nào ở đây, nên "tôi là Giám đốc" không thể
 * đổi `role`/`department`.
 */
import policyConfig from './policy.config.json';
import type {
  AuthContext,
  AuthzDecision,
  HandoffEnvelope,
} from '../contracts/types';

export interface PolicyRule {
  role: string;
  department: string;
  resource: string;
  actions: string[];
  effect?: 'ALLOW' | 'DENY';
  projection?: string[];
  note?: string;
}

export interface PolicyConfigFile {
  version: string;
  defaultEffect: 'ALLOW' | 'DENY';
  agentDepartments: Record<string, string>;
  agentResources: Record<string, string[]>;
  handoff: {
    targets: Record<string, string[]>;
    /**
     * Agent phục vụ toàn công ty (tra cứu quy định nội bộ). Mọi role được giao
     * việc cho các agent này bất kể phòng ban — việc chặn tài liệu nhạy cảm do
     * ACL trong SQL của `kb/search` thực hiện theo actor gốc.
     */
    alwaysAllowedAgents?: string[];
  };
  fieldProjection: { default: string[]; individualSalary: string[] };
  rules: PolicyRule[];
}

const CONFIG = policyConfig as unknown as PolicyConfigFile;

export const policyVersion = CONFIG.version;

export type AccessMode = 'aggregate' | 'individual';

const allow = (layer: AuthzDecision['layer'], reason: string, fieldProjection: string[] = []): AuthzDecision => ({
  layer,
  effect: 'ALLOW',
  reason,
  fieldProjection,
});

const deny = (layer: AuthzDecision['layer'], reason: string): AuthzDecision => ({
  layer,
  effect: 'DENY',
  reason,
  fieldProjection: [],
});

/** Khớp resource, hỗ trợ `*` và tiền tố `dept.*`. */
const matchesResource = (pattern: string, resource: string): boolean => {
  if (pattern === '*') return true;
  if (pattern === resource) return true;
  if (pattern.endsWith('*')) return resource.startsWith(pattern.slice(0, -1));
  return false;
};

const matchesExactOrStar = (value: string, actual: string): boolean => value === '*' || value === actual;

/**
 * Suy ra chế độ truy cập từ tham số tool.
 *
 * VÌ SAO KHÔNG TIN `args.mode` MỘT MÌNH: client có thể gửi `mode: 'aggregate'`
 * trong khi thực chất đang đọc một bản ghi. Có mặt khoá định danh thì mặc định
 * coi là CÁ NHÂN — hướng an toàn.
 */
export const inferAccessMode = (action: string, args: Record<string, unknown> = {}): AccessMode => {
  if (action === 'write' || action === 'approve') return 'individual';
  if (args.mode === 'aggregate' || args.aggregate === true || args.summaryOnly === true) {
    return 'aggregate';
  }
  const identityKeys = ['employeeId', 'userId', 'customerId', 'orderId', 'invoiceId', 'id'];
  if (identityKeys.some((key) => args[key] !== undefined && args[key] !== null)) return 'individual';
  return 'aggregate';
};

const requiredActions = (action: string, mode: AccessMode): string[] => {
  if (action === 'read') {
    return mode === 'individual' ? ['read_individual', 'read', '*'] : ['read_aggregate', 'read', '*'];
  }
  return [action, '*'];
};

const findRule = (
  ctx: AuthContext,
  resource: string,
  actions: string[],
): PolicyRule | null =>
  CONFIG.rules.find(
    (rule) =>
      matchesExactOrStar(rule.role, ctx.role)
      && (rule.department === '*' || rule.department === ctx.department)
      && matchesResource(rule.resource, resource)
      && rule.actions.some((a) => actions.includes(a)),
  ) || null;

/**
 * Actor gốc bất biến: bất kỳ trường danh tính nào lệch ⇒ coi như leo quyền.
 *
 * Dùng ở mọi điểm có thể "dựng lại" actor (handoff, checkpoint resume, hàng đợi).
 */
export const assertActorUnchanged = (original: AuthContext, candidate: AuthContext): void => {
  if (!candidate) throw new Error('actor_mutated: thiếu actor');
  const same =
    original.userId === candidate.userId
    && original.tenantId === candidate.tenantId
    && original.role === candidate.role
    && original.department === candidate.department;
  if (!same) {
    throw new Error(
      `actor_mutated: actor gốc (${original.userId}/${original.role}/${original.department}) `
      + `≠ actor nhận được (${candidate.userId}/${candidate.role}/${candidate.department})`,
    );
  }
};

/**
 * TẦNG 1 — kiểm quyền lúc giao việc.
 *
 * Chặn cả trường hợp "giao việc trái phòng ban" và trường hợp envelope mang
 * actor đã bị sửa (tự xưng Giám đốc trong prompt rồi nhét vào envelope).
 */
export const authorizeHandoff = (ctx: AuthContext, envelope: HandoffEnvelope): AuthzDecision => {
  if (!ctx?.userId || !ctx?.department || !ctx?.tenantId) {
    return deny('HANDOFF', 'missing_actor_context');
  }
  if (!envelope || !envelope.actor) return deny('HANDOFF', 'missing_envelope');

  // Actor BẤT BIẾN: envelope phải mang đúng actor gốc, không phải bản "nâng cấp".
  if (
    envelope.actor.userId !== ctx.userId
    || envelope.actor.tenantId !== ctx.tenantId
    || envelope.actor.role !== ctx.role
    || envelope.actor.department !== ctx.department
  ) {
    return deny('HANDOFF', 'actor_mutated');
  }
  if (envelope.runId !== ctx.runId) return deny('HANDOFF', 'run_id_mismatch');

  const targetDepartment = CONFIG.agentDepartments[envelope.toAgent];
  if (!targetDepartment) return deny('HANDOFF', `unknown_target_agent:${envelope.toAgent}`);

  // Agent phục vụ toàn công ty: nhận câu hỏi về MỌI phòng ban, nên phòng ban
  // trong envelope chỉ là thông tin mô tả. ACL tài liệu do SQL của `kb/search`
  // thực thi theo actor gốc.
  const companyWideAgents = CONFIG.handoff.alwaysAllowedAgents || [];
  const isCompanyWide = companyWideAgents.includes(envelope.toAgent);
  if (!isCompanyWide && envelope.department !== targetDepartment) {
    return deny('HANDOFF', `department_mismatch:${envelope.department}!=${targetDepartment}`);
  }
  if (!CONFIG.agentDepartments[envelope.fromAgent]) {
    return deny('HANDOFF', `unknown_source_agent:${envelope.fromAgent}`);
  }

  const allowedTargets = CONFIG.handoff.targets[ctx.role] || [];
  if (!isCompanyWide && !allowedTargets.includes('*') && !allowedTargets.includes(targetDepartment)) {
    return deny('HANDOFF', `handoff_not_permitted:${ctx.role}->${targetDepartment}`);
  }

  if (!Array.isArray(envelope.allowedTools) || envelope.allowedTools.length === 0) {
    return deny('HANDOFF', 'no_allowed_tools');
  }

  return allow('HANDOFF', `handoff_allowed:${envelope.fromAgent}->${envelope.toAgent}`);
};

/**
 * TẦNG 2 — kiểm quyền lúc gọi tool.
 *
 * Ba lớp, theo thứ tự:
 *   a) Agent có thuộc phòng ban sở hữu resource này không (chặn "agent sales
 *      gọi tool của hr").
 *   b) ACTOR GỐC có rule cho (role, department, resource, action) không — đây
 *      là lớp chặn việc đi vòng qua agent khác.
 *   c) Rule bị đánh DENY tường minh ⇒ từ chối.
 */
export const authorizeTool = (
  ctx: AuthContext,
  agentName: string,
  toolName: string,
  resource: string,
  action: string,
  args: Record<string, unknown> = {},
): AuthzDecision => {
  if (!ctx?.userId || !ctx?.department || !ctx?.tenantId) {
    return deny('TOOL', 'missing_actor_context');
  }

  const agentDepartment = CONFIG.agentDepartments[agentName];
  if (!agentDepartment) return deny('TOOL', `unknown_agent:${agentName}`);

  const domains = CONFIG.agentResources[agentName] || [];
  const domain = String(resource).split('.')[0];
  if (!domains.includes('*') && !domains.includes(domain)) {
    return deny('TOOL', `agent_department_scope:${agentName}:${domain}`);
  }

  const mode = inferAccessMode(action, args);
  const rule = findRule(ctx, resource, requiredActions(action, mode));
  if (!rule) {
    return deny('TOOL', `actor_not_permitted:${resource}:${action}:${mode}`);
  }
  if (rule.effect === 'DENY') {
    return deny('TOOL', `policy_denied:${resource}:${action}`);
  }

  const projection = rule.projection && rule.projection.length
    ? rule.projection
    : mode === 'aggregate'
      ? CONFIG.fieldProjection.default
      : [];

  return allow('TOOL', `policy_allow:${rule.role}:${resource}:${mode}`, projection);
};

/** Xoá field bị ẩn, đệ quy qua object/array (không mutate input). */
export const projectFields = <T>(value: T, fields: string[]): T => {
  if (!fields || fields.length === 0) return value;
  const hidden = new Set(fields);
  return stripFields(value, hidden) as T;
};

const stripFields = (value: unknown, hidden: Set<string>): unknown => {
  if (Array.isArray(value)) return value.map((item) => stripFields(item, hidden));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (hidden.has(key)) continue;
      out[key] = stripFields(child, hidden);
    }
    return out;
  }
  return value;
};

export const getAgentDepartment = (agentName: string): string | null =>
  CONFIG.agentDepartments[agentName] || null;
