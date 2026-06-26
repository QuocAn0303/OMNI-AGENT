/**
 * utils/apiError.js — Class lỗi tùy chỉnh cho HTTP errors
 * 
 * Tổng quan:
 * - Kế thừa Error, thêm status code và details
 * - Dùng trong service/controller: throw new ApiError(400, "Số lượng không đủ")
 * - Được error.middleware bắt và trả về response JSON chuẩn
 * 
 * Hàm:
 * - constructor(status, message, details): Tạo lỗi với HTTP status, message, chi tiết kèm
 */

class ApiError extends Error {
  constructor(status = 500, message = "server nội bộ lỗi", details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
