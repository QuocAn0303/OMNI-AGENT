/**
 * modules/auth/auth.routes.js — Routes xác thực người dùng
 * 
 * Tổng quan:
 * - 7 endpoints: login, register, verify-email, refresh, logout, me, change-password
 * - Login có rate-limit riêng: 10 lần/15 phút/IP
 * - /me, /change-password, /logout yêu cầu authenticate middleware
 * 
 * Endpoints:
 * - POST /login: Đăng nhập (email + password) → token + refreshToken + user
 * - POST /register: Đăng ký tenant mới → gửi email xác minh
 * - GET /verify-email?token=...: Xác minh email
 * - POST /refresh: Làm mới access token từ refresh token
 * - POST /logout: Thu hồi refresh token (có thể revoke all)
 * - GET /me: Lấy thông tin user hiện tại
 * - PUT /change-password: Đổi mật khẩu
 */

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
router.get("/verify-email", authController.verifyEmail);
router.post("/refresh", authController.refresh);
router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.getProfile);
router.put("/change-password", authenticate, authController.changePassword);

module.exports = router;
