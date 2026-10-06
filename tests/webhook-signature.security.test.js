/**
 * tests/webhook-signature.security.test.js — H3 + M8 regression
 *
 * Lỗi gốc (H3): xác thực webhook thanh toán kiểu `if (!secret && NODE_ENV !== 'production') return true`.
 * Cổng quyết định là biến môi trường chứ không phải thực tế triển khai → staging /
 * preview / VPS chạy pm2 quên set NODE_ENV đều NHẬN webhook không chữ ký, tức là
 * ai cũng forge được payload đánh dấu đơn đã thanh toán và giải phóng hàng.
 *
 * Lỗi gốc (M8): so sánh HMAC bằng `===` rò timing từng byte.
 *
 * Yêu cầu mới: fail-closed. Nhận webhook unsigned chỉ khi dev bật tường minh
 * `ALLOW_UNSIGNED_WEBHOOKS=true`, và cờ đó bị vô hiệu hoàn toàn ở production.
 */
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const crypto = require("crypto");
const {
  safeEqual,
  unsignedWebhooksAllowed,
  webhookConfigured,
  verifyHmacWebhook,
  verifyBearerWebhook,
} = require("../src/utils/webhookSignature");

const ENV_KEYS = ["NODE_ENV", "ALLOW_UNSIGNED_WEBHOOKS", "CASSO_WEBHOOK_SECRET"];
const saved = {};

beforeEach(() => {
  ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; });
  delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
  delete process.env.CASSO_WEBHOOK_SECRET;
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

describe("H3 — thiếu secret thì TỪ CHỐI, không phụ thuộc NODE_ENV", () => {
  test.each(["test", "development", "staging", "production"])(
    "NODE_ENV=%s + secret rỗng → webhook bị từ chối",
    (env) => {
      process.env.NODE_ENV = env;
      expect(webhookConfigured("Casso", "")).toBe(false);
      expect(
        verifyHmacWebhook({ provider: "Casso", secret: "", rawBody: "{}", signature: "x" }),
      ).toBe(false);
    },
  );

  test("verifyBearerWebhook cũng fail-closed khi token rỗng", () => {
    expect(verifyBearerWebhook({ provider: "SePay", token: "", provided: "" })).toBe(false);
  });

  test("cờ ALLOW_UNSIGNED_WEBHOOKS bị VÔ HIỆU khi NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "true";
    expect(unsignedWebhooksAllowed()).toBe(false);
    expect(webhookConfigured("Casso", "")).toBe(false);
  });

  test("dev bật tường minh ALLOW_UNSIGNED_WEBHOOKS=true thì mới nhận", () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "true";
    expect(unsignedWebhooksAllowed()).toBe(true);
    expect(webhookConfigured("Casso", "")).toBe(true);
  });

  test("giá trị cờ sai (1/yes/TRUE bị strict) → vẫn fail-closed", () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "1";
    expect(unsignedWebhooksAllowed()).toBe(false);
    process.env.ALLOW_UNSIGNED_WEBHOOKS = "yes";
    expect(unsignedWebhooksAllowed()).toBe(false);
  });
});

describe("H3 — secret đã cấu hình thì verify thật", () => {
  const SECRET = "s3cr3t-casso";
  const RAW = JSON.stringify({ ReferenceCode: "HD-1", Amount: 100 });

  test("chữ ký đúng → nhận", () => {
    const sig = crypto.createHmac("sha256", SECRET).update(RAW).digest("hex");
    expect(
      verifyHmacWebhook({ provider: "Casso", secret: SECRET, rawBody: RAW, signature: sig }),
    ).toBe(true);
  });

  test("chữ ký sai → từ chối", () => {
    expect(
      verifyHmacWebhook({ provider: "Casso", secret: SECRET, rawBody: RAW, signature: "deadbeef" }),
    ).toBe(false);
  });

  test("thiếu chữ ký → từ chối", () => {
    expect(
      verifyHmacWebhook({ provider: "Casso", secret: SECRET, rawBody: RAW, signature: undefined }),
    ).toBe(false);
  });

  test("payload bị sửa một byte → từ chối (chống replay với payload khác)", () => {
    const sig = crypto.createHmac("sha256", SECRET).update(RAW).digest("hex");
    const tampered = RAW.replace('"Amount":100', '"Amount":1');
    expect(
      verifyHmacWebhook({ provider: "Casso", secret: SECRET, rawBody: tampered, signature: sig }),
    ).toBe(false);
  });

  test("bearer token đúng → nhận; sai → từ chối", () => {
    expect(verifyBearerWebhook({ provider: "SePay", token: "tok", provided: "tok" })).toBe(true);
    expect(verifyBearerWebhook({ provider: "SePay", token: "tok", provided: "other" })).toBe(false);
    expect(verifyBearerWebhook({ provider: "SePay", token: "tok", provided: undefined })).toBe(false);
  });
});

describe("M8 — so sánh constant-time, không rò timing", () => {
  test("safeEqual khớp/không khớp", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc", "abcdef")).toBe(false); // khác độ dài
    expect(safeEqual(null, "abc")).toBe(false);
    expect(safeEqual("abc", undefined)).toBe(false);
  });

  test("dùng timingSafeEqual bên trong (không so sánh bằng ===)", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");
    safeEqual("same", "same");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});