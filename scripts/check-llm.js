/**
 * scripts/check-llm.js — Kiểm tra kết nối LLM cloud (không cần DB)
 *
 * Dùng: node scripts/check-llm.js
 * In: provider đang cấu hình, model có nằm trong danh sách của provider không,
 * và một lệnh gọi thật để chắc chắn key + model + mạng đều OK.
 *
 * Gợi ý: script ép IPv4 vì máy dev không có IPv6 default route (xem src/config/llm.js).
 */
require("dotenv").config();
const llm = require("../src/config/llm");

(async () => {
  const info = llm.describe();
  console.log("=== CẤU HÌNH ===");
  console.log(`provider   : ${info.provider}`);
  console.log(`model      : ${info.model}`);
  console.log(`baseUrl    : ${info.baseUrl}`);
  console.log(`configured : ${info.configured}`);

  if (!info.configured) {
    console.log("\n✗ Chưa cấu hình LLM cloud. Thêm vào .env:");
    console.log("  LLM_PROVIDER=gemini");
    console.log("  GEMINI_API_KEY=<key>");
    console.log("  LLM_MODEL=gemini-3.8-flash");
    process.exit(1);
  }

  console.log("\n=== DANH SÁCH MODEL (provider trả về) ===");
  let models = [];
  try {
    models = await llm.listModels();
    console.log(`tổng cộng: ${models.length} model`);
    const flash = models.filter((m) => m.includes("flash")).slice(0, 10);
    console.log("một vài model 'flash': " + flash.join(", "));
    if (models.includes(info.model)) {
      console.log(`✓ LLM_MODEL=${info.model} có trong danh sách`);
    } else {
      console.log(`✗ LLM_MODEL=${info.model} KHÔNG có trong danh sách — sửa LLM_MODEL trong .env`);
    }
  } catch (e) {
    console.log(`✗ Không lấy được danh sách model: ${e.message}`);
  }

  console.log("\n=== GỌI THẬT 1 LẦN ===");
  try {
    const text = await llm.generateText({ prompt: "Trả lời đúng 1 từ: ERP của Aduu dùng để làm gì?" });
    console.log("✓ Phản hồi: " + String(text).replace(/\s+/g, " ").slice(0, 220));
  } catch (e) {
    console.log(`✗ Gọi thất bại: ${e.message}`);
    process.exit(1);
  }
})();
