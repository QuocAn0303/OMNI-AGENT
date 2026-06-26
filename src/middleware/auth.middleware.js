/**
 * middleware/auth.middleware.js — Xác thực & phân quyền JWT
 * 
 * Tổng quan:
 * - Xác thực token JWT (Bearer) từ header Authorization
 * - Phân quyền dựa trên role: SUPER_OMEGA_ULTRA_ADMIN, SUPER_ADMIN, ADMIN, MANAGER, CASHIER, WAREHOUSE
 * - Tất cả middleware đều trả về lỗi chuẩn qua next(err) để error.middleware xử lý
 * 
 * Hàm:
 * - authenticate(): Verify JWT, giải mã → gắn req.user = decoded payload
 * - authorize(...roles): Kiểm tra req.user.role có trong danh sách được phép
 * - requireRole(roles): Alias nhận array for convenience
 * - requireSuperOmega(): Kiểm tra role = SUPER_OMEGA_ULTRA_ADMIN (đặc quyền cao nhất)
 */

const jwt = require("jsonwebtoken");

// Thêm vào file src/middleware/auth.middleware.js hoặc một file middleware riêng cho admin

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

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next({ status: 401, message: "Không có token xác thực" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    req.user = decoded;
    next();
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
