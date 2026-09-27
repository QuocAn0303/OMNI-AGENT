/**
 * utils/response.js — Helper trả response JSON chuẩn hóa
 * 
 * Tổng quan:
 * - Format chuẩn: { success: true/false, message, data, pagination? }
 * - Dùng trong controller: sendSuccess(res, data), sendPaginated(res, data, pagination)
 * - Đảm bảo mọi API đều trả về cấu trúc nhất quán
 * - Mask PII tự động ở response layer cho role thấp (CASHIER, WAREHOUSE)
 * 
 * Hàm:
 * - success(res, data, message, statusCode): 200 OK mặc định
 * - created(res, data, message): 201 Created
 * - error(res, message, statusCode): Lỗi với status tùy chỉnh (ít dùng, ưu tiên next(err))
 * - paginated(res, data, pagination): 200 + { success, data, pagination: { page, limit, total, totalPages } }
 */
const { maskPII } = require("./piiMask");

const requestRole = (res) => {
  try {
    return res.req && res.req.user ? res.req.user.role : null;
  } catch {
    return null;
  }
};

const success = (res, data = null, message = 'Thành công', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data: maskPII(data, requestRole(res)) });
};

const created = (res, data, message = 'Tạo thành công') => {
  return success(res, data, message, 201);
};

const error = (res, message = 'Lỗi', statusCode = 400) => {
  return res.status(statusCode).json({ success: false, message });
};

const paginated = (res, data, pagination) => {
  return res.status(200).json({
    success: true,
    data: maskPII(data, requestRole(res)),
    pagination, // { page, limit, total, totalPages }
  });
};

// Alias compatibility — some newer modules use sendSuccess/sendError/sendPaginated
const sendSuccess = success;
const sendError = error;
const sendPaginated = paginated;

module.exports = { success, created, error, paginated, sendSuccess, sendError, sendPaginated };
