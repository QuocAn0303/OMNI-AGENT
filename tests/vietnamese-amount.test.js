/**
 * tests/vietnamese-amount.test.js — Parse số tiền viết tắt tiếng Việt
 *
 * Bối cảnh: câu "tạo PO giá 5 triệu" từng bị parser createPO hiểu sai —
 * regex cũ chỉ nhận "tr" nên "5 triệu" không khớp, phần chữ còn lại
 * ("giá triệu") bị nhầm thành tên sản phẩm.
 */
const { parseAmount, formatVnd } = require('../src/utils/vietnameseAmount');

describe('parseAmount — số tiền viết tắt', () => {
  test('"5 triệu" → 5.000.000 (BUG GỐC: thiếu đơn vị "triệu")', () => {
    const r = parseAmount('tạo PO giá 5 triệu');
    expect(r).not.toBeNull();
    expect(r.value).toBe(5_000_000);
  });

  test('các đơn vị tiền tệ Việt Nam', () => {
    expect(parseAmount('5 triệu').value).toBe(5_000_000);
    expect(parseAmount('5tr').value).toBe(5_000_000);
    expect(parseAmount('5 tr').value).toBe(5_000_000);
    expect(parseAmount('2 tỷ').value).toBe(2_000_000_000);
    expect(parseAmount('500k').value).toBe(500_000);
    expect(parseAmount('500 nghìn').value).toBe(500_000);
    expect(parseAmount('1.000.000đ').value).toBe(1_000_000);
    expect(parseAmount('250000 vnd').value).toBe(250_000);
    expect(parseAmount('1.5 triệu').value).toBe(1_500_000);
  });

  test('"triệu" phải thắng "tr" — không cắt mất phần "iệu"', () => {
    // Nếu thứ tự regex sai, "triệu" sẽ match "tr" → 5.000.000 vẫn đúng,
    // nhưng "trieu" (không dấu) sẽ thành 5.000.000 * 1e6 = sai.
    expect(parseAmount('3 trieu').value).toBe(3_000_000);
  });

  test('dấu phân cách thập phân và nghìn', () => {
    expect(parseAmount('2,5 triệu').value).toBe(2_500_000);
    expect(parseAmount('1,234,567đ').value).toBe(1_234_567);
    expect(parseAmount('10.000.000 đồng').value).toBe(10_000_000);
  });

  test('trả về vị trí để caller xoá đúng mệnh đề tiền', () => {
    const r = parseAmount('tạo PO giá 5 triệu');
    expect('tạo PO giá 5 triệu'.slice(r.index, r.index + r.length).toLowerCase())
      .toBe('5 triệu');
  });

  test('không có số → null (không ném lỗi)', () => {
    expect(parseAmount('tạo đơn nhập')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  test('số lượng ("3 cái") KHÔNG bị parse thành tiền', () => {
    // Nếu không có negative lookahead, "3 cái" → 3đ.
    expect(parseAmount('cho nến thơm 3 cái')).toBeNull();
    expect(parseAmount('mua 2 kg')).toBeNull();
  });

  test('số không kèm đơn vị vẫn parse được (mặc định nhân 1)', () => {
    expect(parseAmount('mua 100').value).toBe(100);
  });
});

describe('formatVnd', () => {
  test('phân tách nghìn kiểu Việt Nam', () => {
    expect(formatVnd(5_000_000)).toBe('5.000.000đ');
    expect(formatVnd(0)).toBe('0đ');
    expect(formatVnd(null)).toBe('0đ');
  });
});
