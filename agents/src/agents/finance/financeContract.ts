/**
 * agents/finance/financeContract.ts — Hợp đồng dữ liệu UC-004 (đối chiếu 3 bên).
 *
 * Tệp này CHỈ chứa kiểu dữ liệu, không import gì. Nhờ vậy cả ba lớp đều dùng
 * chung một định nghĩa mà không tạo vòng phụ thuộc:
 *
 *   - `invoiceValidator.ts`  — logic tất định (không I/O);
 *   - `financeAgent.ts`      — điều phối tool + human-gate;
 *   - `erp/erpClient.ts`     — kiểu dây (wire type) của các endpoint finance.
 *
 * Tên trường `vendorBankAccount` (không phải `bankAccount`) là CỐ Ý: bộ chiếu
 * field mặc định của policy ẩn khoá `bankAccount`, còn STK NCC là dữ liệu nghiệp
 * vụ bắt buộc phải đọc để đối chiếu. Dùng tên riêng giữ cho lời gọi tool không bị
 * cắt mất dữ liệu kiểm soát, kể cả khi actor là ADMIN/EXEC.
 */

export type InvoiceClassification =
  | 'MATCHED_3WAY'
  | 'MATH_ERROR'
  | 'DUPLICATE_INVOICE'
  | 'MISSING_PO_OR_GRN'
  | 'QTY_EXCEEDS_GRN'
  | 'PRICE_MISMATCH'
  | 'PROMPT_INJECTION_DETECTED';

/**
 * Một điểm lệch. `code` ổn định để test/UI bám vào; không chứa nội dung gốc.
 *
 * Với lỗi bảo mật (STK lệch), TUYỆT ĐỐI không đặt số tài khoản vào `actual`/
 * `detail` — thông báo lỗi không được trở thành kênh rò rỉ.
 */
export interface InvoiceIssue {
  code: string;
  field?: string;
  line?: number;
  sku?: string;
  expected?: number;
  actual?: number;
  detail?: string;
}

export interface InvoiceLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/** Hoá đơn đã trích — nội dung do NGƯỜI NGOÀI soạn, luôn là dữ liệu không tin cậy. */
export interface ExtractedInvoice {
  invoiceNumber: string;
  vendorTaxCode: string;
  vendorName: string;
  vendorBankAccount: string;
  issueDate: string;
  poNumber: string;
  items: InvoiceLine[];
  subtotal: number;
  /** Phân số: 0.1 = 10%. */
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  /** Văn bản gốc — bị quét prompt injection trước khi dùng làm context. */
  rawText: string;
}

export interface PurchaseOrderLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface PurchaseOrderVendor {
  id: string;
  name: string;
  taxCode: string | null;
  /**
   * STK CHUẨN lấy từ `Vendor.bankAccount` (master data). Hoá đơn/email không
   * được sửa giá trị này.
   */
  vendorBankAccount: string | null;
}

export interface PurchaseOrderSnapshot {
  id: string;
  poCode: string;
  status: string;
  vendor: PurchaseOrderVendor;
  items: PurchaseOrderLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface GrnLine {
  sku: string;
  receivedQty: number;
}

export interface GrnSnapshot {
  found: boolean;
  hasPostedGrn: boolean;
  lines: GrnLine[];
}

export interface DuplicateInvoiceRef {
  invoiceNumber: string;
  vendorTaxCode: string | null;
  poCode: string | null;
}

export interface ReconcileInput {
  invoice: unknown;
  purchaseOrder: PurchaseOrderSnapshot | null;
  grn: GrnSnapshot | null;
  duplicates: DuplicateInvoiceRef[];
}

export interface ReconcileResult {
  classification: InvoiceClassification;
  issues: InvoiceIssue[];
  invoice: ExtractedInvoice | null;
  canonicalBankAccount: string | null;
  injectionSignals?: string[];
}

export interface PaymentDraft {
  status: string;
  poCode: string;
  vendorId: string;
  vendorName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  /** LUÔN lấy từ `Vendor.bankAccount`, không từ hoá đơn. */
  bankAccount: string;
  bankAccountSource: 'vendor_master';
  finalized: boolean;
}

export interface PaymentDraftRequest {
  invoice: unknown;
  /** Bỏ trống thì lấy `invoice.poNumber`. */
  poNumber?: string;
}
