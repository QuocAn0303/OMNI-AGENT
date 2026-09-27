/**
 * modules/auth/auth.validation.js — Zod schemas cho auth endpoints
 *
 * Schemas:
 * - loginSchema: email, password (min 8)
 * - changePasswordSchema: currentPassword (min 8), newPassword (min 8 + complexity)
 * - registerSchema: companyName, email, password (min 8 + complexity)
 * - refreshSchema, logoutSchema, verifyEmailSchema
 */

const { z } = require("zod");

// Password policy: tối thiểu 8 ký tự, có ít nhất 1 chữ hoa + 1 chữ số
const strongPassword = z
  .string()
  .min(8, "Mật khẩu tối thiểu 8 ký tự")
  .regex(/[A-Z]/, "Mật khẩu phải có ít nhất 1 chữ hoa")
  .regex(/[0-9]/, "Mật khẩu phải có ít nhất 1 chữ số");

// Login: cho phép password cũ yếu (để user cũ vẫn login được), nhưng khuyến nghị đổi
const loginPassword = z.string().min(6, "Mật khẩu tối thiểu 6 ký tự");

const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: loginPassword,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: strongPassword,
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
  password: strongPassword,
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
