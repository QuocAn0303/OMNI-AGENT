/* SCRIPT TẢM — convert tất cả *.csv trong data/supermarket/ thành một XLSX
 * (mỗi sheet một bảng). Giúp trình bày/di import theo dạng chỉ cần mở Excel.
 * Chạy: node scripts/csv-to-xlsx.js
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '../data/supermarket');
const OUT = path.join(DIR, 'supermarket-master.xlsx');

function readCsv(name) {
  const txt = fs.readFileSync(path.join(DIR, name), 'utf-8');
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(/,(?=(?:"[^"]*"|[^,])*$:)/).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((l) => {
    const cells = [];
    let cur = ''; let q = false;
    for (let i = 0; i < l.length; i += 1) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i += 1; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch; }
    }
    cells.push(cur);
    return cells;
  });
  return { header, rows };
}

(async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aduu ERP — AISC26-0058';
  wb.created = new Date();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.csv'));
  for (const fn of files) {
    const { header, rows } = readCsv(fn);
    const sheet = wb.addWorksheet(path.basename(fn, '.csv'));
    sheet.addRow(header);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
    for (const r of rows) sheet.addRow(r);
    // Column widths
    header.forEach((h, i) => {
      const mx = Math.max(h.length, ...rows.map((r) => String(r[i] || '').length).slice(0, 200)) + 2;
      sheet.getColumn(i + 1).width = Math.min(mx, 40);
    });
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + (header.length > 26 ? 90 : header.length))}${rows.length + 1}` };
    console.log('   ' + fn.padEnd(28) + 'rows=' + rows.length);
  }
  await wb.xlsx.writeFile(OUT);
  console.log('  => XLSX ' + OUT + ' (' + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
  console.log('  worksheets: ' + wb.worksheets.length);
})();
