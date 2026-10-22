'use strict';

/**
 * scripts/llm/build-label-set.js — Tạo PHIẾU GÁN NHÃN khớp SKU cho đội lành
 *
 * ============================================================================
 * VÌ SAO SCRIPT NÀY TỰ KHÔNG ĐIỀN NHÃN
 * ============================================================================
 * `03-evaluation-protocol.md` §9 (S10) yêu cầu bộ nhãn do **2 người gán độc lập,
 * mù với kết quả mô hình**, và `NIGHT-PROMPT.md` T14 cấm dùng **nhãn do LLM sinh**.
 * Script này do người viết, không phải LLM — nhưng người viết cũng KHÔNG phải người
 * gán nhãn chuẩn. Nên nó:
 *   - CHỈ chọn cặp (tên sản phẩm ↔ danh mục ERP) và xuất ứng viên;
 *   - ĐỂ TRỐNG cột `label_sku` và `label_note`;
 *   - KHÔNG suy ra đáp án từ `.truth.csv` dù tệp đó có sẵn trên đĩa.
 *
 * Cách làm đúng: cột đáp án nằm ở `data/aisc26/skus/labels/<...>.hidden.csv`, gitignore,
 * chỉ mở khi cần đối chiếu. Người gán chỉ thấy `label-sheet.csv`.
 *
 * ============================================================================
 * NGUỒN DỮ LIỆU
 * ============================================================================
 * Cặp lấy từ `data/dataset/marketplace/*.csv` (TỆP XUẤT ĐƠN MÔ PHỎNG theo định
 * dạng họ Shopee — nhãn **MÔ PHỎNG**, xem `notes/marketplace-format.md`) và danh mục
 * `data/dataset/sku_names.csv`. Chọn dòng có `SKU Reference No.` TRỐNG (20% dòng cố ý
 * mất mã) ⇒ bắt buộc phải khớp bằng TÊN, đúng ca mơ hồ mà vai trò LLM #1 nhằm.
 *
 * CHẠY: `npm run llm:labels -- --out data/aisc26/skus/labels`
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { assertLocalDb } = require('../lib/assert-local-db');
const { readCsvObjects, toCsv } = require('../lib/csv');
const ROOT = path.resolve(__dirname, '..', '..');
const { SkuMatcher } = require(`${ROOT}/src/modules/import/sku-matcher`);

const DATA_DIR = path.join(ROOT, 'data', 'dataset');
const MKT_DIR = path.join(DATA_DIR, 'marketplace');
const CATALOG_CSV = path.join(DATA_DIR, 'sku_names.csv');
const TARGET_PAIRS = 120; // ≥ 100 theo S10; dư để lọc bỏ cặp không rõ ràng

const parseArgs = () => {
  const outIdx = process.argv.indexOf('--out');
  return {
    outDir: outIdx >= 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(ROOT, 'data', 'aisc26', 'skus', 'labels'),
    target: TARGET_PAIRS,
  };
};

/** Đọc CSV bằng bộ đọc chuẩn trong `scripts/lib/csv.js` — tên hàng có dấu phẩy
 * và dấu nháy kép, `split(',')` sẽ cắt cụt tên và làm hỏng KHOẚP SKU âm thầm. */
const readCsv = (file) => readCsvObjects(fs.readFileSync(file, 'utf8'));

/** Xáo trộn 1–5 ứng viên bằng seed ổn định (FNV-1a trên `pair_id`). */
function shuffleFixed(arr, seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ghi CSV an toàn cho tiếng Việt (BOM để Excel mở đúng dấu). */
const writeCsv = (file, header, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toCsv(header, rows), 'utf8');
  return rows.length;
};

