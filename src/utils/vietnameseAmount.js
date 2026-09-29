/**
 * utils/vietnameseAmount.js — Parse số tiền viết tắt trong tiếng Việt
 *
 * Ngữ cảnh: AI agent nhận câu lệnh tự nhiên kiểu "tạo PO giá 5 triệu",
 * "doanh thu 2,5 tỷ", "mua 500k". Regex `(\d+)\s*(đ|vnđ|vnd|k|tr)` cũ chỉ
 * bắt được "5 tr" nhưng bỏ sót "5 triệu" → phần chữ còn lại ("giá triệu")
 * bị parser PO nhầm thành tên sản phẩm.
 *
 * Hàm:
 * - parseAmount(str): Tìm số tiền đầu tiên trong chuỗi → { value, matched, index, length } | null
 * - formatVnd(n): Định dạng số tiền kiểu Việt Nam (dấu chấm phân tách nghìn)
 *
 * Quy ước đơn vị (không phân biệt hoa/thường, chấp nhận cả dấu cách):
 *   tỷ | ty | tỉ  → 1e9
 *   triệu | tr   → 1e6
 *   triệu k / c  → không hỗ trợ (giữ nguyên hành vi cũ: chỉ "k" = 1e3)
 *   nghìn | ng    → 1e3
 *   ngàn | ng     → 1e3
 *   k              → 1e3
 *   đ | đồng | vnd | vnđ → 1
 */

// Thứ tự quan trọng: cụm dài phải đứng trước để "triệu" không bị "tr" cắt mất.
const UNIT_MULTIPLIERS = [
  [/^tỷ|^ty|^tỉ/, 1e9],
  [/^triệu/, 1e6],
  [/^trieu/, 1e6],
  [/^nghìn/, 1e3],
  [/^nghin/, 1e3],
  [/^ngàn/, 1e3],
  [/^ng\b/, 1e3],
  [/^tr\b/, 1e6],
  [/^tr/, 1e6],
  [/^k\b/, 1e3],
  [/^đ|^đồng|^dong|^vnd|^vnđ/, 1],
];

/**
 * Parse số tiền viết tắt trong tiếng Việt.
 *
 * @param {string} str Chuỗi đầu vào (ví dụ: "tạo PO giá 5 triệu")
 * @returns {{value: number, matched: string, index: number, length: number}|null}
 *   null nếu không tìm thấy số tiền.
 */
function parseAmount(str) {
  if (!str || typeof str !== 'string') return null;
  const text = str.toLowerCase();

  // Số tiền: 5 | 5.5 | 2,5 | 1.234.567 — chấp nhận cả . và , làm dấu thập phân
  // và dấu phân tách nghìn. Regex bắt buộc phải có ít nhất 1 chữ số.
  //
  // QUAN TRỌNG — negative lookahead QTY_UNITS:
  // Số đứng trước đơn vị đếm ("3 cái", "2 kg") là SỐ LƯỢNG, không phải tiền.
  // Nếu không chặn, parseAmount("cho nến thơm 3 cái") trả 3 → thành tiền 3đ.
  // Thứ tự trong lookahead: cụm dài trước ("sản phẩm" trước "sp").
  const QTY_UNITS = 'sản phẩm|cái|chiếc|hộp|chai|lon|bóc|thùng|túi|kg|kilogram|gam|gram|sp|san pham';
  const re = new RegExp(
    `(\\d[\\d.,]*)\\s*(nghìn|nghin|ngàn|triệu|trieu|ngàn|ng|đồng|dong|ty|tr|tỷ|tỉ|đ|vnd|vnđ|k)?` +
    // Lookahead phải thử khớp TRƯỚC phần đơn vị đã match, và cần ranh giới từ
    // phía sau — nếu không, "2 kg" bị "k" (nghìn) nuốt thành 2000 trước khi kịp chặn.
    `(?!\\s*(?:${QTY_UNITS})\\b)(?!\\s*[a-z])`,
    'g',
  );
  let m;
  while ((m = re.exec(text)) !== null) {
    const [matched, rawNum, unitRaw] = m;

    // Chuẩn hoá số:
    //  - "1.000.000" / "1,234,567" → phân tách nghìn → 1000000
    //  - "1,5" / "2.5"             → thập phân     → 1.5
    //  Quy tắc: nếu có cả '.' và ',' thì coi cả hai là phân tách nghìn.
    //            Nếu chỉ một loại, phần cuối ≤ 2 chữ số → thập phân, ngược lại phân tách.
    let num = rawNum;
    const hasDot = num.includes('.');
    const hasComma = num.includes(',');
    if (hasDot && hasComma) {
      num = num.replace(/[.,]/g, '');           // 1.234,567 → 1234567
    } else if (hasComma) {
      const parts = num.split(',');
      num = parts[parts.length - 1].length <= 2 ? num.replace(',', '.') : num.replace(/,/g, '');
    } else if (hasDot) {
      const parts = num.split('.');
      num = parts.length > 2 ? num.replace(/\./g, '')   // 1.000.000 → 1000000
                             : (parts[1].length <= 2 ? num : num.replace(/\./g, ''));
    }
    const base = parseFloat(num);
    if (!Number.isFinite(base)) continue;

    // Tra đơn vị
    let multiplier = 1;
    if (unitRaw) {
      const unit = unitRaw.toLowerCase();
      const found = UNIT_MULTIPLIERS.find(([re2]) => re2.test(unit));
      multiplier = found ? found[1] : 1;
    }

    return {
      value: base * multiplier,
      matched: m[0],
      index: m.index,
      length: m[0].length,
    };
  }
  return null;
}

/**
 * Định dạng số tiền kiểu Việt Nam: 5000000 → "5.000.000đ"
 * @param {number} n
 * @returns {string}
 */
function formatVnd(n) {
  const num = Number(n || 0);
  return `${num.toLocaleString('vi-VN')}đ`;
}

module.exports = { parseAmount, formatVnd };
