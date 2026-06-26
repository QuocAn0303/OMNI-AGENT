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

const authService = require("./auth.service");
const { success } = require("../../utils/response");
const {
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  logoutSchema,
  registerSchema,
  verifyEmailSchema,
} = require("./auth.validation");

const login = async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);
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

const refresh = async (req, res, next) => {
  try {
    const data = refreshSchema.parse(req.body);
    const result = await authService.refreshAccessToken(data.refreshToken);
    success(res, result, "Lấy token mới thành công");
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    const data = logoutSchema.parse(req.body);
    // Nếu gửi { all: true } thì revoke all tokens for current user
    if (data.all) {
      await authService.revokeRefreshToken({
        userId: req.user?.id,
        revokeAll: true,
      });
    } else {
      await authService.revokeRefreshToken({ token: data.refreshToken });
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

module.exports = { login, register, verifyEmail, getProfile, changePassword, refresh, logout };
