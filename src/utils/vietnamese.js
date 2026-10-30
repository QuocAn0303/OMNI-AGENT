'use strict';

/**
 * utils/vietnamese.js — Chuẩn hoá chuỗi tiếng Việt để so khớp
 *
 * ============================================================================
 * VÌ SAO CẦN
 * Người dùng gõ tiếng Việt CÓ DẤU ("hóa đơn"), còn mã định danh, tên trường và
 * rất nhiều từ khoá trong mã nguồn lại viết KHÔNG DẤU ("hoa don"). Nếu so khớp
 * bằng `includes` thẳng thì hai bên không gặp nhau.
 *
 * Cụ thể, trước khi có tệp này, `db-agent.service.js` đã tạo hai lỗi thật:
 *
 *   "sap het"  → search_inventory   (đúng, nhờ pattern không dấu 'sap het')
 *   "sắp hết" → null               (SAI — pattern chỉ có bản không dấu)
 *
 *   "hoa don"  → search_invoices    (đúng, vì 'đơn' có dấu không xuất hiện trong "hoa don")
 *   "hóa đơn"  → search_orders      (SAI — 'đơn' khớp chuỗi con trong "hóa đơn")
 *
 * Lưu ý lỗi thứ hai: càng bỏ dấu thì càng HAY gặp, nên viết không dấu che lỗi thay
 * vì gây lỗi. Đó là lý do phải chuẩn hoá cả hai vế thay vì chọn một kiểu viết.
 *
 * ============================================================================
 * VÌ SAO KHÔNG DÙNG ĐƯỢC `String.normalize('NFD')` MỘT MÌNH
 * `đ` (U+0111, LATIN SMALL LETTER D WITH STROKE) là MỘT CHỮ CÁI RIÊNG, không phải
 * dấu phụ tổ hợp, nên NFD KHÔNG tách nó thành `d`. Thêm nữa, `đ` không nằm trong
 * `[a-z]`, nên regex `[^a-z0-9]+` của `sku-matcher.js` nuốt mất nó:
 *
 *     "đối tác" -> NFD -> bỏ dấu phụ -> "đoi tac" -> [^a-z0-9]+ -> " oi tac"
 *
 * ⇒ mất chữ 'đ', và "đối tác" thành " oi tac" còn "dơ vay" lại thành "dơ vay".
 * Tệp đó dùng cho khớp tên SKU nên hậu quả nhẹ; ở đây so khớp cả câu hỏi người
 * dùng nên phải xử lý `đ` riêng.
 */

/**
 * Bỏ dấu tiếng Việt, giữ nguyên chữ cái và số.
 *
 * Không đụng vào khoảng trắng, dấu gạch, dấu chấm — vì ở đây cần so khớp CHUỖI
 * CON (`includes`) và mã định danh (`ĐT-202610-0001`), khác với `sku-matcher.js`
 * vốn cần cắt thành từ rồi so trigram.
 *
 * @param {unknown} input
 * @returns {string}
 */
const stripDiacritics = (input) =>
  String(input ?? '')
    // Đ/đ trước: không phải dấu phụ nên NFD không xử lý, phải thay tay.
    .replace(/[Đđ]/g, (ch) => (ch === 'Đ' ? 'D' : 'd'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

module.exports = { stripDiacritics };