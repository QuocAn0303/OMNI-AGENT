/**
 * modules/crm/scope.js — Phân quyền theo record của CRM Sales Pipeline
 *
 * Tổng quan:
 * - Mô hình `Customer` cũ cho phép CASHIER xem TOÀN BỘ khách hàng của tenant.
 *   Pipeline thì khác: mỗi lead/deal có `leadOwnerId`/`dealOwnerId` — người phụ trách.
 *   Cần cơ chế "record-level permission" như Frappe CRM (User Permission).
 * - `ownerScope(user)` trả về mảnh `where` để ghép vào query list:
 *     - MANAGER/ADMIN/SUPER_ADMIN/SUPER_OMEGA_ULTRA_ADMIN → `{}` (thấy tất cả)
 *     - role khác (CASHIER, WAREHOUSE, ACCOUNTANT) → `{ leadOwnerId: user.id }`
 *       tức chỉ thấy record mình làm chủ.
* - `canAccess(user, record)` kiểm tra 1 record cụ thể (dùng cho getById/update/remove).
 * - `assertAccess(user, record, entityName)` ném lỗi 403 nếu không được phép.
 * - CRM Phase 4: `ownerScopeForTeam` mở rộng phạm vi theo cây báo cáo — manager
 *   thấy record của mình + bậc dưới, thay vì toàn bộ tenant. `hierarchy.service.js`
 *   cung cấp tập id; hàm này chỉ ghép vào `where` (không require vòng).
 * 
 * Hàm:
 * - isManager(user): true nếu role được xem toàn bộ pipeline của tenant
 * - ownerScope(user, field): mảnh where giới hạn theo owner
 * - ownerScopeForTeam(user, field, teamIds): ownerScope nhưng theo tập id (cây báo cáo)
 * - canAccess(user, record, field): có được đọc/ghi record này không
 * - assertAccess(user, record, field, entityName): canAccess hoặc throw 403
 * - filterOwned(rows, userId): lọc mảng record in-memory theo owner (fallback khi
 *   không thể filter ở tầng DB, ví dụ data đã nằm trong response của 1 query khác)
 * - assertRefsInTenant(refs): chặn FK trỏ sang tenant khác (H3)
 * - resolveOwnerId(requestedId, user): non-manager không tự gán owner được (H7)
 */
const ApiError = require("../../utils/apiError");

// Role được xem TOÀN BỘ pipeline của tenant (không giới hạn theo owner)
const MANAGER_ROLES = new Set([
  "SUPER_OMEGA_ULTRA_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
]);

const isManager = (user) => Boolean(user && MANAGER_ROLES.has(user.role));

/**
 * Mảnh `where` giới hạn theo owner.
 * @param {Object} user - req.user
 * @param {string} field - tên field owner trên model (leadOwnerId | dealOwnerId)
 */
const ownerScope = (user, field = "leadOwnerId") => {
  if (isManager(user)) return {};
  if (!user || !user.id) {
    // Không xác định được user → chặn tối đa (không rò lead của người khác)
    return { [field]: "__no_user__" };
  }
  return { [field]: user.id };
};

/**
 * Quyền trên 1 record cụ thể.
 * @param {string[]} allowedIds - tập id được phép (từ cây báo cáo):
 *   - `null`/`undefined` → cây KHÔNG áp dụng → role quản lý toàn quyền như Phase 2/3.
 *   - `[]` → cây ĐÃ cấu hình nhưng không còn bậc dưới nào → fail-CLOSED (chỉ của mình).
 *   - `[...]` → mình + bậc dưới.
 */
const canAccess = (user, record, field = "leadOwnerId", allowedIds = null) => {
  if (!record) return false;
  if (!Array.isArray(allowedIds)) {
    if (isManager(user)) return true;
    return record[field] === user?.id;
  }
  // [] hoặc [id] đều là phạm vi hẹp — chỉ record owner nằm trong tập mới được.
  return allowedIds.includes(record[field]);
};

const assertAccess = (
  user,
  record,
  field = "leadOwnerId",
  entityName = "bản ghi",
  allowedIds = null,
) => {
  if (!record) throw new ApiError(404, `${entityName} không tồn tại`);
  if (!canAccess(user, record, field, allowedIds)) {
    throw new ApiError(403, `Bạn không có quyền truy cập ${entityName} này`);
  }
  return record;
};

// Lọc mảng record in-memory theo owner (dùng khi query đã lấy sẵn nhiều bản ghi)
const filterOwned = (rows, user, field = "leadOwnerId") => {
  if (isManager(user)) return rows;
  return (rows || []).filter((r) => r?.[field] === user?.id);
};

