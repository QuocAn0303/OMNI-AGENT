/**
 * modules/auth/auth.controller.js — Request handler cho auth
 * 
 * Tổng quan:
 * - Validate input bằng Zod schema → gọi service → trả response chuẩn
 * - Mỗi hàm tương ứng 1 endpoint, đều có try/catch → next(err) cho error middleware
 * 
 * Hàm:
 * - login(req, res, next): Xác thực đăng nhập, trả token + user
 * - register(req, res, next): Đăng ký tenant + user mới, gửi email verify
 * - verifyEmail(req, res, next): Xác minh email bằng token
 * - getProfile(req, res, next): Lấy profile user hiện tại (req.user.id)
 * - changePassword(req, res, next): Đổi mật khẩu (cần currentPassword + newPassword)
 * - refresh(req, res, next): Làm mới access token
 * - logout(req, res, next): Thu hồi refresh token (1 token hoặc all)
 */

const { z } = require("zod");
const authService = require("./auth.service");
const twoFactorService = require("./2fa.service");
const auditService = require("../audit/audit.service");
const { success } = require("../../utils/response");
const {
  loginSchema,
  changePasswordSchema,
  registerSchema,
  verifyEmailSchema,
} = require("./auth.validation");

// ─────────────────────────────────────────────────────────────
// M7: Refresh token trong httpOnly cookie (Secure + SameSite)
// - JS không đọc được → XSS không thể trộm refresh token
// - Access token vẫn trả qua body (ngắn hạn) — mọi request vẫn gắn Bearer
// - Cookie chỉ gửi tới path /api/auth (refresh + logout)
// ─────────────────────────────────────────────────────────────
const REFRESH_COOKIE = "rt";

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth",
  maxAge: (Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 7) * 24 * 60 * 60 * 1000,
});

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
  });
};

// Lấy refresh token: cookie là nguồn chính (M7), body giữ để tương thích ngược
const getRefreshToken = (req) => req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

const login = async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);

    // 2FA chưa xong → chỉ trả challenge, không có token
    if (result.requires2fa) {
      return success(res, result, "Vui lòng xác thực 2FA");
    }

    // M7: refresh token → httpOnly cookie, không trả trong body
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
      const { refreshToken, ...rest } = result;
      return success(res, rest, "Đăng nhập thành công");
    }
    success(res, result, "Đăng nhập thành công");
  } catch (err) {
    next(err);
  }
};

const getProfile = async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.id);
    success(res, user);
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const data = changePasswordSchema.parse(req.body);
    const result = await authService.changePassword(req.user.id, data);
    success(res, null, result.message);
  } catch (err) {
    next(err);
  }
};

const verifyPassword = async (req, res, next) => {
  try {
    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
    const result = await authService.verifyPassword(req.user.id, password);
    success(res, null, result.message);
  } catch (err) {
    next(err);
  }
};

const refresh = async (req, res, next) => {
  try {
    // M7: đọc refresh token từ cookie (httpOnly) — fallback body cho client cũ
    const refreshToken = getRefreshToken(req);
    if (!refreshToken) {
      throw { status: 401, message: "Thiếu refresh token" };
    }
    const result = await authService.refreshAccessToken(refreshToken);
    setRefreshCookie(res, result.refreshToken);
    const { refreshToken: _rt, ...rest } = result;
    success(res, rest, "Lấy token mới thành công");
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    clearRefreshCookie(res);
    // M7: ưu tiên revoke token từ cookie; không có cookie → revoke toàn bộ user
    const cookieToken = req.cookies?.[REFRESH_COOKIE];
    if (cookieToken) {
      await authService.revokeRefreshToken({ token: cookieToken });
    } else if (req.body?.all || !req.body?.refreshToken) {
      await authService.revokeRefreshToken({
        userId: req.user?.id,
        revokeAll: true,
      });
    } else {
      await authService.revokeRefreshToken({ token: req.body.refreshToken });
    }
    success(res, null, "Đăng xuất thành công");
  } catch (err) {
    next(err);
  }
};

const register = async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body)
    const result = await authService.register(data)
    success(res, result, 'Vui lòng kiểm tra email để xác minh tài khoản')
  } catch (err) {
    next(err)
  }
}

const verifyEmail = async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.query)
    const result = await authService.verifyEmail(token)
    success(res, result, 'Xác minh email thành công')
  } catch (err) {
    next(err)
  }
}

const setup2fa = async (req, res, next) => {
  try {
    const result = await twoFactorService.setup2fa(req.user.id);
    success(res, result, 'Tạo mã 2FA thành công');
  } catch (err) {
    next(err);
  }
};

const enable2fa = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) throw { status: 400, message: 'Thiếu mã OTP' };
    const result = await twoFactorService.enable2fa(req.user.id, token);
    success(res, result, 'Bật 2FA thành công');
  } catch (err) {
    next(err);
  }
};

const disable2fa = async (req, res, next) => {
  try {
    await twoFactorService.disable2fa(req.user.id);
    success(res, null, 'Tắt 2FA thành công');
  } catch (err) {
    next(err);
  }
};

const verify2fa = async (req, res, next) => {
  try {
    const { challenge, token } = req.body;
    if (!challenge || !token) throw { status: 400, message: 'Thiếu challenge hoặc mã OTP' };

    // userId lấy từ challenge JWT (do /login tạo, hết hạn 5 phút)
    // KHÔNG nhận userId từ body — chống attacker tự chọn user mục tiêu
    const userId = authService.verify2faChallenge(challenge);

    const isValid = await twoFactorService.verify2fa(userId, token);
    if (!isValid) throw { status: 400, message: 'Mã OTP hoặc mã dự phòng không hợp lệ' };

    const tokens = await authService.generateTokens(userId);

    auditService.log({
      userId,
      action: 'LOGIN',
      entity: 'User',
      entityId: userId,
      after: { twoFactorUsed: true },
    });

    if (tokens.refreshToken) setRefreshCookie(res, tokens.refreshToken);
    const { refreshToken, ...rest } = tokens;
    success(res, rest, 'Xác thực 2FA thành công');
  } catch (err) {
    next(err);
  }
};

module.exports = { login, register, verifyEmail, getProfile, changePassword, verifyPassword, refresh, logout, setup2fa, enable2fa, disable2fa, verify2fa };
