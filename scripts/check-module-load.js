/**
 * scripts/check-module-load.js — kiểm tra app có boot được không (không cần DB)
 *
 * Bug thật đã xảy ra (commit ee6d6c0): src/modules/orders/invoice.service.js đặt
 * `module.exports = { ..., list }` TRƯỚC `const list = async ...` → ReferenceError (TDZ)
 * lúc require → `npm run dev` chết trước khi lên cổng, trong khi unit test khác vẫn xanh.
 *
 * Script này require TẤT CẢ *.service.js và *.routes.js dưới src/modules (đúng đường đi
 * của src/app.js khi boot) và báo lỗi khi:
 *   - require ném lỗi (thứ tự khai báo sai, circular require, syntax error)
 *   - module.exports rỗng, hoặc có key giá trị undefined
 *
 * Chạy bằng Node thật (KHÔNG chạy trong Jest): một số dep là ESM-only (otplib v13) —
 * Node >=22.12 `require()` được ESM, còn Jest 29 thì không → chạy trong Jest sẽ báo
 * sai (false positive) rằng app không boot được.
 *
 * Dùng: node scripts/check-module-load.js
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MODULES_DIR = path.join(ROOT, "src", "modules");

const collect = (dir, suffix) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full, suffix);
    return entry.name.endsWith(suffix) ? [full] : [];
  });

const files = [
  ...collect(MODULES_DIR, ".service.js"),
  ...collect(MODULES_DIR, ".routes.js"),
];

const failures = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  try {
    const mod = require(file);
    if (!mod || (typeof mod !== "object" && typeof mod !== "function")) {
      failures.push(`${rel} → export không hợp lệ (${typeof mod})`);
      continue;
    }
    if (typeof mod === "function") continue;
    const keys = Object.keys(mod);
    if (keys.length === 0) {
      failures.push(`${rel} → module.exports rỗng`);
      continue;
    }
    const undefinedKeys = keys.filter((k) => mod[k] === undefined);
    if (undefinedKeys.length) {
      failures.push(`${rel} → export undefined: ${undefinedKeys.join(", ")} (thường do export trước khi khai báo)`);
    }
  } catch (e) {
    failures.push(`${rel} → ${e.constructor.name}: ${String(e.message).split("\n")[0]}`);
  }
}

const rel = (p) => path.relative(ROOT, p);
console.log(`Đã kiểm tra ${files.length} module trong ${rel(MODULES_DIR)}`);

if (failures.length) {
  console.error(`\n${failures.length} module KHÔNG load được:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log("✓ Tất cả module load được, không có export undefined");

// spot-check: file từng gây lỗi TDZ
const invoiceService = require(path.join(ROOT, "src", "modules", "orders", "invoice.service"));
for (const fn of ["generateInvoice", "generateInvoicePDF", "getById", "sendEmail", "list"]) {
  if (typeof invoiceService[fn] !== "function") {
    console.error(`  ✗ orders/invoice.service.js thiếu hàm ${fn}`);
    process.exit(1);
  }
}
console.log("✓ orders/invoice.service.js export đủ hàm (gồm list)");
