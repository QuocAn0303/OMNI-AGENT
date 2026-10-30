'use strict';

/**
 * T9 (phần dữ liệu phụ) — trích TÊN hàng từ tệp gốc cho 500 SKU đã chọn.
 *
 * Vì sao cần: `build-daily-sku.js` CỐ Ý bỏ cột `Description` (văn bản tự do)
 * khỏi bảng đầu ra. Nhưng T9 yêu cầu "khớp SKU baseline không-LLM (trigram /
 * Levenshtein / TF-IDF)" — mà không có tên hàng thì không có gì để khớp.
 * Vì vậy tách riêng một tệp tên, KHÔNG sửa `build-daily-sku.js` (sửa nó sẽ đổi
 * sha256 của `daily_sku.csv` đã ghi trong `02-data.md` §1).
 *
 * Nguồn   : data/dataset/raw/online_retail_II.xlsx (đọc 1 sheet, không lọc L3/L4
 *           vì tập SKU đã chốt ở daily_sku.csv)
 * Đầu ra : data/dataset/sku_names.csv   (UTF-8: sku,name)
 *
 * Quy tắc lấy tên (CHỐT TRƯỚC khi xem kết quả):
 *   N1 áp dụng đúng L1/L2 của `build-daily-sku.js` để tên lấy từ tập dòng cùng
 *      bộ lọc với bảng SKU×ngày;
 *   N2 với mỗi SKU chọn Description xuất hiện NHIỀU NHẤT (mode);
 *   N3 hoà số lần ⇒ chọn chuỗi BẢNG CHỮ CÁI tăng dần (tất định);
 *   N4 chuỗi rỗng / dài > 120 ký tự / chứa ký tự điều khiển ⇒ loại, không đo đếm;
 *   N5 SKU không còn tên ⇒ ghi `Mã hàng <sku>` và BÁO CAO số lượng (không bịa tên).
 *
 * Dùng: node scripts/dataset/build-sku-names.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_XLSX = path.join(ROOT, 'data', 'dataset', 'raw', 'online_retail_II.xlsx');
const OUT_DIR = path.join(ROOT, 'data', 'dataset');
const DAILY_CSV = path.join(OUT_DIR, 'daily_sku.csv');
const OUT_CSV = path.join(OUT_DIR, 'sku_names.csv');

const SKU_CODE = /^\d{5,7}[A-Z]*$/;
const C_INVOICE = 'invoice';
const C_SKU = 'stockcode';
const C_QTY = 'quantity';
const C_PRICE = 'price';
const C_DESC = 'description';
const MAX_NAME_LEN = 120;

const clean = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);

const usable = (s) => s.length > 0 && s.length <= MAX_NAME_LEN;

async function main() {
  if (!fs.existsSync(RAW_XLSX)) {
    console.error('[names] THIẾU tệp thô: ' + RAW_XLSX);
    process.exit(1);
  }
  if (!fs.existsSync(DAILY_CSV)) {
    console.error('[names] THIẾU daily_sku.csv — chạy node scripts/dataset/build-daily-sku.js trước');
    process.exit(1);
  }

  const chosen = new Set(
    fs
      .readFileSync(DAILY_CSV, 'utf8')
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((l) => l.split(',')[1])
      .filter(Boolean),
  );
  console.log(`[names] SKU đã chọn (từ daily_sku.csv): ${chosen.size}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RAW_XLSX, { sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore' });

  const freq = new Map(); // sku -> Map(name -> count)
  for (const ws of wb.worksheets) {
    let header = null;
    let col = null;
    ws.eachRow((row) => {
      if (!header) {
        header = [];
        row.eachCell({ includeEmpty: true }, (cell, c) => { header[c] = String(cell.text ?? '').trim(); });
        col = {};
        header.forEach((h, i) => {
          const k = h.toLowerCase().replace(/[^a-z]/g, '');
          if ([C_INVOICE, C_SKU, C_QTY, C_PRICE, C_DESC].includes(k)) col[k] = i;
        });
        for (const k of [C_INVOICE, C_SKU, C_QTY, C_PRICE, C_DESC]) {
          if (col[k] === undefined) {
            console.error(`[names] sheet ${ws.name}: THIẾU cột ${k} — header=${header.join('|')}`);
            process.exit(1);
          }
        }
        return;
      }
      const invoice = String(row.getCell(col[C_INVOICE]).text ?? '').trim();
      const sku = String(row.getCell(col[C_SKU]).text ?? '').trim().toUpperCase();
      const qty = Number(row.getCell(col[C_QTY]).value);
      const price = Number(row.getCell(col[C_PRICE]).value);
      if (!chosen.has(sku)) return;
      // N1 — cùng bộ lọc L1/L2 với bảng SKU×ngày
      if (invoice.toUpperCase().startsWith('C')) return;
      if (!(qty > 0) || !(price > 0)) return;
      if (!SKU_CODE.test(sku)) return;
      const name = clean(row.getCell(col[C_DESC]).text);
      if (!usable(name)) return;
      if (!freq.has(sku)) freq.set(sku, new Map());
      const m = freq.get(sku);
      m.set(name, (m.get(name) ?? 0) + 1);
    });
  }

  const rows = [];
  let fallback = 0;
  let multiName = 0;
  for (const sku of [...chosen].sort()) {
    const m = freq.get(sku);
    let name = null;
    if (m && m.size) {
      // N3 — mode, hoà thì chuỗi bảng chữ cái tăng dần
      const sorted = [...m.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
      name = sorted[0][0];
      if (m.size > 1) multiName += 1;
    }
    if (!name) { name = `Mã hàng ${sku}`; fallback += 1; }
    rows.push(`${sku},"${name.replace(/"/g, '""')}"`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const body = ['sku,name', ...rows].join('\n') + '\n';
  fs.writeFileSync(OUT_CSV, body, 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(OUT_CSV)).digest('hex');

  console.log(`[names] ghi ${rows.length} dòng → ${path.relative(ROOT, OUT_CSV)}`);
  console.log(`[names] sha256 ${sha}`);
  console.log(`[names] tên rút từ mode; SKU nhiều tên khác nhau: ${multiName}; SKU phải dùng tên dự phòng: ${fallback}`);
}

main().catch((e) => {
  console.error(`[names] LỖI: ${e.stack || e.message}`);
  process.exit(1);
});