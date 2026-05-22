// Vietcombank XLSX importer
// Format: STT | Ngày GD | Mã GD | Nội dung | Phát sinh Nợ | Phát sinh Có | Số dư

const parseVCB = (rows) => {
  const lines = [];
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : Object.values(row);
    if (!cells || cells.length < 5) continue;

    // Tìm dòng có ngày hợp lệ (cột 1 hoặc 2)
    let dateStr = String(cells[1] || "").trim();
    if (!dateStr.match(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) {
      dateStr = String(cells[0] || "").trim();
    }
    if (!dateStr.match(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) continue;

    const [d, m, y] = dateStr.split(/[\/\-]/).map(Number);
    const txDate = new Date(y, m - 1, d);
    if (isNaN(txDate.getTime())) continue;

    const description = String(cells[3] || cells[2] || "").trim();
    const debit  = parseVNDAmount(cells[4]);
    const credit = parseVNDAmount(cells[5]);
    const balance = parseVNDAmount(cells[6]);
    const reference = String(cells[2] || "").trim();

    if (debit === 0 && credit === 0) continue;

    lines.push({ txDate, description, debit, credit, balance, reference });
  }
  return lines;
};

const parseVNDAmount = (v) => {
  if (!v && v !== 0) return 0;
  const s = String(v).replace(/[.,\s]/g, "").replace(/[^\d\-]/g, "");
  const n = Number(s);
  return isNaN(n) ? 0 : Math.abs(n);
};

module.exports = { parseVCB };
