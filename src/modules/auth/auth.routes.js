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
const { success } = require("../../utils/response");
const prisma = require("../../config/prisma");
const { authenticate, requireSuperOmega } = require("../../middleware/auth.middleware");

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

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu đăng ký, vui lòng thử lại sau." },
});

const twofaVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu xác thực 2FA, vui lòng thử lại sau." },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu refresh, vui lòng thử lại sau." },
});

const verifyPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều lần xác nhận mật khẩu, vui lòng thử lại sau." },
});

router.post("/login", loginLimiter, authController.login);
router.post("/register", registerLimiter, authController.register);
router.get("/verify-email", authController.verifyEmail);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.getProfile);
router.put("/change-password", authenticate, authController.changePassword);
router.post("/verify-password", authenticate, verifyPasswordLimiter, authController.verifyPassword);

// 2FA routes
router.post("/2fa/setup", authenticate, authController.setup2fa);
router.post("/2fa/enable", authenticate, authController.enable2fa);
router.post("/2fa/disable", authenticate, authController.disable2fa);
router.post("/2fa/verify", twofaVerifyLimiter, authController.verify2fa);

// Session management
router.get("/sessions", authenticate, async (req, res, next) => {
  try {
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.user.id, expiresAt: { gte: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    success(res, sessions);
  } catch (e) { next(e); }
});

router.delete("/sessions/:id", authenticate, async (req, res, next) => {
  try {
    const token = await prisma.refreshToken.findUnique({ where: { id: req.params.id } });
    if (!token || token.userId !== req.user.id) throw { status: 404, message: "Không tìm thấy phiên" };
    await prisma.refreshToken.delete({ where: { id: req.params.id } });
    success(res, null, "Đã đăng xuất thiết bị");
  } catch (e) { next(e); }
});

router.delete("/sessions", authenticate, async (req, res, next) => {
  try {
    await prisma.refreshToken.deleteMany({
      where: { userId: req.user.id },
    });
    success(res, null, "Đã đăng xuất tất cả thiết bị");
  } catch (e) { next(e); }
});

const ROLE_LABELS = {
  SUPER_OMEGA_ULTRA_ADMIN: "Siêu admin",
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Quản trị viên",
  MANAGER: "Quản lý",
  ACCOUNTANT: "Kế toán",
  CASHIER: "Thu ngân",
  WAREHOUSE: "Thủ kho",
};

// Permissions & RBAC
router.get("/permissions", authenticate, async (req, res, next) => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: { group: "asc" } });
    const rolePerms = await prisma.rolePermission.findMany();
    const mapping = {};
    for (const rp of rolePerms) {
      if (!mapping[rp.role]) mapping[rp.role] = [];
      mapping[rp.role].push(rp.permissionKey);
    }
    const roles = Object.keys(ROLE_LABELS).map(role => ({
      role,
      label: ROLE_LABELS[role],
      permissions: mapping[role] || [],
    }));
    success(res, { permissions, roles });
  } catch (e) { next(e); }
});

router.patch("/permissions", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const { role, permissionKeys } = req.body;
    if (!role || !Array.isArray(permissionKeys)) throw { status: 400, message: "Thiếu role hoặc permissionKeys" };
    if (!ROLE_LABELS[role]) throw { status: 400, message: "Role không hợp lệ" };

    const existing = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    const validKeys = new Set(existing.map(p => p.key));
    const invalidKeys = permissionKeys.filter(k => !validKeys.has(k));
    if (invalidKeys.length) throw { status: 400, message: `Permission keys không hợp lệ: ${invalidKeys.join(", ")}` };

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role } });
      if (permissionKeys.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionKeys.map(key => ({ role, permissionKey: key })),
        });
      }
    });

    success(res, null, "Cập nhật phân quyền thành công");
  } catch (e) { next(e); }
});

module.exports = router;
