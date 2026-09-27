/**
 * middleware/auth.middleware.js — Xác thực & phân quyền JWT
 * 
 * Tổng quan:
 * - Xác thực token JWT (Bearer) từ header Authorization
 * - Phân quyền dựa trên role: SUPER_OMEGA_ULTRA_ADMIN, SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT, CASHIER, WAREHOUSE
 * - Tất cả middleware đều trả về lỗi chuẩn qua next(err) để error.middleware xử lý
 * 
 * Hàm:
 * - authenticate(): Verify JWT, giải mã → gắn req.user = decoded payload
 * - authorize(...roles): Kiểm tra req.user.role có trong danh sách được phép
 * - requireRole(roles): Alias nhận array for convenience
 * - requireSuperOmega(): Kiểm tra role = SUPER_OMEGA_ULTRA_ADMIN (đặc quyền cao nhất)
 */

const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const { runWithTenant } = require("../config/tenantContext");
const logger = require('../utils/logger');

const requireSuperOmega = (req, res, next) => {
  if (!req.user) {
    return next({ status: 401, message: "Chưa xác thực tài khoản" });
  }

  if (req.user.role !== "SUPER_OMEGA_ULTRA_ADMIN") {
    return next({
      status: 403,
      message:
        "Từ chối truy cập. Tính năng này chỉ dành cho cấp điều hành tối cao.",
    });
  }
  next();
};

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next({ status: 401, message: "Không có token xác thực" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Check user still exists and is active
    try {
      // Lưu ý: chạy TRƯỚC runWithTenant → không có tenant context → extension
      // auto-scoping bỏ qua → query theo id toàn cục đúng như mong muốn.
      // Support access token: kiểm tra phiên còn ACTIVE + chưa hết hạn (thu hồi được thật)
      if (decoded.supportSessionId) {
        const session = await prisma.supportAccessSession.findUnique({
          where: { id: decoded.supportSessionId },
          select: { id: true, status: true, expiresAt: true },
        });
        if (!session || session.status !== "ACTIVE" || new Date(session.expiresAt) < new Date()) {
          return next({ status: 401, message: "Phiên hỗ trợ đã hết hạn hoặc bị thu hồi" });
        }
        req.user = decoded;
        runWithTenant(decoded.tenantId, () => next(), false);
        return;
      }
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, isActive: true, role: true, tenantId: true, tokenVersion: true },
      });
      if (!user || !user.isActive) {
        return next({ status: 401, message: "Tài khoản đã bị vô hiệu hoá" });
      }
      // M1: tokenVersion mismatch = mật khẩu đã đổi sau khi token được cấp
      // → token cũ (kể cả chưa hết hạn) bị vô hiệu ngay lập tức
      if ((decoded.tokenVersion || 0) !== user.tokenVersion) {
        return next({ status: 401, message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
      }
      // Token thường: refresh tenantId/role từ DB (tránh token cũ có giá trị sai)
      req.user = { ...decoded, tenantId: user.tenantId || null, role: user.role };
    } catch (dbErr) {
      logger.error("[auth] DB check failed — rejecting request:", dbErr.message);
      return next({ status: 503, message: "Không thể xác thực lúc này, vui lòng thử lại" });
    }
    // Set tenant context cho Prisma extension auto-scoping
    const bypass = req.user.role === "SUPER_OMEGA_ULTRA_ADMIN";
    runWithTenant(req.user.tenantId, () => next(), bypass);
  } catch (err) {
    return next({ status: 401, message: "Token không hợp lệ hoặc đã hết hạn" });
  }
};

// Kiểm tra role
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: "Chưa xác thực" });
    }

    if (!roles.includes(req.user.role)) {
      return next({
        status: 403,
        message: "Bạn không có quyền thực hiện hành động này",
      });
    }
    next();
  };
};

// Alias: nhận array of roles (vd: requireRole(["ADMIN", "MANAGER"]))
const requireRole = (roles) =>
  authorize(...(Array.isArray(roles) ? roles : [roles]));

module.exports = { authenticate, authorize, requireRole, requireSuperOmega };
