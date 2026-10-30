'use strict';

/**
 * scripts/lib/csv.js — ĐỌC/GHI CSV tối thiểu, đúng chuẩn RFC 4180
 *
 * VÌ SAO TỰ VIẾT thay vì `split(',')`: tên hàng trong tệp xuất sàn có dấu phẩy và
 * dấu nháy kép bên trong (ví dụ `Assorted Flower Colour "Leis"`). Tách bằng `split`
 * làm hỏng cột, và hỏng **âm thầm** — tên hàng cắt cụt rồi đem khớp SKU vẫn ra kết
 * quả, chỉ là sai. Đây là loại lỗi mà `smoke:import-demo` bắt được ở P4 (bước đo sai
 * hơn thuật toán), nên ở đây phải đúng ngay từ đầu.
 *
 * Không kéo thêm thư viện: tệp export của sàn không có nhúng dòng mới trong ô.
 */

const parseCsv = (text) => {
  const clean = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cur += '"'; i += 1; }
        else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
};

/** Đọc CSV thành mảng object theo tên cột. */
const readCsvObjects = (text) => {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = String(r[i] ?? '').trim(); });
    return o;
  });
};

/** Chuỗi CSV 1 dòng (không kèm \n). */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Ghi CSV. `bom=true` (mặc định) để Excel trên Windows mở đúng tiếng Việt. */
const toCsv = (header, rows, { bom = true } = {}) => {
  const body = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
  return `${bom ? '\uFEFF' : ''}${body}\n`;
};

module.exports = { parseCsv, readCsvObjects, csvCell, toCsv };