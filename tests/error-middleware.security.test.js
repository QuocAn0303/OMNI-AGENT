/**
 * tests/error-middleware.security.test.js — M5 regression
 *
 * Lỗi gốc: `error.middleware` chỉ xử lý P2002/P2025. Mọi code Prisma khác và
 * `PrismaClientValidationError` rơi xuống nhánh "plain object error" và trả nguyên
 * `err.message` ra client, lộ:
 *   P2010/P2011 → TOÀN BỘ câu SQL đã gửi tới Postgres
 *   P2000/P2003 → tên bảng/cột và ràng buộc khoá ngoại
 *   Validation  → tên model, tên field, chữ ký input type của Prisma client
 */
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { Prisma } = require("@prisma/client");
const errorHandler = require("../src/middleware/error.middleware");

const run = (err) => {
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  errorHandler(err, { headers: {} }, res, () => {});
  return res;
};

const LEAKY = [
  "Invalid `prisma.product.upsert()` invocation: { data: { email: \"x\" } }",
  "Argument where of type ProductWhereUniqueInput needs at least one of id arguments",
  "Unknown argument `foo`",
  "Foreign key constraint violated on the constraint: `products_categoryId_fkey`",
  "constraint failed on the database: `products_sku_key`",
];

describe("M5 — không rò chi tiết lỗi Prisma ra client", () => {
  test.each(["P2000", "P2003", "P2010", "P2011", "P2014", "P2034"])(
    "Prisma %s → thông điệp cố định, không kèm chi tiết",
    (code) => {
      const err = new Prisma.PrismaClientKnownRequestError("raw internal detail here", {
        code,
        clientVersion: "7.0.0",
      });
      const res = run(err);
      expect(res.body.message).toBeTruthy();
      expect(res.body.message).not.toContain("raw internal detail");
      expect(res.body.details).toBeUndefined();
    },
  );

  test("P2010/P2011 (raw SQL) không trả SQL ra client", () => {
    const sql = 'SELECT * FROM "users" WHERE email = \'a@b.com\' AND "tenantId" = $1';
    const err = new Prisma.PrismaClientKnownRequestError(
      `Invalid \`prisma.$queryRaw\` invocation: ${sql}`,
      { code: "P2010", clientVersion: "7.0.0" },
    );
    const res = run(err);
    expect(res.body.message).not.toContain("SELECT");
    expect(res.body.message).not.toContain("tenantId");
  });

  test("PrismaClientValidationError → 500 thông điệp chung", () => {
    const err = new Prisma.PrismaClientValidationError(
      "Invalid `prisma.user.create()` invocation: Argument data of type UserCreateInput needs name",
      { clientVersion: "7.0.0" },
    );
    const res = run(err);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe("Lỗi xử lý yêu cầu");
  });

  test("P2002 vẫn trả 409 như trước (không phá hợp đồng hiện có)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "7.0.0",
      meta: { target: ["products", "sku", "tenantId"] },
    });
    const res = run(err);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Dữ liệu đã tồn tại");
    expect(JSON.stringify(res.body)).not.toContain("products");
  });

  test("P2025 vẫn trả 404", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Not found", {
      code: "P2025", clientVersion: "7.0.0",
    });
    expect(run(err).statusCode).toBe(404);
  });
});

describe("M5 — chặn cả lỗi đã đóng gói lại (không instanceof)", () => {
  test.each(LEAKY)("plain object 4xx chứa %s → thay bằng thông điệp chung", (msg) => {
    const res = run({ status: 400, message: msg });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).not.toBe(msg);
    expect(res.body.message).toBe("Dữ liệu không hợp lệ");
  });

  test("plain object KHÔNG có status + message rò → 500 thông điệp chung", () => {
    const res = run({ message: "Invalid `prisma.x.findMany()` invocation" });
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe("Lỗi máy chủ nội bộ");
  });

  test("details không được pass-through ở nhánh plain object", () => {
    const res = run({ status: 400, message: "Lỗi", details: { sql: "SELECT 1" } });
    expect(res.body.details).toBeUndefined();
  });
});

describe("M5 — KHÔNG phá hành vi sử dụng lệnh của dự án", () => {
  test("throw { status, message } bình thường vẫn trả nguyên message", () => {
    const res = run({ status: 400, message: "Thiếu tenantId" });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Thiếu tenantId");
  });

  test("thông điệp tiếng Việt bình thường không bị chặn nhầm", () => {
    const res = run({ status: 403, message: "Không thể tự thay đổi vai trò của mình" });
    expect(res.body.message).toBe("Không thể tự thay đổi vai trò của mình");
  });

  test("lỗi 5xx không bao giờ trả message gốc", () => {
    const res = run({ status: 503, message: "DB connection pool exhausted at 10.0.3.4:5432" });
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toBe("Lỗi máy chủ nội bộ");
  });

  test("ApiError vẫn giữ status + message + details", () => {
    const ApiError = require("../src/utils/apiError");
    const res = run(new ApiError(422, "Sai định dạng", { field: "email" }));
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toBe("Sai định dạng");
    expect(res.body.details).toEqual({ field: "email" });
  });

  test("lỗi không phải object → fallback 500", () => {
    const res = run("boom");
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe("Lỗi máy chủ nội bộ");
  });
});