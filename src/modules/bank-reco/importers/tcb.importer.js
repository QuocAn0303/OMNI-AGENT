/**
 * modules/bank-reco/importers/tcb.importer.js — Import sao kê Techcombank (CSV)
 * 
 * Tổng quan:
 * - Parse file CSV sao kê từ Techcombank. Format: Ngày GD, Số tham chiếu, Nội dung, Phát sinh Nợ, Phát sinh Có, Số dư
 * - Chuyển đổi ngày (DD/MM/YYYY hoặc DD-MM-YYYY), parse số tiền, bỏ qua dòng header.
 * 
 * Hàm:
 * - parseTCB(rows): Nhận mảng rows (array hoặc object), parse từng dòng → { txDate, description, debit, credit, balance, reference }; bỏ qua dòng debit=0 && credit=0
 * - parseAmt(v): Parse số tiền: loại bỏ dấu phẩy, dấu chấm, khoảng trắng, ký tự không phải số
 */
// Techcombank CSV importer
// Format: Ngày GD,Số tham chiếu,Nội dung,Phát sinh Nợ,Phát sinh Có,Số dư

const parseTCB = (rows) => {
  const lines = [];
  let headerSkipped = false;
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : Object.values(row);
    if (!headerSkipped) { headerSkipped = true; continue; }

    const dateStr = String(cells[0] || "").trim();
    if (!dateStr) continue;

    // Support: DD/MM/YYYY or DD-MM-YYYY
    const parts = dateStr.split(/[\/\-T ]/);
    let txDate;
    if (parts.length >= 3) {
      const [d, m, y] = parts.map(Number);
      txDate = new Date(y, m - 1, d);
    } else { continue; }
    if (isNaN(txDate.getTime())) continue;

    const reference   = String(cells[1] || "").trim();
    const description = String(cells[2] || "").trim();
    const debit       = parseAmt(cells[3]);
    const credit      = parseAmt(cells[4]);
    const balance     = parseAmt(cells[5]);

    if (debit === 0 && credit === 0) continue;
    lines.push({ txDate, description, debit, credit, balance, reference });
  }
  return lines;
};

const parseAmt = (v) => {
  if (!v && v !== 0) return 0;
  const n = Number(String(v).replace(/[,. ]/g, "").replace(/[^\d\-]/g, ""));
  return isNaN(n) ? 0 : Math.abs(n);
};

module.exports = { parseTCB };
