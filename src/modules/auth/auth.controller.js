// src/modules/auth/auth.controller.js
const authService = require("./auth.service");
const { success } = require("../../utils/response");
const {
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  logoutSchema,
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
    const { companyName, email, password, industry } = req.body
    if (!companyName || !email || !password) {
      return next({ status: 400, message: 'Thiếu thông tin bắt buộc' })
    }
    const result = await authService.register({ companyName, email, password, industry })
    success(res, result, 'Đăng ký thành công')
  } catch (err) {
    next(err)
  }
}

module.exports = { login, register, getProfile, changePassword, refresh, logout };
