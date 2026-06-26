/**
 * utils/response.js — Helper trả response JSON chuẩn hóa
 * 
 * Tổng quan:
 * - Format chuẩn: { success: true/false, message, data, pagination? }
 * - Dùng trong controller: sendSuccess(res, data), sendPaginated(res, data, pagination)
 * - Đảm bảo mọi API đều trả về cấu trúc nhất quán
 * 
 * Hàm:
 * - success(res, data, message, statusCode): 200 OK mặc định
 * - created(res, data, message): 201 Created
 * - error(res, message, statusCode): Lỗi với status tùy chỉnh (ít dùng, ưu tiên next(err))
 * - paginated(res, data, pagination): 200 + { success, data, pagination: { page, limit, total, totalPages } }
 */

const success = (res, data = null, message = 'Thành công', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
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
    data,
    pagination, // { page, limit, total, totalPages }
  });
};

module.exports = { success, created, error, paginated };
