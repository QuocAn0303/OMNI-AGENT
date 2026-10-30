/**
 * scripts/check-swagger-yaml.js — Kiểm tra YAML trong khối chú thích `@swagger`
 *
 * VÌ SAO CẦN
 * Khối `@swagger` là YAML nằm trong JSDoc. `swagger-ui-express` **không báo lỗi**
 * khi một khối YAML hỏng: endpoint vẫn mở được, chỉ là path đó không hiện — tức
 * lỗi âm thầm, không ai thấy cho tới khi Ban Tổ chức mở `/api-docs` và hỏi
 * "endpoint này đâu mất rồi".
 *
 * Lỗi đã gặp (2026-10-03): 4 khối trong `analytics.routes.js`, `crm/dashboard`,
 * `crm/deals`, `crm/hierarchy` viết `description` không đặt trong nháy và chứa
 * `[]`, `+`, `{ }` ⇒ YAML flow-mapping không hợp lệ ⇒ cả khối rơi.
 *
 * CÁCH DÙNG
 *   node scripts/check-swagger-yaml.js              # tự quét src/
 *   node scripts/check-swagger-yaml.js a.js b.js   # chỉ các file đưa vào
 *
 * Exit 0 = mọi khối parse được; exit 1 = có khối hỏng (in file:dòng + path).
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const SRC = path.join(__dirname, "..", "src");

const listRouteFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};

const files = process.argv.length > 2 ? process.argv.slice(2) : listRouteFiles(SRC);

let bad = 0;
let total = 0;

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\*\s*@swagger\b/.test(lines[i])) continue;
    const start = i;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      // Dừng ở `*/` hoặc khi hết khối chú thích.
      if (!/^\s*\*/.test(lines[j]) || /^\s*\*\/\s*$/.test(lines[j])) break;
      body.push(lines[j].replace(/^\s*\*\s?/, ""));
    }
    i = j - 1;
    total += 1;
    const head = body.map((l) => l.trim()).filter(Boolean)[0] || "?";
    try {
      const doc = yaml.load(body.join("\n"));
      if (!doc || typeof doc !== "object") throw new Error("khong phai object");
    } catch (e) {
      bad += 1;
      console.log(
        `YAML_LO ${path.relative(process.cwd(), file)}:${start + 1}  ${head}  -> ${String(e.message).split("\n")[0]}`,
      );
    }
  }
}

console.log(`${bad === 0 ? "OK  " : "FAIL"} | ${total - bad}/${total} khoi @swagger parse duoc tren ${files.length} file.`);
process.exit(bad === 0 ? 0 : 1);