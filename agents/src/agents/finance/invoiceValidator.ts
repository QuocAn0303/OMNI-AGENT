/**
 * agents/finance/invoiceValidator.ts — Bộ đối chiếu 3 bên TẤT ĐỊNH của UC-004.
 *
 * ============================================================================
 * VÌ SAO KHÔNG GIAO PHÉP TÍNH CHO LLM
 * ============================================================================
 * "100 × 25.000 = 2.500.000" là phép tính kiểm soát tài chính. LLM có thể trả
 * lời trôi chảy và sai một đồng — sai một đồng trong đối chiếu nghĩa là chấp
 * nhận một hoá đơn sai. Mọi phép cộng/nhân/thuế/so sánh ở đây do code chạy;
 * LLM chỉ được diễn giải kết quả đã tính.
 *
 * ============================================================================
 * THỨ TỰ PHÂN LOẠI LÀ NGỮ NGHĨA
 * ============================================================================
 * schema → prompt injection/STK lệch → trùng hoá đơn → thiếu PO/GRN → số học
 * → số lượng → đơn giá → MATCHED_3WAY.
 *
 * Đổi thứ tự sẽ đổi kết quả trả cho người dùng. Ví dụ: một hoá đơn vừa trùng số
 * vừa sai số học phải báo TRÙNG trước — sửa số học không làm nó hết trùng.
 *
 * Hàm ở đây THUẦN: không fs, không mạng, không Prisma. Nhờ vậy test chạy offline
 * và cùng một input luôn cho cùng output.
 */
import { scanPromptInjection } from '../../policy/untrustedContent';
import type {
  DuplicateInvoiceRef,
  ExtractedInvoice,
  GrnSnapshot,
  InvoiceClassification,
  InvoiceIssue,
  InvoiceLine,
  PurchaseOrderSnapshot,
  ReconcileInput,
  ReconcileResult,
} from './financeContract';

export type {
  DuplicateInvoiceRef,
  ExtractedInvoice,
  GrnLine,
  GrnSnapshot,
  InvoiceClassification,
  InvoiceIssue,
  InvoiceLine,
  PaymentDraft,
  PurchaseOrderLine,
  PurchaseOrderSnapshot,
  PurchaseOrderVendor,
  ReconcileInput,
  ReconcileResult,
} from './financeContract';

/** Sai số tuyệt đối cho phép (đồng). Yêu cầu SE373 §4.2: ≤ 1 đồng. */
export const MATH_TOLERANCE_VND = 1;

/** Hoá đơn được phép cao hơn đơn giá PO tối đa 1%. */
export const PRICE_TOLERANCE_PCT = 0.01;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** So khớp mã: bỏ khoảng trắng đầu/cuối, không phân biệt hoa/thường. */
const normalizeCode = (value: unknown): string => String(value ?? '').trim().toUpperCase();

/** STK: bỏ khoảng trắng, dấu chấm, gạch — "0123 456 789" = "0123456789". */
const normalizeBankAccount = (value: unknown): string =>
  String(value ?? '').replace(/[\s.-]/g, '');

const schemaIssue = (field: string): InvoiceIssue => ({
  code: `schema_invalid:${field}`,
  field,
});

export interface InvoiceSchemaValidation {
  valid: boolean;
  issues: InvoiceIssue[];
  invoice: ExtractedInvoice | null;
}

/**
 * Kiểm schema hoá đơn. Trả LỖI (không ném) để agent còn phân loại được là
 * `MATH_ERROR` và hiển thị đúng trường hỏng.
 *
 * `schema_invalid:<field>` là mã ổn định — frontend dùng để tô đỏ đúng ô nhập.
 */
