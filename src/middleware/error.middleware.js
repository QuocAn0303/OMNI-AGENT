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

// M5 (security): ánh xạ lỗi Prisma sang thông điệp cố định, an toàn cho client.
// Trước đây chỉ P2002/P2025 được xử lý; mọi code khác rơi xuống nhánh
// "plain object error" và trả nguyên `err.message` ra client — trong đó
//   P2010/P2011 : message chứa TOÀN BỘ câu SQL đã gửi tới Postgres
//   P2000/P2003 : lộ tên bảng/cột và ràng buộc khoá ngoại
//   Validation  : lộ tên model, tên field và chữ ký input type của Prisma client
const PRISMA_CLIENT_MESSAGES = {
  P2000: { status: 400, message: "Giá trị gửi lên vượt quá độ dài cho phép" },
  P2003: { status: 400, message: "Dữ liệu tham chiếu không tồn tại hoặc còn liên kết" },
  P2010: { status: 500, message: "Lỗi truy vấn cơ sở dữ liệu" },
  P2011: { status: 500, message: "Lỗi truy vấn cơ sở dữ liệu" },
  P2012: { status: 500, message: "Lỗi truy vấn cơ sở dự liệu" },
  P2014: { status: 400, message: "Quan hệ dữ liệu không hợp lệ" },
  P2015: { status: 400, message: "Không tìm thấy bản ghi cần cập nhật" },
  P2023: { status: 400, message: "Dữ liệu không hợp lệ" },
  P2024: { status: 400, message: "Truy vấn vượt quá thời gian cho phép" },
  P2028: { status: 500, message: "Lỗi giao dịch cơ sở dữ liệu" },
  P2034: { status: 409, message: "Giao dịch bị xung đột, vui lòng thử lại" },
};

// Dấu hiệu message do Prisma sinh ra — dùng để chặn ở nhánh plain-object error,
// nơi `err` không phải instance Prisma nên `instanceof` không bắt được (ví dụ
// lỗi bị đóng gói lại rồi ném, hoặc import.routes trả err.message trong HTTP 200).
const PRISMA_MESSAGE_MARKERS = [
  /Invalid\s+`?prisma/i,
  /prisma\.[a-zA-Z]+\.(create|update|delete|find|upsert|createMany|updateMany|deleteMany|aggregate|groupBy|count|executeRaw|queryRaw)\s*\(/i,
  /\bArgument\s+\w+\s+of type\b/i,
  /\binvocation\b/i,
  /\bUnknown (argument|field|model|type)\b/i,
  /\bconstraint failed on the database\b/i,
  /\bForeign key constraint\b/i,
  /\bdata (and|or) column\b/i,
];

const looksLikePrismaMessage = (msg) =>
  typeof msg === "string" && PRISMA_MESSAGE_MARKERS.some((re) => re.test(msg));

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
      // Security: không rò tên bảng/cột DB (err.meta.target) ra client
      return res.status(409).json({
        success: false,
        message: "Dữ liệu đã tồn tại",
      });
    }
    if (err.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy dữ liệu" });
    }
    const mapped = PRISMA_CLIENT_MESSAGES[err.code];
    if (mapped) {
      return res.status(mapped.status).json({
        success: false,
        message: mapped.message,
      });
    }
    // Code chưa biết: vẫn trả message cố định, không rò err.message
    return res.status(500).json({
      success: false,
      message: "Lỗi cơ sở dữ liệu",
    });
  }

  // Prisma client validation / unknown / init / rust panic — message luôn chứa
  // tên model, tên field và chữ ký input type. Không bao giờ trả ra client.
  if (
    err instanceof Prisma.PrismaClientValidationError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return res.status(500).json({
      success: false,
      message: "Lỗi xử lý yêu cầu",
    });
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
    // Chặn rò thông tin nội bộ: nếu message trông như do Prisma sinh ra thì thay
    // bằng thông điệp chung, kể cả khi lỗi đã bị đóng gói lại (không instanceof).
    const message =
      status < 500 && !looksLikePrismaMessage(err.message)
        ? err.message
        : status < 500
          ? "Dữ liệu không hợp lệ"
          : "Lỗi máy chủ nội bộ";
    return res.status(status).json({
      success: false,
      message: message || "Lỗi máy chủ nội bộ",
    });
  }

  // Fallback
  res.status(500).json({ success: false, message: "Lỗi máy chủ nội bộ" });
};

module.exports = errorHandler;
