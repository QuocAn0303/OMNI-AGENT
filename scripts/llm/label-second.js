/**
 * scripts/llm/label-second.js — chuẩn bị và nạp nhãn cho NGƯỜI GÁN THỨ HAI.
 *
 * ============================================================================
 * VÌ SAO CÓ (2026-10-15)
 * ============================================================================
 * Sheet `label-sheet.csv` chỉ có MỘT cột trả lời (`label_sku`), còn `labeler_a` /
 * `labeler_b` chỉ lưu TÊN người gán. Hai người không thể gán độc lập trong sheet
 * đó — người thứ hai sẽ ghi đè đúng cột của người thứ nhất.
 *
 * Hậu quả đo được: Cohen's κ bị tính SAI ngay từ đầu. `eval-sku-match.js` gọi
 * `cohensKappa(pairs.map(p => p.labeler_a), pairs.map(p => p.labeler_b))` — so
 * **TÊN** hai người chứ không phải câu trả lời. Khác tên ⇒ κ = 0 luôn; cùng tên ⇒
 * κ = 1 luôn. Con số không mang thông tin gì về độ tin cậy nhãn.
 *
 * Script này:
 *   --migrate   thêm cột trả lời riêng cho mỗi người, chuyển nhãn sẵn có sang
 *   --export    xuất bản MÙ cho người thứ hai (KHÔNG kèm nhãn của người thứ nhất)
 *   --load      nạp cột trả lời của người thứ hai vào sheet chính
 *
 * ============================================================================
 * NGUYÊN TẮC PHƯƠNG PHÁP — KHÔNG ĐƯỢC PHÁM
 * ============================================================================
 * 1. `--export` KHÔNG bao giờ chứa `label_a_*` hay `label_sku`. Người thứ hai phải
 *    gán MÙ; nếu thấy câu trả lời của người thứ nhất thì họ chỉ việc chép, và κ
 *    luôn ≈ 1 — tức đo được cái không phải độ tin cậy nhãn.
 * 2. Script này KHÔNG tự điền nhãn cho người thứ hai. κ chỉ có ý nghĩa khi hai
 *    người là hai con người thật, gán độc lập. Điền hộ = bịa số đo.
 * 3. Cột `amb` đánh dấu ca BIÊN theo cấu trúc (tên ứng viên gần giống nhau, quá
 *    dài, nhiều số) — đánh dấu bằng cấu trúc, KHÔNG dựa vào nhãn người thứ nhất,
 *    nên vẫn giữ tính mù.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHEET = path.join(ROOT, 'data', 'aisc26', 'skus', 'labels', 'label-sheet.csv');
const OUT_B = path.join(ROOT, 'data', 'aisc26', 'skus', 'labels', 'label-sheet-B.csv');

const COLS = [
  'pair_id', 'external_name',
  'cand1_sku', 'cand1_name', 'cand2_sku', 'cand2_name', 'cand3_sku', 'cand3_name',
  'cand4_sku', 'cand4_name', 'cand5_sku', 'cand5_name',
  'label_sku', 'label_confidence', 'label_note', 'labeler_a', 'labeler_b',
  // Sửa 2026-10-15 — hai cột trả lời độc lập, mỗi người một cột.
  'label_a_sku', 'label_a_confidence', 'label_a_note', 'label_a_by', 'label_a_at',
  'label_b_sku', 'label_b_confidence', 'label_b_note', 'label_b_by', 'label_b_at',
];

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const parseCsv = (text) => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = splitRow(lines[0]);
  return { head, rows: lines.slice(1).map((l, i) => {
    const c = splitRow(l);
    const o = { __line: i + 2 };
    head.forEach((h, j) => { o[h] = c[j] ?? ''; });
    return o;
  }) };
};
/** Tách hàng CSV có nhánh kép — không dùng `split(',')` vì tên hàng có dấu phẩy. */
function splitRow(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const toCsv = (head, rows) => [head.map(esc).join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n';

/** Chuẩn hoá tên để so trùng: bỏ dấu, hạ chữ thường, gộp khoảng trắng. */
const norm = (s) => String(s ?? '').replace(/[Đđ]/g, (m) => (m === 'Đ' ? 'D' : 'd'))
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Đánh dấu ca BIÊN theo cấu trúc — không dùng nhãn của người thứ nhất. */
const flagsFor = (r) => {
  const cands = [];
  for (let i = 1; i <= 5; i += 1) {
    const sku = r['cand' + i + '_sku'];
    if (sku) cands.push({ sku, name: r['cand' + i + '_name'] });
  }
  const f = [];
  // Hai ứng viên tên gần như giống nhau sau khi chuẩn hoá.
  for (let i = 0; i < cands.length; i += 1) {
    for (let j = i + 1; j < cands.length; j += 1) {
      const a = norm(cands[i].name); const b = norm(cands[j].name);
      if (a && b && a !== b && (a.startsWith(b) || b.startsWith(a))) f.push(`cand${i + 1}~${j + 1} tên gần trùng`);
    }
  }
  const ext = norm(r.external_name);
  if (ext.length > 42) f.push('tên sàn dài');
  if (/\d{3,}/.test(ext)) f.push('có số lượng lớn trong tên');
  if (/(\[(.*?)\]|- sale|hot|chuyen si|combo|tang)/i.test(ext)) f.push('có nhãn khuyến mãi/quà');
  if (cands.length <= 2) f.push('chỉ còn ' + cands.length + ' ứng viên');
  if (!cands.length) f.push('KHÔNG có ứng viên nào');
  return [...new Set(f)];
};

const read = () => {
  if (!fs.existsSync(SHEET)) throw new Error('khong thay ' + SHEET);
  const { head, rows } = parseCsv(fs.readFileSync(SHEET, 'utf8'));
  return { head, rows };
};

const migrate = () => {
  const { head, rows } = read();
  const missing = COLS.filter((c) => !head.includes(c));
  if (!missing.length) { console.log('--migrate: cot da du, khong can lam gi'); return; }
  const now = new Date().toISOString().slice(0, 10);
  let moved = 0;
  for (const r of rows) {
    // Nhãn sẵn có (gán bởi `labeler_a`) chuyển sang cột trả lời của người A.
    if (!r.label_a_sku && r.label_sku && r.labeler_a) {
      r.label_a_sku = r.label_sku;
      r.label_a_confidence = r.label_confidence || '';
      r.label_a_note = r.label_note || '';
      r.label_a_by = r.labeler_a;
      r.label_a_at = now;
      moved += 1;
    }
    for (const c of missing) if (r[c] === undefined) r[c] = '';
  }
  fs.writeFileSync(SHEET, toCsv(COLS, rows), 'utf8');
  console.log(`--migrate: them ${missing.length} cot, chuyen ${moved} nhan sang label_a_*`);
};

const exportBlind = () => {
  const { rows } = read();
  const can = rows.filter((r) => (r.label_a_sku || r.label_sku) && !r.label_b_sku);
  const headB = [
    'pair_id', 'external_name',
    'cand1_sku', 'cand1_name', 'cand2_sku', 'cand2_name', 'cand3_sku', 'cand3_name',
    'cand4_sku', 'cand4_name', 'cand5_sku', 'cand5_name',
    'amb', 'b_sku', 'b_confidence', 'b_note', 'b_by', 'b_at',
  ];
  const out = can.map((r) => {
    const f = flagsFor(r);
    return {
      pair_id: r.pair_id,
      external_name: r.external_name,
      cand1_sku: r.cand1_sku, cand1_name: r.cand1_name,
      cand2_sku: r.cand2_sku, cand2_name: r.cand2_name,
      cand3_sku: r.cand3_sku, cand3_name: r.cand3_name,
      cand4_sku: r.cand4_sku, cand4_name: r.cand4_name,
      cand5_sku: r.cand5_sku, cand5_name: r.cand5_name,
      amb: f.join('; '),
      b_sku: '', b_confidence: '', b_note: '', b_by: '', b_at: '',
    };
  });
  fs.writeFileSync(OUT_B, toCsv(headB, out), 'utf8');
  const bien = out.filter((r) => r.amb).length;
  console.log('--export: ' + out.length + ' cap cho nguoi B -> ' + path.relative(ROOT, OUT_B));
  console.log('   trong do ' + bien + ' cap duoc danh dau BIEN theo cau truc');
  console.log('   KHONG co label_a_*/label_sku trong file nay — nhan MÙ.');
};

const loadB = (file) => {
  const src = file || OUT_B;
  if (!fs.existsSync(src)) throw new Error('khong thay ' + src);
  const { rows: bRows } = parseCsv(fs.readFileSync(src, 'utf8'));
  const { head, rows } = read();
  const byId = new Map(rows.map((r) => [r.pair_id, r]));
  let n = 0; let bo = 0;
  for (const b of bRows) {
    const r = byId.get(b.pair_id);
    if (!r) continue;
    if (!b.b_sku && !b.b_note) continue;
    r.label_b_sku = b.b_sku || '';
    r.label_b_confidence = b.b_confidence || '';
    r.label_b_note = b.b_note || '';
    r.labeler_b = b.b_by || r.labeler_b || '';
    r.label_b_at = b.b_at || new Date().toISOString().slice(0, 10);
    // `label_sku` là nhãn CHỐT dùng để chấm điểm. Nếu B trả lời khác A thì để
    // trống và ghi chú — người thứ ba phân xử sau. Không tự chọn phía nào.
    if (b.b_sku && r.label_a_sku && b.b_sku !== r.label_a_sku) {
      r.label_note = [r.label_note, 'A≠B (' + r.label_a_sku + ' vs ' + b.b_sku + ') cần người thứ ba'].filter(Boolean).join('; ');
      r.label_sku = '';
      bo += 1;
    } else if (b.b_sku && !r.label_sku) {
      r.label_sku = b.b_sku;
    }
    n += 1;
  }
  fs.writeFileSync(SHEET, toCsv(COLS, rows), 'utf8');
  console.log(`--load: nap ${n} nhan tu ${path.basename(src)}`);
  console.log(`   ${bo} cap A≠B -> de label_sku trong, danh dau cho nguoi thu ba phan xu`);
};

const main = () => {
  const a = process.argv.slice(2);
  if (a.includes('--migrate')) return migrate();
  if (a.includes('--export')) return exportBlind();
  if (a.includes('--load')) return loadB(a[a.indexOf('--load') + 1]);
  console.log('dung:');
  console.log('  node scripts/llm/label-second.js --migrate        them cot tra loi rieng cho moi nguoi');
  console.log('  node scripts/llm/label-second.js --export         xuat ban MU cho nguoi gán thu hai');
  console.log('  node scripts/llm/label-second.js --load [file]   nap nhan nguoi thu hai ve sheet chinh');
};
main();