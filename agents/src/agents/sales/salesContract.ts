/**
 * agents/sales/salesContract.ts — Hợp đồng dữ liệu UC-005 (báo giá bán hàng).
 *
 * Tệp CHỈ chứa kiểu dữ liệu, không import Prisma/HTTP. Nhờ vậy ba lớp dùng chung
 * một định nghĩa:
 *   - `pricingEngine.ts` — phép tính tất định;
 *   - `salesAgent.ts` — điều phối MCP + human-gate;
 *   - gateway `sales.service.js` — kiểu dây của endpoint `/sales/*`.
 *
 * Báo giá bán hàng ở đây HOÀN TOÀN tách khỏi `RfqQuotation` của phân hệ mua
 * hàng. Không dùng chung bảng, không dùng chung mã.
 */

export interface SalesQuoteLineInput {
  sku: string;
  qty: number;
}

export interface SalesQuoteLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/** Báo giá đã tính — mọi trường tiền do `pricingEngine` sinh. */
export interface SalesQuote {
  quoteNumber: string | null;
  currency: string;
  lines: SalesQuoteLine[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  netAmount: number;
  /** Phân số: 0.1 = 10%. */
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  computedBy: string;
  schemaVersion: string;
}

export interface QuoteIssue {
  code: string;
  sku?: string;
  field?: string;
  expected?: number;
  actual?: number;
  detail?: string;
  [key: string]: unknown;
}

export interface QuoteValidation {
  valid: boolean;
  code: string | null;
  issues: QuoteIssue[];
}

export interface PriceListItem {
  sku: string;
  name: string;
  unitPrice: number;
  vatRate: number;
  active: boolean;
}

export interface PriceList {
  id: string | null;
  name: string | null;
  items: PriceListItem[];
  total: number;
}

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxCode?: string;
  creditLimit?: number;
}

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address?: string | null;
  taxCode?: string | null;
  creditLimit?: number | null;
  tier?: string | null;
  isActive?: boolean;
  score?: number;
  reasons?: string[];
}

export type CustomerUpsertStatus = 'CREATED' | 'UPDATED' | 'CUSTOMER_AMBIGUOUS';

export interface CustomerUpsertResult {
  status: CustomerUpsertStatus;
  reusedExisting: boolean;
  matchedBy: 'phone' | 'email' | 'name' | null;
  customer: CustomerRecord | null;
  candidates: CustomerRecord[];
  replayed?: boolean;
}

export interface SalesEmailDraft {
  id: string | null;
  to: string;
  subject: string;
  body: string;
  status: 'DRAFT';
  sent: false;
  dealId?: string | null;
  customerId?: string | null;
  quoteId?: string | null;
}

export interface SalesQuoteSheet {
  status: string;
  quote: SalesQuote;
  filePath: string;
  relativePath: string;
  markdownPath?: string;
  validation: QuoteValidation;
}

export type SalesAgentStatus =
  | 'DRAFT_CREATED'
  | 'AWAITING_APPROVAL'
  | 'REJECTED'
  | 'CUSTOMER_AMBIGUOUS'
  | 'PROMPT_INJECTION_DETECTED'
  | 'BLOCKED';

export interface SalesAgentResult {
  status: SalesAgentStatus;
  quote: SalesQuote | null;
  validation: QuoteValidation | null;
  customer: CustomerRecord | null;
  candidates: CustomerRecord[];
  gateId: string | null;
  sheet: SalesQuoteSheet | null;
  draft: SalesEmailDraft | null;
  issues: QuoteIssue[];
  skill: { name: string; version: string };
  runId: string;
}

/** Đầu vào tối thiểu của một lượt báo giá. */
export interface SalesQuoteRequest {
  customer: CustomerInput;
  lines: SalesQuoteLineInput[];
  discountPercent?: number;
  vatRate?: number;
  dealId?: string;
  quoteNumber?: string;
  priceListId?: string;
  /** Nội dung email khách gửi — LUÔN là dữ liệu không tin cậy. */
  emailBody?: string;
  emailId?: string;
  email?: {
    to?: string;
    subject?: string;
    body?: string;
  };
}