export const validateInvoiceSchema = (raw: unknown): InvoiceSchemaValidation => {
  if (!isRecord(raw)) {
    return { valid: false, issues: [schemaIssue('invoice')], invoice: null };
  }

  const issues: InvoiceIssue[] = [];

  const readText = (field: string): string => {
    const value = raw[field];
    if (!isNonEmptyString(value)) {
      issues.push(schemaIssue(field));
      return '';
    }
    return value.trim();
  };

  const readNumber = (field: string, min?: number, max?: number): number => {
    const value = raw[field];
    if (!isFiniteNumber(value)) {
      issues.push(schemaIssue(field));
      return 0;
    }
    if (min !== undefined && value < min) issues.push(schemaIssue(field));
    if (max !== undefined && value > max) issues.push(schemaIssue(field));
    return value;
  };

  const invoiceNumber = readText('invoiceNumber');
  const vendorTaxCode = readText('vendorTaxCode');
  const vendorName = readText('vendorName');
  const vendorBankAccount = readText('vendorBankAccount');
  const issueDate = readText('issueDate');
  const poNumber = readText('poNumber');

  if (issueDate && Number.isNaN(Date.parse(issueDate))) {
    issues.push(schemaIssue('issueDate'));
  }

  // `rawText` là tuỳ chọn, nhưng nếu có thì phải là chuỗi (không nhận object để
  // tránh né bộ quét chèn lệnh bằng cách gửi mảng/object).
  const rawTextValue = raw.rawText;
  if (rawTextValue !== undefined && typeof rawTextValue !== 'string') {
    issues.push(schemaIssue('rawText'));
  }
  const rawText = typeof rawTextValue === 'string' ? rawTextValue : '';

  const subtotal = readNumber('subtotal', 0);
  const vatRate = readNumber('vatRate', 0, 1);
  const vatAmount = readNumber('vatAmount', 0);
  const totalAmount = readNumber('totalAmount', 0);

  const itemsValue = raw.items;
  const items: InvoiceLine[] = [];

  if (!Array.isArray(itemsValue) || itemsValue.length === 0) {
    issues.push(schemaIssue('items'));
  } else {
    itemsValue.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push({ code: `schema_invalid:items[${index}]`, line: index + 1 });
        return;
      }

      const issuesBefore = issues.length;
      const skuValue = entry.sku;
      const nameValue = entry.name;
      const qtyValue = entry.qty;
      const unitPriceValue = entry.unitPrice;
      const lineTotalValue = entry.lineTotal;

      if (!isNonEmptyString(skuValue)) issues.push(schemaIssue(`items[${index}].sku`));
      if (!isNonEmptyString(nameValue)) issues.push(schemaIssue(`items[${index}].name`));
      if (!isFiniteNumber(qtyValue) || qtyValue <= 0) {
        issues.push(schemaIssue(`items[${index}].qty`));
      }
      if (!isFiniteNumber(unitPriceValue) || unitPriceValue < 0) {
        issues.push(schemaIssue(`items[${index}].unitPrice`));
      }
      if (!isFiniteNumber(lineTotalValue) || lineTotalValue < 0) {
        issues.push(schemaIssue(`items[${index}].lineTotal`));
      }

      if (issues.length === issuesBefore) {
        items.push({
          sku: String(skuValue).trim(),
          name: String(nameValue).trim(),
          qty: Number(qtyValue),
          unitPrice: Number(unitPriceValue),
          lineTotal: Number(lineTotalValue),
        });
      }
    });
  }

  if (issues.length > 0) return { valid: false, issues, invoice: null };

  return {
    valid: true,
    issues: [],
    invoice: {
      invoiceNumber,
      vendorTaxCode,
      vendorName,
      vendorBankAccount,
      issueDate,
      poNumber,
      items,
      subtotal,
      vatRate,
      vatAmount,
      totalAmount,
      rawText,
    },
  };
};

/**
 * Kiểm số học. Mọi so sánh dùng sai số ≤ 1 đồng.
 *
 * Kiểm cả bốn tầng: từng dòng → tổng dòng → thuế → tổng thanh toán. Bỏ tầng nào
 * cũng đủ để một hoá đơn "trông đúng" đi qua.
 */
export const checkInvoiceMath = (invoice: ExtractedInvoice): InvoiceIssue[] => {
  const issues: InvoiceIssue[] = [];

  invoice.items.forEach((line, index) => {
    const expected = line.qty * line.unitPrice;
    if (Math.abs(expected - line.lineTotal) > MATH_TOLERANCE_VND) {
      issues.push({
        code: 'line_amount_mismatch',
        line: index + 1,
        sku: line.sku,
        expected,
        actual: line.lineTotal,
      });
    }
  });

  const lineSum = invoice.items.reduce((total, line) => total + line.lineTotal, 0);
  if (Math.abs(lineSum - invoice.subtotal) > MATH_TOLERANCE_VND) {
    issues.push({
      code: 'subtotal_mismatch',
      expected: lineSum,
      actual: invoice.subtotal,
    });
  }

  const expectedVat = Math.round(invoice.subtotal * invoice.vatRate);
  if (Math.abs(expectedVat - invoice.vatAmount) > MATH_TOLERANCE_VND) {
    issues.push({
      code: 'vat_amount_mismatch',
      expected: expectedVat,
      actual: invoice.vatAmount,
    });
  }

  const expectedTotal = invoice.subtotal + invoice.vatAmount;
  if (Math.abs(expectedTotal - invoice.totalAmount) > MATH_TOLERANCE_VND) {
    issues.push({
      code: 'total_amount_mismatch',
      expected: expectedTotal,
      actual: invoice.totalAmount,
    });
  }

  return issues;
};

