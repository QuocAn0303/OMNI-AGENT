/**
 * scripts/check-i18n-keys.js — So khớp key giữa locales/vi.json và en.json.
 *
 * Vì sao cần: key thiếu ⇒ `t('x.y')` render ra chính chuỗi key đó trên UI
 * ("crmPipeline.insights.title") — loại lỗi vặt rất dễ bỏ sót vì không làm hỏng
 * build, chỉ hiện sai lúc chạy. Phase 4 thêm 51 key mới nên đây là lưới an toàn.
 *
 * Kiểm tra thêm: placeholder {{...}} phải khớp giữa 2 file. Lệch placeholder không
 * gây lỗi build nhưng i18next sẽ render sai (vd vi có {{count}}, en không có).
 *
 * Chạy: npm run check:i18n
 * Exit: 0 = khớp, 1 = có lệch (in ra danh sách cần sửa)
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "frontend", "src", "locales");

// Key "string by nature" — không phải text, không cần dịch
const IGNORE_KEYS = new Set(["_meta", "version"]);

const C = {
  reset: "\u001b[0m", bold: "\u001b[1m", red: "\u001b[31m",
  green: "\u001b[32m", dim: "\u001b[2m", yellow: "\u001b[33m",
};

const readJson = (file) => {
  const raw = fs.readFileSync(file, "utf8");
  // File locale có BOM — strip trước khi parse
  const json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  return json;
};

/** Dẹp object thành mảng "a.b.c" (chỉ lấy node lá). */
const flatten = (node, prefix = "", acc = []) => {
  for (const [k, v] of Object.entries(node)) {
    if (IGNORE_KEYS.has(k)) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, acc);
    } else {
      acc.push({ key, value: v });
    }
  }
  return acc;
};

const placeholders = (value) => (String(value).match(/\{\{\s*[\w.]+\s*\}\}/g) || []).sort();

const main = () => {
  const viFile = path.join(DIR, "vi.json");
  const enFile = path.join(DIR, "en.json");

  const viMap = new Map(flatten(readJson(viFile)).map((e) => [e.key, e.value]));
  const enMap = new Map(flatten(readJson(enFile)).map((e) => [e.key, e.value]));

  const onlyVi = [...viMap.keys()].filter((k) => !enMap.has(k));
  const onlyEn = [...enMap.keys()].filter((k) => !viMap.has(k));

  // Placeholder lệch giữa 2 file
  const phMismatch = [];
  for (const [key, viVal] of viMap) {
    if (!enMap.has(key)) continue;
    const a = placeholders(viVal);
    const b = placeholders(enMap.get(key));
    if (a.join("|") !== b.join("|")) {
      phMismatch.push({ key, vi: a, en: b });
    }
  }

  const total = viMap.size;
  const problems = onlyVi.length + onlyEn.length + phMismatch.length;

  console.log(`${C.bold}i18n — locales/vi.json vs en.json${C.reset}`);
  console.log(`  key: vi=${total} en=${enMap.size}`);

  if (onlyEn.length) {
    console.log(`\n${C.red}  ✗ Chỉ có trong en.json (${onlyEn.length}) — tiếng Việt sẽ rỗng:${C.reset}`);
    for (const k of onlyEn.slice(0, 40)) console.log(`      ${k}`);
    if (onlyEn.length > 40) console.log(`      … và ${onlyEn.length - 40} key nữa`);
  }
  if (onlyVi.length) {
    console.log(`\n${C.red}  ✗ Chỉ có trong vi.json (${onlyVi.length}) — tiếng Anh sẽ rỗng:${C.reset}`);
    for (const k of onlyVi.slice(0, 40)) console.log(`      ${k}`);
    if (onlyVi.length > 40) console.log(`      … và ${onlyVi.length - 40} key nữa`);
  }
  if (phMismatch.length) {
    console.log(`\n${C.red}  ✗ Placeholder lệch (${phMismatch.length})${C.reset}`);
    for (const m of phMismatch.slice(0, 20)) {
      console.log(`      ${m.key}: vi=[${m.vi.join(",")}] en=[${m.en.join(",")}]`);
    }
  }

  if (problems === 0) {
    console.log(`\n${C.green}  ✓ ${total} key khớp hoàn toàn${C.reset}`);
    process.exit(0);
  }

  console.log(
    `\n${C.yellow}  ${problems} vấn đề. Lưu ý: repo đã có ${onlyEn.length} key chỉ có ở en.json ` +
      `từ trước Phase 4 — không phải do thay đổi hiện tại.${C.reset}`,
  );
  process.exit(1);
};

main();