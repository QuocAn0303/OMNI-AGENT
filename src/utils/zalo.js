/**
 * utils/zalo.js — Gửi tin nhắn CSKH qua Zalo Official Account API
 * 
 * Tổng quan:
 * - Gửi tin nhắn text đến user Zalo qua API CSKH v3.0
 * - Yêu cầu ZALO_OA_ACCESS_TOKEN trong .env (lấy từ developers.zalo.me)
 * - Lưu ý: API CSKH chỉ gửi được trong 24h kể từ tương tác cuối của user với OA
 * - Ngoài 24h cần dùng ZNS (Zalo Notification Service) — template riêng
 * 
 * Hàm:
 * - sendZaloMessage({ userId, text }): Gửi tin nhắn Zalo đến user
 *     - Gọi POST đến https://openapi.zalo.me/v3.0/oa/message/cs
 *     - Throw lỗi nếu thiếu token hoặc API trả về error
 */

const ZALO_API_URL =
  process.env.ZALO_OA_API_URL ||
  "https://openapi.zalo.me/v3.0/oa/message/cs";

const sendZaloMessage = async ({ userId, text }) => {
  const token = process.env.ZALO_OA_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Thiếu ZALO_OA_ACCESS_TOKEN trong env");
  }
  if (!userId) throw new Error("Thiếu Zalo userId người nhận");

  const body = {
    recipient: { user_id: userId },
    message: { text },
  };

  const res = await fetch(ZALO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      access_token: token,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const errMsg = json.message || json.error_name || `HTTP ${res.status}`;
    throw new Error(`Zalo API: ${errMsg}`);
  }
  return json.data || json;
};

module.exports = { sendZaloMessage };