/**
 * Trùng hoá đơn theo cặp `(vendorTaxCode, invoiceNumber)` trên MỌI PO.
 *
 * Không có ngoại lệ "cùng PO thì bỏ qua": cùng một số hoá đơn của cùng một NCC
 * đã được ghi nhận là trùng, bất kể nó được gắn vào PO nào.
 */
export const checkDuplicateInvoice = (
  invoice: Pick<ExtractedInvoice, 'vendorTaxCode' | 'invoiceNumber'>,
  duplicates: DuplicateInvoiceRef[],
): InvoiceIssue[] => {
  const taxCode = normalizeCode(invoice.vendorTaxCode);
  const invoiceNumber = normalizeCode(invoice.invoiceNumber);

  const hit = (duplicates || []).find(
    (item) =>
      normalizeCode(item.vendorTaxCode) === taxCode
      && normalizeCode(item.invoiceNumber) === invoiceNumber,
  );

  if (!hit) return [];
  return [{
    code: 'duplicate_invoice',
    detail: hit.poCode ? `existing_po:${hit.poCode}` : 'existing_invoice',
  }];
};

/** Số lượng hoá đơn không được vượt số lượng đã nhận trên GRN `POSTED`. */
export const checkQuantityAgainstGrn = (
  invoice: ExtractedInvoice,
  grn: GrnSnapshot,
): InvoiceIssue[] => {
  const receivedBySku = new Map<string, number>();
  for (const line of grn.lines || []) {
    const sku = normalizeCode(line.sku);
    const received = Number(line.receivedQty);
    receivedBySku.set(sku, (receivedBySku.get(sku) || 0) + (Number.isFinite(received) ? received : 0));
  }

  const issues: InvoiceIssue[] = [];
  invoice.items.forEach((line, index) => {
    const received = receivedBySku.get(normalizeCode(line.sku)) || 0;
    if (line.qty > received) {
      issues.push({
        code: 'qty_exceeds_grn',
        line: index + 1,
        sku: line.sku,
        expected: received,
        actual: line.qty,
      });
    }
  });
  return issues;
};

/**
 * Đơn giá hoá đơn không được cao hơn PO quá 1%.
 *
 * Hoá đơn thấp hơn PO không chặn (NCC giảm giá là hợp lệ); dòng không có trong
 * PO thì không có cơ sở đối chiếu nên bị chặn.
 */
export const checkPriceAgainstPo = (
  invoice: ExtractedInvoice,
  purchaseOrder: PurchaseOrderSnapshot,
): InvoiceIssue[] => {
  const poBySku = new Map(
    (purchaseOrder.items || []).map((line) => [normalizeCode(line.sku), line] as const),
  );

  const issues: InvoiceIssue[] = [];
  invoice.items.forEach((line, index) => {
    const poLine = poBySku.get(normalizeCode(line.sku));
    if (!poLine) {
      issues.push({ code: 'po_line_missing', line: index + 1, sku: line.sku });
      return;
    }

    const limit = poLine.unitPrice * (1 + PRICE_TOLERANCE_PCT);
    if (line.unitPrice > limit) {
      issues.push({
        code: 'price_mismatch',
        line: index + 1,
        sku: line.sku,
        expected: poLine.unitPrice,
        actual: line.unitPrice,
      });
    }
  });
  return issues;
};

/**
 * STK trên hoá đơn phải trùng STK master của NCC.
 *
 * Đây là lớp chống "đổi số tài khoản nhận tiền" ở tầng DỮ LIỆU — không phụ thuộc
 * việc LLM có đọc được câu chèn lệnh hay không. Không trả số tài khoản trong
 * issue để thông báo lỗi không lộ dữ liệu nhạy cảm.
 */
