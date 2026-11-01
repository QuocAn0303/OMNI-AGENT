/**
 * mcp_servers/shared/pricing.js — Lõi tính giá TẤT ĐỊNH dùng chung.
 *
 * ============================================================================
 * MỘT NGUỒN SỰ THẬT CHO MỌI PHÉP TÍNH TIỀN CỦA BÁO GIÁ BÁN HÀNG
 * ============================================================================
 * Ba nơi cần cùng một kết quả:
 *   - `agents/src/agents/sales/pricingEngine.ts` (agent TS, qua wrapper có kiểu),
 *   - `mcp_servers/sheets-mcp` (xuất file báo giá),
 *   - `src/modules/agent-gateway/sales.service.js` (HTTP + gate + lưu draft).
 *
 * Nếu mỗi nơi tự viết công thức, chỉ cần một chỗ đổi cách làm tròn là báo giá
 * hiển thị khác số đã duyệt. Vì vậy toàn bộ công thức nằm ở tệp này.
 *
 * BẤT BIẾN:
 *   - Không LLM nào tính tiền. Hàm thuần, không I/O, không thời gian.
 *   - Sai số cho phép ≤ 1 đồng (VND là đơn vị nguyên).
 *   - SKU không có trong bảng giá chuẩn ⇒ `PRODUCT_NOT_IN_PRICELIST`, không
 *     bao giờ lấy giá từ nội dung khách gửi.
 */

'use strict';

/** Sai số tối đa được coi là "khớp" — 1 đồng. */
const TOLERANCE_VND = 1;

const DEFAULT_VAT_RATE = 0.1;

class PricingError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {Array<object>} [issues]
   */
  constructor(code, message, issues = []) {
    super(message || code);
    this.name = 'PricingError';
    this.code = code;
    this.issues = issues;
  }
}

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

/** Tiền VND là số nguyên; làm tròn half-up cho số dương. */
const roundMoney = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed);
};

const normalizePercent = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new PricingError('INVALID_DISCOUNT_PERCENT', 'discountPercent phải trong khoảng 0..100');
  }
  return parsed;
};

const normalizeVatRate = (value, fallback = DEFAULT_VAT_RATE) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new PricingError('INVALID_VAT_RATE', 'vatRate phải trong khoảng 0..1');
  }
  return parsed;
};

/** Chuẩn hoá bảng giá về dạng `{ sku, name, unitPrice, vatRate, active }`. */
const normalizePriceList = (priceList) => {
  const raw = Array.isArray(priceList) ? priceList : priceList?.items;
  if (!Array.isArray(raw)) {
    throw new PricingError('PRICE_LIST_INVALID', 'Bảng giá phải là mảng hoặc { items: [] }');
  }

  return raw
    .map((item) => ({
      sku: String(item?.sku || '').trim().toUpperCase(),
      name: String(item?.name || item?.sku || '').trim(),
      unitPrice: roundMoney(item?.unitPrice ?? item?.price),
      vatRate: item?.vatRate === undefined || item?.vatRate === null
        ? DEFAULT_VAT_RATE
        : normalizeVatRate(item.vatRate),
      active: item?.active !== false,
    }))
    .filter((item) => item.sku && Number.isFinite(item.unitPrice) && item.unitPrice >= 0);
};

const buildPriceIndex = (priceList) => {
  const index = new Map();
  for (const item of normalizePriceList(priceList)) {
    if (!item.active) continue;
    index.set(item.sku, item);
  }
  return index;
};

const normalizeLines = (input) => {
  const raw = Array.isArray(input?.lines) ? input.lines : Array.isArray(input) ? input : [];
  if (raw.length === 0) {
    throw new PricingError('QUOTE_LINES_EMPTY', 'Báo giá phải có ít nhất một dòng hàng');
  }

  return raw.map((line, index) => {
    const sku = String(line?.sku || '').trim().toUpperCase();
    const qty = toNumber(line?.qty);
    if (!sku) {
      throw new PricingError('QUOTE_LINE_INVALID', `Dòng ${index + 1}: thiếu sku`);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new PricingError('QUOTE_LINE_INVALID', `Dòng ${index + 1}: số lượng phải > 0`);
    }
    return { sku, qty };
  });
};

/**
 * Tính báo giá từ bảng giá chuẩn.
 *
 * @param {{
 *   lines?: Array<{ sku: string, qty: number }>,
 *   discountPercent?: number,
 *   vatRate?: number,
 *   quoteNumber?: string|null,
 *   currency?: string,
 * }} input
 * @param {Array<object>|{items: Array<object>}} priceList
 * @returns {object}
 */
