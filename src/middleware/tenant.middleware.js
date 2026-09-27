/**
 * middleware/tenant.middleware.js — Gắn tenant context cho mỗi request
 *
 * - Đọc tenantId từ req.user (do authenticate gắn vào)
 * - SUPER_OMEGA_ULTRA_ADMIN: bypass tenant scoping (xem được tất cả tenant)
 * - Route không có auth (public): middleware không set context → service tự set
 *   bằng runWithTenant() khi cần (vd: QR ordering lấy tenantId từ table)
 *
 * Phải mount SAU authenticate() nhưng TRƯỚC routes.
 */
const { runWithTenant } = require('../config/tenantContext');

const tenantContext = (req, res, next) => {
  const tenantId = req.user?.tenantId || null;
  const bypass = req.user?.role === 'SUPER_OMEGA_ULTRA_ADMIN';

  if (!tenantId && !bypass) {
    // Không có tenantId và không phải super admin → vẫn cho đi qua
    // (public route không qua authenticate sẽ rơi vào case này)
    return next();
  }

  runWithTenant(tenantId, () => next(), bypass);
};

module.exports = { tenantContext };
