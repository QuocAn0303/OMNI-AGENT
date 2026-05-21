// src/modules/auth/auth.validation.js
const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6, "Mật khẩu mới tối thiểu 6 ký tự"),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10, "Refresh token không hợp lệ"),
});

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
  all: z.boolean().optional().default(false),
});

module.exports = {
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  logoutSchema,
};
