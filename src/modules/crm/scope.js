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
 *
 * Hàm:
 * - isManager(user): true nếu role được xem toàn bộ pipeline của tenant
 * - ownerScope(user, field): mảnh where giới hạn theo owner
 * - canAccess(user, record, field): có được đọc/ghi record này không
 * - assertAccess(user, record, field, entityName): canAccess hoặc throw 403
 * - filterOwned(rows, userId): lọc mảng record in-memory theo owner (fallback khi
 *   không thể filter ở tầng DB, ví dụ data đã nằm trong response của 1 query khác)
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

const canAccess = (user, record, field = "leadOwnerId") => {
  if (isManager(user)) return true;
  if (!record) return false;
  return record[field] === user?.id;
};

const assertAccess = (user, record, field = "leadOwnerId", entityName = "bản ghi") => {
  if (!record) throw new ApiError(404, `${entityName} không tồn tại`);
  if (!canAccess(user, record, field)) {
    throw new ApiError(403, `Bạn không có quyền truy cập ${entityName} này`);
  }
  return record;
};

// Lọc mảng record in-memory theo owner (dùng khi query đã lấy sẵn nhiều bản ghi)
const filterOwned = (rows, user, field = "leadOwnerId") => {
  if (isManager(user)) return rows;
  return (rows || []).filter((r) => r?.[field] === user?.id);
};

module.exports = {
  MANAGER_ROLES,
  isManager,
  ownerScope,
  canAccess,
  assertAccess,
  filterOwned,
};
