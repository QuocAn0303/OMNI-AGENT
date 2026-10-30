/**
 * utils/webhookSignature.js — Xác thực chữ ký webhook của cổng thanh toán
 *
 * Vì sao file này tồn tại (H3 + M8):
 *
 * 1. FAIL-CLOSED. Trước đây mỗi adapter tự kiểm tra secret và khi secret rỗng thì
 *    `return true` nếu `NODE_ENV !== 'production'`. Cổng quyết định là biến môi
 *    trường chứ không phải thực tế triển khai — staging/preview/VPS chạy pm2 mà
 *    quên set NODE_ENV đều nhận webhook KHÔNG CHỮ KÝ, tức là ai cũng forge được
 *    payload đánh dấu đơn đã thanh toán (`markSuccess`) và giải phóng hàng.
 *    Nay: thiếu secret → từ chối. Muốn nhận webhook unsigned ở local thì phải
 *    bật tường minh `ALLOW_UNSIGNED_WEBHOOKS=true`, và cờ này bị vô hiệu hoàn toàn
 *    ở production.
 *
 * 2. CONSTANT-TIME. So sánh HMAC bằng `===` rò timing từng byte. `safeEqual` dùng
 *    `crypto.timingSafeEqual`, đồng thời so trước độ dài để không ném lỗi.
 *
 * 3. MỘT NGUỒN SỰ THẬT. `config/payos.js` đã fail-closed đúng cách (throw 503 khi
 *    thiếu cấu hình) — nay các adapter cùng dùng chung helper này để không lệch nhau.
 */

const crypto = require("crypto");
const logger = require("./logger");

/** So sánh chuỗi không rò timing (chống timing oracle trên HMAC/signature). */
function safeEqual(a, b) {
  if (a == null || b == null) return false;
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** HMAC-SHA256 hex, dùng cho header chữ ký kiểu Casso/SePay. */
function hmacSha256Hex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Webhook không chữ ký chỉ được phép ở local, và phải bật tường minh.
 * Luôn trả false ở production bất kể env có gì.
 */
function unsignedWebhooksAllowed() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ALLOW_UNSIGNED_WEBHOOKS === "true";
}

/**
 * Kiểm tra secret của webhook đã cấu hình chưa.
 * @param {string} provider - tên provider để log ("Casso", "MoMo", ...)
 * @param {string} secret - giá trị env
 * @returns {boolean} true nếu đã cấu hình (hoặc dev cố ý bật unsigned)
 */
function webhookConfigured(provider, secret) {
  if (secret) return true;
  if (unsignedWebhooksAllowed()) {
    logger.warn(
      `[webhook] ${provider}: CHƯA cấu hình secret nhưng ALLOW_UNSIGNED_WEBHOOKS=true — ` +
        `chấp nhận webhook không chữ ký (chỉ dev). KHÔNG bao giờ bật ở production.`,
    );
    return true;
  }
  logger.error(
    `[webhook] ${provider}: thiếu secret cấu hình → TỪ CHỐI webhook. ` +
      `Đặt secret của provider, hoặc bật ALLOW_UNSIGNED_WEBHOOKS=true khi chạy local.`,
  );
  return false;
}

/**
 * Xác thực chữ ký HMAC trên raw body.
 * @returns {boolean}
 */
function verifyHmacWebhook({ provider, secret, rawBody, signature }) {
  if (!webhookConfigured(provider, secret)) return false;
  if (!secret) return true; // dev đã bật unsigned
  if (!signature || rawBody == null) {
    logger.warn(`[webhook] ${provider}: thiếu chữ ký trong request`);
    return false;
  }
  return safeEqual(hmacSha256Hex(secret, rawBody), signature);
}

/**
 * Xác thực bearer token dạng `Authorization: Bearer <token>`.
 * @returns {boolean}
 */
function verifyBearerWebhook({ provider, token, provided }) {
  if (!webhookConfigured(provider, token)) return false;
  if (!token) return true; // dev đã bật unsigned
  if (!provided) {
    logger.warn(`[webhook] ${provider}: thiếu Authorization header`);
    return false;
  }
  return safeEqual(token, provided);
}

module.exports = {
  safeEqual,
  hmacSha256Hex,
  unsignedWebhooksAllowed,
  webhookConfigured,
  verifyHmacWebhook,
  verifyBearerWebhook,
};