const main = () => {
  assertLocalDb('build-label-set chỉ đọc tệp — vẫn kiểm tra DATABASE_URL cho an toàn');
  const { outDir, target } = parseArgs();

  const catalog = readCsv(CATALOG_CSV).map((r) => ({ sku: r.sku, name: r.name }));
  const matcher = new SkuMatcher(catalog);

  const orderFiles = fs.existsSync(MKT_DIR)
    ? fs.readdirSync(MKT_DIR).filter((f) => /^orders_.*\.csv$/.test(f) && !f.includes('.truth.'))
    : [];
  if (!orderFiles.length) throw new Error(`khong tim thay tep xuat don trong ${MKT_DIR}`);

  // Gom theo tên sản phẩm để không lặp 120 lần cùng một tên; ưu tiên dòng mất mã.
  const byName = new Map();
  for (const f of orderFiles) {
    const nameKey = f.replace(/\.csv$/, '');
    // Đáp án MÔ PHỎNG lấy từ tệp .truth.csv do chính bộ sinh tạo ra. Tệp này
    // TUYỆT ĐỐI KHÔNG được đưa vào tờ phiếu gán nhãn — chỉ dùng để đối chiếu SAU
    // khi người gán xong (và khi đó số đo mang nhãn MÔ PHỎNG, không phải thực tế).
    const truthFile = path.join(MKT_DIR, `${nameKey}.truth.csv`);
    const truthByOrder = fs.existsSync(truthFile)
      ? new Map(readCsv(truthFile).map((r) => [`${r.order_id}|${r.noise_mode}`, r.sku]))
      : new Map();
    const truthByOrderId = fs.existsSync(truthFile)
      ? new Map(readCsv(truthFile).map((r) => [r.order_id, r.sku]))
      : new Map();
    for (const row of readCsv(path.join(MKT_DIR, f))) {
      const name = row['Product Name'];
      if (!name) continue;
      const hidden = !row['SKU Reference No.'];
      const prev = byName.get(name);
      if (prev && !(hidden && !prev.hidden)) continue;
      byName.set(name, {
        name,
        hidden,
        orderId: row['Order ID'],
        // Tra cứu chậm: nhiều dòng cùng tên ⇒ phải ghép theo CẢ orderId lẫn noise_mode
        // để không gán nhầm sku của dòng khác.
        skuSim: truthByOrder.get(`${row['Order ID']}|${row['Variation Name']}`) || truthByOrderId.get(row['Order ID']) || '',
      });
    }
  }

  const pool = [...byName.values()]
    .filter((p) => p.hidden) // chỉ dòng mất mã: ca mơ hồ đúng nghĩa
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  if (pool.length < target) {
    logger_stub(`CANH BAO: chi co ${pool.length} cap mat ma, can ${target}`);
  }

  const sheetRows = [];
  const hiddenRows = [];
  let i = 0;
  for (const p of pool) {
    if (sheetRows.length >= target) break;
    const cands = matcher.candidatesFor(p.name, { topK: 5 });
    if (!cands.length) continue;
i += 1;
    const id = `SKU-${String(i).padStart(3, '0')}`;
    // Xáo thứ tự ứng viên theo seed CỐ ĐỊNH: nếu giữ đúng thứ hạng của fuzzy thì
    // người gán bị "mồi" vào cột 1 — nhãn tay phải mù với kết quả mô hình (S10).
    // Seed cố định ⇒ chạy lại ra CÙNG một tờ phiếu (tái lập được).
    const shuffled = shuffleFixed(cands.slice(0, 5), id);
    const pad = (k) => [shuffled[k]?.sku || '', shuffled[k]?.name || ''];
    const row = [id, p.name];
    for (let k = 0; k < 5; k += 1) row.push(...pad(k));
    row.push(
      '', // label_sku           — ĐỂ TRỐNG, người gán điền
      '', // label_confidence    — ĐỂ TRỐNG (cao / trung bình / thấp)
      '', // label_note          — ĐỂ TRỐNG
      '', // labeler_a           — ĐỂ TRỐNG
      '', // labeler_b           — ĐỂ TRỐNG
    );
    sheetRows.push(row);
    // Ứng viên thật nằm ở cột 4..13; các cột trên để trống để không gợi ý thứ hạng.
    hiddenRows.push([id, p.name, p.skuSim, p.hidden ? 1 : 0]);
  }

  const header = [
    'pair_id', 'external_name',
    'cand1_sku', 'cand1_name', 'cand2_sku', 'cand2_name', 'cand3_sku', 'cand3_name',
    'cand4_sku', 'cand4_name', 'cand5_sku', 'cand5_name',
    'label_sku', 'label_confidence', 'label_note', 'labeler_a', 'labeler_b',
  ];

  const sheetFile = path.join(outDir, 'label-sheet.csv');
  const n = writeCsv(sheetFile, header, sheetRows);

  // Đáp án (để đối chiếu SAU khi gán xong). KHÔNG dùng làm nhãn để chấm điểm —
  // xem hướng dẫn: nếu đáp án chính là dữ liệu sinh tự động thì số đo là số trên
  // dữ liệu MÔ PHỎNG, ghi nhãn đó cạnh mọi con số.
  writeCsv(path.join(outDir, 'truth.simulated.csv'), ['pair_id', 'external_name', 'sku', 'sku_hidden'], hiddenRows);

  console.log(`[labels] da tao ${n} cap cho gan nhan -> ${path.relative(ROOT, sheetFile)}`);
  console.log(`[labels] cot label_sku / label_confidence / labeler_a / labeler_b DE TRONG nhat dinh.`);
  console.log('[labels] dap an MO PHONG: truth.simulated.csv — dung de doi chieu, KHONG dung cham diem nhu nhan that.');
  console.log('[labels] huong dan: docs/aisc26/notes/sku-labeling-guide.md');
  process.exit(0);
};

const logger_stub = (msg) => console.log(`[labels] ${msg}`);

main();