/**
 * CRM audit H3 — ràng buộc FK trong Postgres KHÔNG kiểm tra `tenantId`.
 *
 * `stageId` được kiểm đúng (query tenant-scoped → 404) nhưng `organizationId`,
 * `contactId`, `leadOwnerId`, `dealOwnerId`, `customerId`, `leadId` chỉ được kiểm
 * là UUID. Kẻ tấn công biết UUID tenant khác (thường có trong log hoặc export) có
 * thể tạo lead của tenant A trỏ sang org của tenant B → `GET /crm/leads/:id` kéo
 * relation lồng (`organization { name }`, `contact { fullName, email, phone }`) và
 * trả dữ liệu tenant B. Nguyên nhân gốc: `config/prisma.js` chỉ scope operation
 * cấp cao nhất, KHÔNG scope nested relation.
 *
 * Hàm này chặn ở tầng ghi: mọi FK trỏ sang bảng khác phải tồn tại trong tenant.
 *
 * @param {Array<{model: string, id: string|null|undefined, label: string}>} refs
 */
const assertRefsInTenant = async (refs) => {
  const list = (refs || []).filter((r) => r?.id && r?.model);
  if (!list.length) return;

  // Require trong hàm: giữ đúng nguyên tắc "scope.js không giữ phụ thuộc nặng"
  // của file này (chỉ ApiError), tránh mọi vòng require tiềm ẩn.
  const prisma = require("../../config/prisma");
  const { getTenantId, isBypassTenant } = require("../../config/tenantContext");

  if (!getTenantId() || isBypassTenant()) return;

  for (const ref of list) {
    const delegate = prisma[ref.model];
    // Model không có trong client (test mock một phần) → không kiểm được,
    // đừng chặn nghiệp vụ chỉ vì thiếu mock.
    if (!delegate?.findFirst) continue;
    const found = await delegate.findFirst({ where: { id: ref.id }, select: { id: true } });
    if (!found) {
      throw new ApiError(400, `${ref.label} không tồn tại trong tổ chức của bạn`);
    }
  }
};

/**
 * CRM audit H7 — người dùng KHÔNG quản lý chỉ được phép giữ việc cho chính mình.
 *
 * Frontend đã ẩn field owner cho non-manager (`Leads.jsx`, `DealDetail.jsx`) nhưng
 * backend nhận thẳng `data.leadOwnerId`/`data.dealOwnerId` từ body ⇒ CASHIER tự
 * gán việc cho đồng nghiệp, đẩy lead sang bảng người khác VÀ bắn notification
 * "Bạn được giao lead mới" cho người bị hại (spam + tiền đề cho chiêu lừa đảo).
 *
 * @returns {string|null} ownerId hợp lệ
 */
const resolveOwnerId = (requestedId, user) => {
  if (isManager(user)) return requestedId ?? null;
  // Không phải quản lý → ép về chính mình, kể cả khi client gửi id người khác.
  return user?.id ?? null;
};

/**
 * CRM Phase 4 — mở rộng phạm vi theo cây báo cáo.
 *
 * Phase 2/3: MANAGER thấy TOÀN BỘ tenant (`ownerScope` trả `{}`). Ở quy mô nhiều
 * chi nhánh thì quá rộng — trưởng chi nhánh A không nên thấy pipeline của chi nhánh B.
 * Với cây `User.reportsToId`, MANAGER chỉ thấy record của mình + mọi bậc dưới.
 *
 * Hàm này thuộc đây nhưng cố ý KHÔNG require `hierarchy.service` ở top-level:
 * `hierarchy.service` cần `isManager` từ file này → require vòng sẽ làm
 * `check:modules` fail (bài học Phase 1, mục 0b).
 *
 * @param {Object} user - req.user
 * @param {string} field - leadOwnerId | dealOwnerId
 * @param {string[]} teamIds - danh sách id từ `hierarchy.getTeamUserIds(user)`:
 *   `null` = chưa cấu hình cây (giữ hành vi Phase 2/3) · `[]` = cây đã cấu hình
 *   nhưng không còn ai (fail-closed) · `[...]` = mình + bậc dưới.
 */
const ownerScopeForTeam = (user, field = "leadOwnerId", teamIds = null) => {
  // null/undefined = cây phẳng (chưa cấu hình) → lùi về hành vi Phase 2/3.
  if (!Array.isArray(teamIds)) return ownerScope(user, field);
  // CRM audit C4: [] = cây ĐÃ cấu hình nhưng user không còn bậc dưới nào. Trả về
  // phạm vi của chính mình thay vì `ownerScope` (toàn tenant cho manager).
  if (teamIds.length === 0) return { [field]: user?.id ?? "__no_user__" };
  // Một người → giữ nguyên dạng scalar của `ownerScope`. Nhiều người mới dùng `{ in }`.
  // Giữ dạng scalar quan trọng vì nhiều test (và code đọc log) assert `where.leadOwnerId`
  // bằng `=== id`; đổi shape ở đây là thay đổi hợp đồng không cần thiết.
  if (teamIds.length === 1) return { [field]: teamIds[0] };
  return { [field]: { in: teamIds } };
};

module.exports = {
  MANAGER_ROLES,
  isManager,
  ownerScope,
  ownerScopeForTeam,
  canAccess,
  assertAccess,
  filterOwned,
  assertRefsInTenant,
  resolveOwnerId,
};
