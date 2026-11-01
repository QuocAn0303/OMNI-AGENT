/**
 * modules/agent-gateway/memory-core.js — luật THUẦN của bộ nhớ dài hạn (UC-007).
 *
 * Tệp này KHÔNG chạm Prisma/HTTP. Nhờ vậy:
 *   - `memory.service.factory.js` dùng lại cho production + test in-memory;
 *   - unit test của package `agents/` require trực tiếp để kiểm chứng đúng luật
 *     mà server chạy, không dựng bản sao trong test.
 *
 * Ba nhóm luật:
 *   1. PII 100% (uỷ quyền `memory-pii.js`).
 *   2. Ranh giới nghiệp vụ (uỷ quyền `memory-boundary.js`).
 *   3. ACL phạm vi + supersede + TTL.
 */

const { scanPii, PII_CATEGORIES, PII_CATEGORY_LABELS } = require('./memory-pii');
const { scanMemoryBoundary, BOUNDARY_CATEGORIES, BOUNDARY_CATEGORY_LABELS } = require('./memory-boundary');

const MEMORY_SCOPES = Object.freeze(['company', 'department', 'user']);

/** Role được coi là quản trị nền tảng/tenant. EXEC là phòng, không phải role. */
const PRIVILEGED_ROLES = Object.freeze([
  'ADMIN',
  'SUPER_ADMIN',
  'SUPER_OMEGA_ULTRA_ADMIN',
]);

const DEPARTMENT_MANAGER_ROLES = Object.freeze(['MANAGER', ...PRIVILEGED_ROLES]);

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();

const isPrivilegedActor = (actor = {}) =>
  PRIVILEGED_ROLES.includes(normalizeCode(actor.role)) || normalizeCode(actor.department) === 'EXEC';

const isDepartmentManager = (actor = {}) =>
  isPrivilegedActor(actor) || DEPARTMENT_MANAGER_ROLES.includes(normalizeCode(actor.role));

/**
 * Chuẩn hoá khoá chủ đề: lowercase, gộp khoảng trắng, nối bằng '-'.
 * Dùng CÙNG hàm khi ghi và khi supersede để hai fact cùng chủ đề không lọt.
 */
const normalizeMemoryKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 160);

const normalizeScope = (value) => {
  const scope = String(value ?? '').trim().toLowerCase();
  return MEMORY_SCOPES.includes(scope) ? scope : null;
};

/** Phạm vi hiệu lực của một bản ghi — dùng cho cả supersede lẫn ACL. */
const memoryTuple = (memory = {}) => ({
  tenantId: String(memory.tenantId ?? ''),
  scope: String(memory.scope ?? ''),
  department: memory.department ? String(memory.department) : null,
  userId: memory.userId ? String(memory.userId) : null,
  memoryKey: String(memory.memoryKey ?? ''),
});

const evaluatePii = (content) => scanPii(content);

const evaluateBoundary = (content) => scanMemoryBoundary(content);

/**
 * Quyền GHI một scope.
 *
 * - user: luôn bị ép về chính actor (không có tham số `userId` từ client).
 * - department: MANAGER+ và CHỈ phòng của mình; ADMIN/EXEC được chọn phòng.
 * - company: ADMIN/SUPER_* / EXEC.
 *
 * @returns {{allowed: boolean, status: number, code: string|null, reason: string|null}}
 */
const evaluateWritePermission = ({ actor = {}, scope, department = null } = {}) => {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) {
    return { allowed: false, status: 400, code: 'MEMORY_SCOPE_INVALID', reason: 'scope không hợp lệ' };
  }

  if (!actor.userId || !actor.tenantId) {
    return { allowed: false, status: 403, code: 'MEMORY_TENANT_REQUIRED', reason: 'thiếu tenant/actor' };
  }

  if (normalizedScope === 'user') {
    return { allowed: true, status: 200, code: null, reason: null };
  }

  if (normalizedScope === 'company') {
    return isPrivilegedActor(actor)
      ? { allowed: true, status: 200, code: null, reason: null }
      : {
        allowed: false,
        status: 403,
        code: 'MEMORY_SCOPE_FORBIDDEN',
        reason: 'chỉ ADMIN/SUPER_* hoặc EXEC được ghi bộ nhớ company',
      };
  }

  const targetDepartment = normalizeCode(department);
  if (!targetDepartment) {
    return { allowed: false, status: 400, code: 'MEMORY_DEPARTMENT_REQUIRED', reason: 'thiếu department' };
  }

  if (!isDepartmentManager(actor)) {
    return {
      allowed: false,
      status: 403,
      code: 'MEMORY_SCOPE_FORBIDDEN',
      reason: 'chỉ MANAGER trở lên được ghi bộ nhớ department',
    };
  }

  if (!isPrivilegedActor(actor) && targetDepartment !== normalizeCode(actor.department)) {
    return {
      allowed: false,
      status: 403,
      code: 'MEMORY_DEPARTMENT_FORBIDDEN',
      reason: 'chỉ được ghi bộ nhớ cho đúng phòng ban của mình',
    };
  }

  return { allowed: true, status: 200, code: null, reason: null };
};

/**
 * Quyền SỬA/XOÁ một bản ghi đã có.
 *
 * - user: CHỈ đúng chủ sở hữu (kể cả ADMIN cũng không sửa memory user của người khác).
 * - department: MANAGER+ cùng phòng, hoặc ADMIN/EXEC.
 * - company: ADMIN/SUPER_* / EXEC.
 */
