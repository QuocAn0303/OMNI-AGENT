/**
 * modules/auth/auth.validation.js — Zod schemas cho auth endpoints
 * 
 * Tổng quan:
 * - Định nghĩa validation rules cho tất cả input của auth
 * - Dùng trong controller: schema.parse(req.body) → tự động throw ZodError nếu không hợp lệ
 * - ZodError được error.middleware bắt và trả về 400 + danh sách field lỗi
 * 
 * Schemas:
 * - loginSchema: email (email), password (min 6)
 * - changePasswordSchema: currentPassword (min 6), newPassword (min 6)
 * - refreshSchema: refreshToken (min 10)
 * - logoutSchema: refreshToken (optional), all (boolean, default false)
 * - registerSchema: companyName (min 2), email, password (min 6), industry (optional), fullName (optional, min 2)
 * - verifyEmailSchema: token (min 1)
 */

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

const registerSchema = z.object({
  companyName: z.string().min(2, "Tên công ty tối thiểu 2 ký tự"),
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự"),
  industry: z.string().optional(),
  fullName: z.string().min(2, "Họ tên tối thiểu 2 ký tự").optional(),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Thiếu token xác minh"),
});

module.exports = {
  loginSchema,
  changePasswordSchema,
  refreshSchema,
  logoutSchema,
  registerSchema,
  verifyEmailSchema,
};