const computeQuote = (input = {}, priceList) => {
  const priceIndex = buildPriceIndex(priceList);
  const requested = normalizeLines(input);
  const discountPercent = normalizePercent(input.discountPercent, 0);
  const vatRate = normalizeVatRate(input.vatRate, DEFAULT_VAT_RATE);

  const missing = requested.filter((line) => !priceIndex.has(line.sku));
  if (missing.length > 0) {
    throw new PricingError(
      'PRODUCT_NOT_IN_PRICELIST',
      `Sản phẩm không có trong bảng giá chuẩn: ${missing.map((line) => line.sku).join(', ')}`,
      missing.map((line) => ({ code: 'PRODUCT_NOT_IN_PRICELIST', sku: line.sku })),
    );
  }

  const lines = requested.map((line) => {
    const price = priceIndex.get(line.sku);
    const lineTotal = roundMoney(price.unitPrice * line.qty);
    return {
      sku: price.sku,
      name: price.name,
      qty: line.qty,
      unitPrice: price.unitPrice,
      lineTotal,
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discountAmount = roundMoney((subtotal * discountPercent) / 100);
  const netAmount = subtotal - discountAmount;
  const vatAmount = roundMoney(netAmount * vatRate);
  const totalAmount = netAmount + vatAmount;

  return {
    quoteNumber: input.quoteNumber ? String(input.quoteNumber).trim() : null,
    currency: String(input.currency || 'VND').trim().toUpperCase() || 'VND',
    lines,
    subtotal,
    discountPercent,
    discountAmount,
    netAmount,
    vatRate,
    vatAmount,
    totalAmount,
    computedBy: 'deterministic_pricing_engine',
    schemaVersion: '1.0.0',
  };
};

const pushIssue = (issues, code, detail = {}) => {
  issues.push({ code, ...detail });
};

/**
 * Validator ĐỘC LẬP: tự tính lại từng dòng và mọi tổng từ đầu.
 *
 * Không tin bất kỳ trường tiền nào có sẵn trong `quote`. Chỉ tin `sku`, `qty`,
 * `unitPrice` (để phát hiện sửa giá) và các tỷ lệ. Nhờ vậy sửa `totalAmount`
 * bằng tay luôn bị bắt, kể cả khi các dòng vẫn đúng.
 *
 * @param {object} quote
 * @param {Array<object>|{items: Array<object>}} priceList
 * @returns {{ valid: boolean, code: string|null, issues: Array<object> }}
 */
const validateQuoteMath = (quote, priceList) => {
  const issues = [];
  if (!quote || typeof quote !== 'object' || !Array.isArray(quote.lines) || quote.lines.length === 0) {
    return {
      valid: false,
      code: 'QUOTE_MATH_MISMATCH',
      issues: [{ code: 'QUOTE_MATH_MISMATCH', detail: 'quote_lines_missing' }],
    };
  }

  const priceIndex = buildPriceIndex(priceList);
  let subtotal = 0;
  let hasUnknownSku = false;

  for (const line of quote.lines) {
    const sku = String(line?.sku || '').trim().toUpperCase();
    const price = priceIndex.get(sku);
    if (!price) {
      hasUnknownSku = true;
      pushIssue(issues, 'PRODUCT_NOT_IN_PRICELIST', { sku });
      continue;
    }

    const qty = toNumber(line.qty);
    const unitPrice = roundMoney(line.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) {
      pushIssue(issues, 'QUOTE_MATH_MISMATCH', { detail: 'qty_invalid', sku });
      continue;
    }
    if (unitPrice !== price.unitPrice) {
      pushIssue(issues, 'QUOTE_MATH_MISMATCH', {
        detail: 'unit_price_not_in_pricelist',
        sku,
        expected: price.unitPrice,
        actual: unitPrice,
      });
    }

    const expectedLineTotal = roundMoney(price.unitPrice * qty);
    const actualLineTotal = roundMoney(line.lineTotal);
    if (!Number.isFinite(actualLineTotal) || Math.abs(expectedLineTotal - actualLineTotal) > TOLERANCE_VND) {
      pushIssue(issues, 'QUOTE_MATH_MISMATCH', {
        detail: 'line_total_mismatch',
        sku,
        expected: expectedLineTotal,
        actual: actualLineTotal,
      });
    }
    subtotal += expectedLineTotal;
  }

  const discountPercent = normalizePercent(quote.discountPercent, 0);
  const vatRate = normalizeVatRate(quote.vatRate, DEFAULT_VAT_RATE);
  const discountAmount = roundMoney((subtotal * discountPercent) / 100);
  const netAmount = subtotal - discountAmount;
  const vatAmount = roundMoney(netAmount * vatRate);
  const totalAmount = netAmount + vatAmount;

  const compare = (field, expected, actual) => {
    const value = roundMoney(actual);
    if (!Number.isFinite(value) || Math.abs(expected - value) > TOLERANCE_VND) {
      pushIssue(issues, 'QUOTE_MATH_MISMATCH', { detail: `${field}_mismatch`, expected, actual: value });
    }
  };

  compare('subtotal', subtotal, quote.subtotal);
  compare('discount_amount', discountAmount, quote.discountAmount);
  compare('net_amount', netAmount, quote.netAmount);
  compare('vat_amount', vatAmount, quote.vatAmount);
  compare('total_amount', totalAmount, quote.totalAmount);

  const code = hasUnknownSku ? 'PRODUCT_NOT_IN_PRICELIST' : issues.length ? 'QUOTE_MATH_MISMATCH' : null;
  return { valid: issues.length === 0, code, issues };
};

module.exports = {
  TOLERANCE_VND,
  DEFAULT_VAT_RATE,
  PricingError,
  roundMoney,
  normalizePriceList,
  computeQuote,
  validateQuoteMath,
};
