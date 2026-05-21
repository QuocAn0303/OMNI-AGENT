// src/middleware/auth.middleware.js
const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next({ status: 401, message: "Không có token xác thực" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
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

module.exports = { authenticate, authorize };
