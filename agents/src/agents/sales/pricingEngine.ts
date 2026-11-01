/**
 * agents/sales/pricingEngine.ts — vỏ CÓ KIỂU quanh lõi tính giá tất định.
 *
 * ============================================================================
 * KHÔNG CHÉP CÔNG THỨC SANG TYPESCRIPT
 * ============================================================================
 * Công thức nằm DUY NHẤT ở `mcp_servers/shared/pricing.js`. Gateway (JavaScript)
 * và agent (TypeScript) cùng gọi đúng một tệp. Nếu chép sang đây, chỉ cần một
 * bên đổi cách làm tròn là báo giá hiển thị khác số đã duyệt.
 *
 * `validateQuoteMath` tự tính lại từng dòng và mọi tổng từ đầu, không tin bất kỳ
 * trường tiền nào có sẵn trong quote. Sai lệch > 1 đồng hoặc SKU ngoài bảng giá
 * đều bị chặn.
 */
import type {
  PriceListItem,
  QuoteIssue,
  QuoteValidation,
  SalesQuote,
  SalesQuoteLineInput,
} from './salesContract';

interface PricingModule {
  TOLERANCE_VND: number;
  DEFAULT_VAT_RATE: number;
  PricingError: new (code: string, message?: string, issues?: QuoteIssue[]) => Error & {
    code: string;
    issues: QuoteIssue[];
  };
  roundMoney(value: unknown): number;
  normalizePriceList(priceList: unknown): PriceListItem[];
  computeQuote(input: unknown, priceList: unknown): SalesQuote;
  validateQuoteMath(quote: unknown, priceList: unknown): QuoteValidation;
}

// Đường dẫn cố định: `agents/src/agents/sales` và `agents/dist/agents/sales`
// đều cách gốc repo 4 cấp, nên một đường dẫn dùng được cho cả ts-jest và dist.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pricing = require('../../../../mcp_servers/shared/pricing') as PricingModule;

export const TOLERANCE_VND = pricing.TOLERANCE_VND;
export const DEFAULT_VAT_RATE = pricing.DEFAULT_VAT_RATE;
export const PricingError = pricing.PricingError;

export interface ComputeQuoteInput {
  lines: SalesQuoteLineInput[];
  discountPercent?: number;
  vatRate?: number;
  quoteNumber?: string | null;
  currency?: string;
}

export const computeQuote = (input: ComputeQuoteInput, priceList: unknown): SalesQuote =>
  pricing.computeQuote(input, priceList);

export const validateQuoteMath = (quote: unknown, priceList: unknown): QuoteValidation =>
  pricing.validateQuoteMath(quote, priceList);

export const normalizePriceList = (priceList: unknown): PriceListItem[] =>
  pricing.normalizePriceList(priceList);

export const roundMoney = (value: unknown): number => pricing.roundMoney(value);

/** Kiểm tra một quote rồi ném mã lỗi ổn định — dùng trước khi ghi tệp/gửi nháp. */
export const assertQuoteMath = (quote: unknown, priceList: unknown): QuoteValidation => {
  const validation = validateQuoteMath(quote, priceList);
  if (!validation.valid) {
    const code = validation.code || 'QUOTE_MATH_MISMATCH';
    throw new pricing.PricingError(code, 'Báo giá không khớp phép tính tất định', validation.issues);
  }
  return validation;
};
