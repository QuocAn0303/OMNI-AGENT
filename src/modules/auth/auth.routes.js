// src/modules/auth/auth.routes.js
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const authController = require("./auth.controller");
const { authenticate } = require("../../middleware/auth.middleware");

const loginLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Quá nhiều yêu cầu đăng nhập, vui lòng thử lại sau.",
  },
});

router.post("/login", loginLimiter, authController.login);
router.post("/register", authController.register);
router.post("/refresh", authController.refresh); // Lấy access token mới bằng refresh token
router.post("/logout", authenticate, authController.logout); // Đăng xuất (revoke token)
router.get("/me", authenticate, authController.getProfile);
router.put("/change-password", authenticate, authController.changePassword);

module.exports = router;
