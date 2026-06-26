/**
 * utils/vietnameseMoneyWords.js — Chuyển số tiền thành chữ tiếng Việt
 * 
 * Tổng quan:
 * - Dùng cho hóa đơn, phiếu thu/chi: "Một trăm hai mươi ba nghìn bốn trăm năm mươi sáu đồng"
 * - Hỗ trợ đến hàng tỷ
 * - Xử lý đặc biệt: "mốt" (1 ở hàng đơn vị sau mươi), "lăm" (5), "lẻ" (0 ở hàng chục)
 * 
 * Hàm:
 * - readTriple(n): Đọc số có 3 chữ số (0-999)
 * - numberToVietnameseWords(amount): Chuyển số tiền thành chữ, thêm "đồng" ở cuối
 */

const UNITS = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
const TEENS = [
  "mười",
  "mười một",
  "mười hai",
  "mười ba",
  "mười bốn",
  "mười lăm",
  "mười sáu",
  "mười bảy",
  "mười tám",
  "mười chín",
];

const readTriple = (n) => {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const ten = Math.floor(rest / 10);
  const unit = rest % 10;
  const parts = [];
  if (hundred) {
    parts.push(`${UNITS[hundred]} trăm`);
    if (rest > 0 && rest < 10) parts.push("lẻ");
  }
  if (rest >= 20) {
    parts.push(`${UNITS[ten]} mươi`);
    if (unit === 1) parts.push("mốt");
    else if (unit === 5) parts.push("lăm");
    else if (unit) parts.push(UNITS[unit]);
  } else if (rest >= 10) {
    parts.push(TEENS[rest - 10]);
  } else if (unit) {
    parts.push(UNITS[unit]);
  }
  return parts.join(" ").trim();
};

const numberToVietnameseWords = (amount) => {
  const n = Math.round(Number(amount) || 0);
  if (n === 0) return "không đồng";
  const scales = ["", " nghìn", " triệu", " tỷ"];
  let num = n;
  const chunks = [];
  let i = 0;
  while (num > 0) {
    chunks.push({ value: num % 1000, scale: scales[i] });
    num = Math.floor(num / 1000);
    i += 1;
  }
  const words = chunks
    .reverse()
    .filter((c) => c.value > 0)
    .map((c) => `${readTriple(c.value)}${c.scale}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} đồng`;
};

module.exports = { numberToVietnameseWords };
