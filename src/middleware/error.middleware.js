// src/middleware/error.middleware.js
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
