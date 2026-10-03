'use strict';

/**
 * scripts/check-llm-policy.js — In chế độ LLM + trạng thái key, KHÔNG in giá trị key
 *
 * Hiến pháp NIGHT-PROMPT §3: chỉ được kiểm tra **có hay không** biến môi trường,
 * không được đọc/in/ghi giá trị. Script này in `configured: true|false` và không
 * bao giờ in chuỗi key.
 *
 * Chạy: npm run llm:policy
 */
require('dotenv').config();
const llmPolicy = require('../src/config/llm-policy');

const d = llmPolicy.describe();
const keyPresent = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());

console.log('=== CHẾ ĐỘ LLM HIỆN TẠI ===');
console.log(`mode                : ${d.mode}`);
console.log(`LLM có dùng được    : ${d.enabled ? 'có' : 'KHÔNG (đường không-LLM)'}`);
console.log(`GEMINI_API_KEY      : ${keyPresent ? 'CÓ' : 'KHÔNG'}`);
console.log(`provider            : ${d.provider}`);
console.log(`model               : ${d.model}`);
console.log(`throttle (ms/lần)   : ${d.throttleMs}`);
console.log(`backoff hiện tại    : x${d.backoffFactor}`);
console.log(`bản ghi replay      : ${d.recordStore || '(không dùng ở chế độ này)'}`);
console.log('');
console.log('Gợi ý:');
if (!keyPresent) {
  console.log('  - Chưa có key ⇒ mọi vai trò LLM dùng MẪU. Đây là trạng thái ĐÚNG,');
  console.log('    luồng demo vẫn chạy trọn. Để đo thật, đặt key rồi chạy lại.');
  console.log('  - Lệnh đo duy nhất sau khi có key:  npm run llm:eval -- --mode live');
} else if (d.mode === 'off') {
  console.log('  - Đã có key nhưng mode=off. Để gọi thật: set LLM_MODE=record (lần đầu)');
  console.log('    rồi LLM_MODE=replay cho CI/demo. LLM_DISABLED=1 sẽ ép tắt mọi thứ.');
} else {
  console.log(`  - Đang ở mode=${d.mode}. Nhớ: dữ liệu phải là công khai/mô phỏng.`);
}