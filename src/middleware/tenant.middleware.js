/**
 * middleware/tenant.middleware.js — Gắn tenantId vào request
 * 
 * Tổng quan:
 * - Lấy tenantId từ req.user (đã được giải mã từ JWT)
 * - SUPER_ADMIN bỏ qua (không gắn tenantId) vì có thể thao tác đa tenant
 * - Các service sau đó dùng req.tenantId để filter dữ liệu theo tenant
 * 
 * Hàm:
 * - tenantMiddleware(): Gán req.tenantId = req.user.tenantId (nếu không phải SUPER_ADMIN)
 */

const tenantMiddleware = (req, res, next) => {
  if (req.user?.role === 'SUPER_ADMIN') {
    return next()
  }

  const tenantId = req.user?.tenantId
  if (!tenantId) {
    return next({ status: 403, message: 'Tenant not found' })
  }

  req.tenantId = tenantId
  next()
}

module.exports = { tenantMiddleware }