const evaluateModifyPermission = ({ actor = {}, memory = {} } = {}) => {
  const scope = normalizeScope(memory.scope);

  if (!actor.userId || !actor.tenantId) {
    return { allowed: false, status: 403, code: 'MEMORY_TENANT_REQUIRED', reason: 'thiếu tenant/actor' };
  }

  if (scope === 'user') {
    return String(memory.userId || '') === String(actor.userId)
      ? { allowed: true, status: 200, code: null, reason: null }
      : {
        allowed: false,
        status: 403,
        code: 'MEMORY_OWNER_REQUIRED',
        reason: 'chỉ chủ sở hữu được sửa/xoá bộ nhớ user',
      };
  }

  if (scope === 'company') {
    return isPrivilegedActor(actor)
      ? { allowed: true, status: 200, code: null, reason: null }
      : {
        allowed: false,
        status: 403,
        code: 'MEMORY_SCOPE_FORBIDDEN',
        reason: 'chỉ ADMIN/SUPER_* hoặc EXEC được sửa/xoá bộ nhớ company',
      };
  }

  if (scope === 'department') {
    if (isPrivilegedActor(actor)) return { allowed: true, status: 200, code: null, reason: null };
    if (
      isDepartmentManager(actor)
      && normalizeCode(memory.department) === normalizeCode(actor.department)
    ) {
      return { allowed: true, status: 200, code: null, reason: null };
    }
    return {
      allowed: false,
      status: 403,
      code: 'MEMORY_DEPARTMENT_FORBIDDEN',
      reason: 'chỉ MANAGER cùng phòng được sửa/xoá bộ nhớ department',
    };
  }

  return { allowed: false, status: 400, code: 'MEMORY_SCOPE_INVALID', reason: 'scope không hợp lệ' };
};

/**
 * Mệnh đề `where` Prisma cho lần NẠP bộ nhớ vào context.
 *
 * Lọc CỨNG trong SQL:
 *   tenantId
 *   AND (company OR department của actor OR user của actor)
 *   AND supersededAt IS NULL
 *   AND (expiresAt IS NULL OR expiresAt > now)
 *
 * Không có nhánh nào lọc sau khi đọc — nhờ vậy user A không bao giờ nhận được
 * dòng của user B, HR không nhận được dòng của SALES.
 */
const buildVisibilityWhere = ({ tenantId, actor = {}, now = new Date() } = {}) => {
  if (!tenantId) throw new Error('buildVisibilityWhere: thiếu tenantId');
  if (!actor.userId) throw new Error('buildVisibilityWhere: thiếu actor.userId');

  const visibility = [{ scope: 'company' }];
  const department = normalizeCode(actor.department);
  if (department) visibility.push({ scope: 'department', department });
  visibility.push({ scope: 'user', userId: String(actor.userId) });

  return {
    tenantId: String(tenantId),
    supersededAt: null,
    OR: visibility,
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
  };
};

/** Bản thuần của `buildVisibilityWhere` — dùng trong test và khi cần kiểm nhanh. */
const isMemoryVisible = ({ actor = {}, memory = {}, now = new Date() } = {}) => {
  if (!actor.userId || String(memory.tenantId || '') !== String(actor.tenantId || '')) return false;
  if (memory.supersededAt) return false;
  if (memory.expiresAt && new Date(memory.expiresAt).getTime() <= new Date(now).getTime()) return false;

  const scope = normalizeScope(memory.scope);
  if (scope === 'company') return true;
  if (scope === 'department') {
    return Boolean(actor.department)
      && normalizeCode(memory.department) === normalizeCode(actor.department);
  }
  if (scope === 'user') return String(memory.userId || '') === String(actor.userId);
  return false;
};

/**
 * Chuẩn hoá các trường phạm vi từ input. Client KHÔNG BAO GIỜ quyết định userId
 * của memory `user` — luôn lấy từ actor đã xác thực.
 */
const resolveScopeFields = ({ actor = {}, input = {} } = {}) => {
  const scope = normalizeScope(input.scope || 'user');
  if (!scope) return { scope: null, department: null, userId: null };

  if (scope === 'company') return { scope, department: null, userId: null };

  if (scope === 'department') {
    return {
      scope,
      department: normalizeCode(input.department || actor.department) || null,
      userId: null,
    };
  }

  return { scope, department: null, userId: String(actor.userId) };
};

/** Bản mới kế thừa version + 1; bản cũ nhận `supersededById` của bản mới. */
const buildSupersedePlan = ({ existing = null, nextId, now = new Date() } = {}) => {
  if (!existing) {
    return { nextId, version: 1, supersede: null };
  }
  return {
    nextId,
    version: Number(existing.version || 1) + 1,
    supersede: {
      id: existing.id,
      data: {
        supersededAt: now,
        supersededById: nextId,
      },
    },
  };
};

module.exports = {
  MEMORY_SCOPES,
  PRIVILEGED_ROLES,
  DEPARTMENT_MANAGER_ROLES,
  PII_CATEGORIES,
  PII_CATEGORY_LABELS,
  BOUNDARY_CATEGORIES,
  BOUNDARY_CATEGORY_LABELS,
  normalizeCode,
  normalizeMemoryKey,
  normalizeScope,
  isPrivilegedActor,
  isDepartmentManager,
  memoryTuple,
  evaluatePii,
  evaluateBoundary,
  evaluateWritePermission,
  evaluateModifyPermission,
  buildVisibilityWhere,
  isMemoryVisible,
  resolveScopeFields,
  buildSupersedePlan,
};
