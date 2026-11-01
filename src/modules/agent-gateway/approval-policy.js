/**
 * modules/agent-gateway/approval-policy.js — Quy tắc duyệt gate của agent-gateway.
 *
 * ============================================================================
 * VÌ SAO TÁCH RIÊNG KHỎI SERVICE
 * ============================================================================
 * `agent-gateway.service.js` require Prisma (và qua đó là cả `@prisma/client`).
 * Package `agents/` bị CẤM chạm Prisma — kể cả trong test — nên không thể import
 * file service để kiểm chứng ca tấn công "tự duyệt Gate".
 *
 * Tệp này là hàm THUẦN: không Prisma, không fs, không mạng. Nhờ vậy:
 *   - service dùng nó làm nguồn sự thật duy nhất khi duyệt gate (403);
 *   - `agents/tests/uc009-security-attacks.test.ts` gọi ĐÚNG hàm đó để chứng
 *     minh self-approval bị chặn, không phải một bản sao logic trong test.
 *
 * KHÔNG đổi tên/sửa ngữ nghĩa các mã lý do (`self_approval_forbidden`,
 * `amount_over_role_limit:<role>:<limit>`, ...) — frontend và test đang bám vào.
 */

/** Hạn mức duyệt theo role (VND). `null` = không giới hạn. */
const APPROVAL_POLICY = Object.freeze({
  INVOICE_3WAY_APPROVAL: Object.freeze({
    roles: Object.freeze(['ACCOUNTANT', 'ADMIN', 'SUPER_ADMIN', 'SUPER_OMEGA_ULTRA_ADMIN']),
    limits: Object.freeze({
      ACCOUNTANT: 50_000_000,
      ADMIN: null,
      SUPER_ADMIN: null,
      SUPER_OMEGA_ULTRA_ADMIN: null,
    }),
  }),
  QUOTE_DISCOUNT_APPROVAL: Object.freeze({
    roles: Object.freeze(['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'SUPER_OMEGA_ULTRA_ADMIN']),
    limits: Object.freeze({
      MANAGER: 10_000_000,
      ADMIN: null,
      SUPER_ADMIN: null,
      SUPER_OMEGA_ULTRA_ADMIN: null,
    }),
  }),
});

/**
 * Tự duyệt: MẶC ĐỊNH CHẶN cho hai gate của agent-gateway.
 *
 * Khác `PURCHASE_ORDER_PROPOSAL` (cho phép tự duyệt + audit `selfApproved`) vì
 * đúng khách SME chỉ có một chủ shop. Ở đây đề xuất đến từ agent, nên người đề
 * xuất và người duyệt phải khác nhau — nếu không, vòng kiểm soát chỉ là hình thức.
 * Muốn nới phải thêm actionType vào set này một cách TƯỜNG MINH.
 */
const SELF_APPROVAL_ALLOWED = new Set();

const normalizeCode = (value) => String(value || '').trim().toUpperCase();

/**
 * Kiểm tra quyền duyệt — hàm thuần, unit-test được.
 *
 * @param {{ actionType: string, payload?: object, amount?: number|null, actor?: object }} input
 * @returns {{ allowed: boolean, reason: string }}
 */
const evaluateApproval = ({ actionType, payload = {}, amount = null, actor = {} }) => {
  const policy = APPROVAL_POLICY[actionType];
  if (!policy) return { allowed: false, reason: `action_type_not_supported:${actionType}` };

  const role = normalizeCode(actor.role);
  if (!policy.roles.includes(role)) return { allowed: false, reason: `role_not_approver:${role}` };

  const createdBy = payload.createdByUserId || null;
  if (createdBy && actor.userId && createdBy === actor.userId && !SELF_APPROVAL_ALLOWED.has(actionType)) {
    return { allowed: false, reason: 'self_approval_forbidden' };
  }

  const rawAmount = amount == null ? Number(payload.amount) : Number(amount);
  const value = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
  const limit = policy.limits[role];
  if (limit != null && value > limit) {
    return { allowed: false, reason: `amount_over_role_limit:${role}:${limit}` };
  }

  return { allowed: true, reason: 'ok' };
};

/**
 * Mô tả công khai của quy tắc duyệt (cho `GET /permission-matrix`).
 * Không chứa dữ liệu nghiệp vụ — chỉ cấu hình.
 */
const describeApprovalRules = () =>
  Object.entries(APPROVAL_POLICY).map(([actionType, policy]) => ({
    actionType,
    approverRoles: [...policy.roles],
    limits: { ...policy.limits },
    selfApprovalAllowed: SELF_APPROVAL_ALLOWED.has(actionType),
  }));

module.exports = {
  APPROVAL_POLICY,
  SELF_APPROVAL_ALLOWED,
  evaluateApproval,
  describeApprovalRules,
};