export const checkVendorBankAccount = (
  invoice: ExtractedInvoice,
  purchaseOrder: PurchaseOrderSnapshot,
): InvoiceIssue[] => {
  const canonical = normalizeBankAccount(purchaseOrder.vendor?.vendorBankAccount);
  if (!canonical) return [{ code: 'vendor_bank_account_missing' }];

  const onInvoice = normalizeBankAccount(invoice.vendorBankAccount);
  if (!onInvoice || onInvoice !== canonical) return [{ code: 'bank_account_mismatch' }];

  return [];
};

/** Quét prompt injection trong `rawText` — nội dung hoá đơn là dữ liệu ngoài. */
export const scanInvoiceText = (invoice: Pick<ExtractedInvoice, 'rawText'>) =>
  scanPromptInjection(invoice.rawText || '');

const result = (
  classification: InvoiceClassification,
  issues: InvoiceIssue[],
  invoice: ExtractedInvoice | null,
  canonicalBankAccount: string | null,
  injectionSignals?: string[],
): ReconcileResult => ({
  classification,
  issues,
  invoice,
  canonicalBankAccount,
  ...(injectionSignals && injectionSignals.length > 0 ? { injectionSignals } : {}),
});

/**
 * Đối chiếu 3 bên. Hàm thuần, không gọi mạng — caller chịu trách nhiệm lấy PO,
 * GRN, lịch sử trùng và truyền vào.
 */
export const reconcileInvoice = (input: ReconcileInput): ReconcileResult => {
  const schema = validateInvoiceSchema(input.invoice);
  const purchaseOrder = input.purchaseOrder;
  const canonicalBankAccount = purchaseOrder?.vendor?.vendorBankAccount ?? null;

  // 1) Schema hỏng ⇒ không có gì để đối chiếu.
  if (!schema.valid || !schema.invoice) {
    return result('MATH_ERROR', schema.issues, null, canonicalBankAccount);
  }

  const invoice = schema.invoice;

  // 2) Nội dung hoá đơn chứa chỉ thị — chặn TRƯỚC khi dùng làm context.
  const scan = scanInvoiceText(invoice);
  if (scan.blocked) {
    return result(
      'PROMPT_INJECTION_DETECTED',
      [{ code: 'prompt_injection', detail: scan.signals.join('+') }],
      invoice,
      canonicalBankAccount,
      scan.signals,
    );
  }

  // 3) STK lệch master ⇒ cùng nhóm "nội dung không tin cậy".
  if (purchaseOrder) {
    const bankIssues = checkVendorBankAccount(invoice, purchaseOrder);
    if (bankIssues.length > 0) {
      return result('PROMPT_INJECTION_DETECTED', bankIssues, invoice, canonicalBankAccount);
    }
  }

  // 4) Trùng số hoá đơn.
  const duplicateIssues = checkDuplicateInvoice(invoice, input.duplicates || []);
  if (duplicateIssues.length > 0) {
    return result('DUPLICATE_INVOICE', duplicateIssues, invoice, canonicalBankAccount);
  }

  // 5) Thiếu PO hoặc GRN `POSTED`.
  if (!purchaseOrder) {
    return result(
      'MISSING_PO_OR_GRN',
      [{ code: 'purchase_order_not_found', detail: invoice.poNumber }],
      invoice,
      canonicalBankAccount,
    );
  }

  const grn = input.grn;
  const grnUsable =
    Boolean(grn)
    && grn?.found === true
    && grn?.hasPostedGrn === true
    && Array.isArray(grn?.lines)
    && grn.lines.length > 0;

  if (!grnUsable) {
    return result(
      'MISSING_PO_OR_GRN',
      [{ code: grn?.found ? 'grn_not_posted' : 'grn_not_found' }],
      invoice,
      canonicalBankAccount,
    );
  }

  // 6) Số học.
  const mathIssues = checkInvoiceMath(invoice);
  if (mathIssues.length > 0) {
    return result('MATH_ERROR', mathIssues, invoice, canonicalBankAccount);
  }

  // 7) Số lượng thực nhận.
  const qtyIssues = checkQuantityAgainstGrn(invoice, grn as GrnSnapshot);
  if (qtyIssues.length > 0) {
    return result('QTY_EXCEEDS_GRN', qtyIssues, invoice, canonicalBankAccount);
  }

  // 8) Đơn giá.
  const priceIssues = checkPriceAgainstPo(invoice, purchaseOrder);
  if (priceIssues.length > 0) {
    return result('PRICE_MISMATCH', priceIssues, invoice, canonicalBankAccount);
  }

  return result('MATCHED_3WAY', [], invoice, canonicalBankAccount);
};
