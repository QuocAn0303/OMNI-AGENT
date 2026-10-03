'use strict';

/**
 * T6 — tải dataset công khai đã chọn + kiểm sha256.
 *
 * Dataset: UCI "Online Retail II" (uci_id = 502)
 *   Nguồn chính thức: https://archive.ics.uci.edu/dataset/502/online+retail+ii
 *   Tệp         : https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip
 *   Giấy phép   : CC BY 4.0 (đã đọc, xem docs/aisc26/02-data.md)
 *
 * Nguyên tắc:
 *   - KHÔNG tự sửa sha256 mong muốn. Lệch ⇒ dừng, không ghi tiếp.
 *   - Idempotent: tệp đã có + sha256 khớp ⇒ bỏ qua tải.
 *   - Chỉ ghi trong data/dataset/ (đã .gitignore), không commit tệp dữ liệu.
 *
 * Dùng: node scripts/dataset/fetch-online-retail-ii.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const URL = 'https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip';
const EXPECTED_SHA256 = '572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb';
const EXPECTED_MIN_BYTES = 40 * 1024 * 1024;

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'data', 'dataset', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'online_retail_ii.zip');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);
    const req = https.get(url, { headers: { 'User-Agent': 'aisc26-dataset-fetch/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        out.close();
        fs.unlinkSync(tmp);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (e) { void e; }
        return reject(new Error(`HTTP ${res.statusCode} cho ${url}`));
      }
      res.pipe(out);
      out.on('finish', () => out.close(() => fs.renameSync(tmp, dest) && resolve()));
      out.on('error', reject);
    });
    req.on('error', (e) => {
      try { fs.unlinkSync(tmp); } catch (err) { void err; }
      reject(e);
    });
    req.setTimeout(120000, () => req.destroy(new Error('timeout 120s')));
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let reused = false;
  if (fs.existsSync(OUT_FILE)) {
    const sha = await sha256File(OUT_FILE);
    reused = sha === EXPECTED_SHA256;
    console.log(`[fetch] tệp đã có: ${(fs.statSync(OUT_FILE).size / 1048576).toFixed(2)} MB, sha256=${sha}`);
    if (reused) console.log('[fetch] sha256 khớp ⇒ bỏ qua tải (idempotent).');
  }

  if (!reused) {
    console.log(`[fetch] đang tải ${URL}`);
    await download(URL, OUT_FILE);
    console.log(`[fetch] tải xong: ${(fs.statSync(OUT_FILE).size / 1048576).toFixed(2)} MB`);
  }

  const size = fs.statSync(OUT_FILE).size;
  const sha = await sha256File(OUT_FILE);

  console.log(`[fetch] sha256      = ${sha}`);
  console.log(`[fetch] bytes       = ${size}`);

  if (sha !== EXPECTED_SHA256) {
    console.error(`[fetch] KHÔNG KHỚP sha256 mong muốn ${EXPECTED_SHA256}`);
    console.error('[fetch] DỪNG. Không tự sửa giá trị mong muốn — cần người ký.');
    process.exit(1);
  }
  if (size < EXPECTED_MIN_BYTES) {
    console.error(`[fetch] TỆP NHỎ HƠN KỲ VỌNG (< ${EXPECTED_MIN_BYTES} bytes) — có thể tải thiếu. DỪNG.`);
    process.exit(1);
  }

  console.log('[fetch] OK — dataset sẵn sàng. Bước kế: node scripts/dataset/build-daily-sku.js');
}

main().catch((e) => {
  console.error(`[fetch] LỖI: ${e.message}`);
  process.exit(1);
});