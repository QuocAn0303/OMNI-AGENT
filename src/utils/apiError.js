//lỗi tùy chỉnh để dễ dàng quản lý và trả về lỗi có cấu trúc thống nhất
//src/utils/apiError.js
class ApiError extends Error {
  constructor(status = 500, message = "server nội bộ lỗi", details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
