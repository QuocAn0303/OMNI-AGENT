/**
 * middleware/error.middleware.js — Global error handler (phải đặt cuối app.js)
 * 
 * Tổng quan:
 * - Bắt tất cả lỗi từ next(err) trong toàn bộ app
 * - Xử lý theo thứ tự ưu tiên: ZodError → PrismaError → ApiError → object error → fallback 500
 * - Trả về response JSON chuẩn: { success: false, message, errors?, details? }
 * 
 * Hàm:
 * - errorHandler(err, req, res, next):
 *     1. ZodError (validation): 400 + danh sách field lỗi
 *     2. Prisma P2002 (unique): 409 "Dữ liệu đã tồn tại"
 *     3. Prisma P2025 (not found): 404
 *     4. ApiError: status + message tùy chỉnh
 *     5. Object error { status, message }: trả về tương ứng
 *     6. Fallback: 500 "Lỗi máy chủ nội bộ"
 */

const { ZodError } = require("zod");
const { Prisma } = require("@prisma/client");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const errorHandler = (err, req, res, next) => {
  logger.error("❌ Error: %o", err);

  // Zod validation error
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Dữ liệu không hợp lệ",
      errors: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // Prisma known errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: `Dữ liệu đã tồn tại: ${err.meta?.target}`,
      });
    }
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy dữ liệu" });
    }
  }

  // ApiError thrown intentionally
  if (err instanceof ApiError) {
    return res
      .status(err.status)
      .json({
        success: false,
        message: err.message,
        ...(err.details && { details: err.details }),
      });
  }

  // Plain object errors like: throw { status: 400, message: '...' }
  if (err && typeof err === "object" && (err.status || err.message)) {
    const status = err.status || 500;
    return res
      .status(status)
      .json({
        success: false,
        message: err.message || "Lỗi máy chủ nội bộ",
        ...(err.details && { details: err.details }),
      });
  }

  // Fallback
  res.status(500).json({ success: false, message: "Lỗi máy chủ nội bộ" });
};

module.exports = errorHandler;
