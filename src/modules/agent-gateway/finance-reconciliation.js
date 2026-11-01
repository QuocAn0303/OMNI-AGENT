/**
 * modules/agent-gateway/finance-reconciliation.js — Đối chiếu 3 bên TẤT ĐỊNH (phía server).
 *
 * ============================================================================
 * VÌ SAO CÓ BẢN SONG SONG VỚI `agents/src/agents/finance/invoiceValidator.ts`
 * ============================================================================
 * Package `agents/` là TypeScript và KHÔNG được require Prisma; module này là
 * JavaScript chạy trong backend. Hai bên không import được nhau qua biên giới
 * build. Vì vậy phần đối chiếu được viết HAI lần với CÙNG bộ mã lỗi
 * (`line_amount_mismatch`, `qty_exceeds_grn`, ...) và cùng thứ tự phân loại.
 *
 * Khác biệt CÓ CHỦ Ý: server KHÔNG quét `rawText` để tìm prompt injection —
 * nội dung hoá đơn do người ngoài soạn, còn server chỉ có một lớp chống đổi STK
 * ở tầng dữ liệu (`bank_account_mismatch`). Agent (TypeScript) quét thêm
 * `rawText`; hai lớp bổ sung nhau, không thay nhau.
 *
 * Hàm ở đây THUẦN: không Prisma, không mạng, không fs.
 */

const MATH_TOLERANCE_VND = 1;
const PRICE_TOLERANCE_PCT = 0.01;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();
const normalizeBankAccount = (value) => String(value ?? '').replace(/[\s.-]/g, '');
const schemaIssue = (field) => ({ code: `schema_invalid:${field}`, field });

/**
 * Kiểm schema. Trả lỗi (không ném) để route còn phân loại được `MATH_ERROR`.
 * @param {unknown} raw
 * @returns {{ valid: boolean, issues: object[], invoice: object|null }}
 */
const validateInvoiceSchema = (raw) => {
  if (!isRecord(raw)) {
    return { valid: false, issues: [schemaIssue('invoice')], invoice: null };
  }

  const issues = [];

  const readText = (field) => {
    const value = raw[field];
    if (!isNonEmptyString(value)) {
      issues.push(schemaIssue(field));
      return '';
    }
    return value.trim();
  };

  const readNumber = (field, min, max) => {
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
  const items = [];

  if (!Array.isArray(itemsValue) || itemsValue.length === 0) {
    issues.push(schemaIssue('items'));
  } else {
    itemsValue.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push({ code: `schema_invalid:items[${index}]`, line: index + 1 });
        return;
      }

      const issuesBefore = issues.length;
      if (!isNonEmptyString(entry.sku)) issues.push(schemaIssue(`items[${index}].sku`));
      if (!isNonEmptyString(entry.name)) issues.push(schemaIssue(`items[${index}].name`));
      if (!isFiniteNumber(entry.qty) || entry.qty <= 0) {
        issues.push(schemaIssue(`items[${index}].qty`));
      }
      if (!isFiniteNumber(entry.unitPrice) || entry.unitPrice < 0) {
        issues.push(schemaIssue(`items[${index}].unitPrice`));
      }
      if (!isFiniteNumber(entry.lineTotal) || entry.lineTotal < 0) {
        issues.push(schemaIssue(`items[${index}].lineTotal`));
      }

      if (issues.length === issuesBefore) {
        items.push({
          sku: String(entry.sku).trim(),
          name: String(entry.name).trim(),
          qty: Number(entry.qty),
          unitPrice: Number(entry.unitPrice),
          lineTotal: Number(entry.lineTotal),
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

/** Bốn tầng số học: dòng → tổng dòng → thuế → tổng thanh toán. Sai số ≤ 1 đồng. */
const checkInvoiceMath = (invoice) => {
  const issues = [];

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
    issues.push({ code: 'subtotal_mismatch', expected: lineSum, actual: invoice.subtotal });
  }

  const expectedVat = Math.round(invoice.subtotal * invoice.vatRate);
  if (Math.abs(expectedVat - invoice.vatAmount) > MATH_TOLERANCE_VND) {
    issues.push({ code: 'vat_amount_mismatch', expected: expectedVat, actual: invoice.vatAmount });
  }

  const expectedTotal = invoice.subtotal + invoice.vatAmount;
  if (Math.abs(expectedTotal - invoice.totalAmount) > MATH_TOLERANCE_VND) {
    issues.push({ code: 'total_amount_mismatch', expected: expectedTotal, actual: invoice.totalAmount });
  }

  return issues;
};

/** Trùng theo cặp `(vendorTaxCode, invoiceNumber)` trên MỌI PO. */
const checkDuplicateInvoice = (invoice, duplicates) => {
  const taxCode = normalizeCode(invoice.vendorTaxCode);
  const invoiceNumber = normalizeCode(invoice.invoiceNumber);

  const hit = (duplicates || []).find(
    (item) => normalizeCode(item.vendorTaxCode) === taxCode
      && normalizeCode(item.invoiceNumber) === invoiceNumber,
  );

  if (!hit) return [];
  return [{
    code: 'duplicate_invoice',
    detail: hit.poCode ? `existing_po:${hit.poCode}` : 'existing_invoice',
  }];
};

const checkQuantityAgainstGrn = (invoice, grn) => {
  const receivedBySku = new Map();
  for (const line of grn.lines || []) {
    const sku = normalizeCode(line.sku);
    const received = Number(line.receivedQty);
    receivedBySku.set(sku, (receivedBySku.get(sku) || 0) + (Number.isFinite(received) ? received : 0));
  }

  const issues = [];
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

const checkPriceAgainstPo = (invoice, purchaseOrder) => {
  const poBySku = new Map(
    (purchaseOrder.items || []).map((line) => [normalizeCode(line.sku), line]),
  );

  const issues = [];
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

/** STK hoá đơn phải trùng STK master. Không trả số tài khoản trong issue. */
const checkVendorBankAccount = (invoice, purchaseOrder) => {
  const canonical = normalizeBankAccount(purchaseOrder.vendor?.vendorBankAccount);
  if (!canonical) return [{ code: 'vendor_bank_account_missing' }];

  const onInvoice = normalizeBankAccount(invoice.vendorBankAccount);
  if (!onInvoice || onInvoice !== canonical) return [{ code: 'bank_account_mismatch' }];

  return [];
};

const result = (classification, issues, invoice, canonicalBankAccount) => ({
  classification,
  issues,
  invoice,
  canonicalBankAccount,
});

/**
 * Đối chiếu 3 bên phía server.
 *
 * @param {{ invoice: unknown, purchaseOrder: object|null, grn: object|null, duplicates: object[] }} input
 * @returns {{ classification: string, issues: object[], invoice: object|null, canonicalBankAccount: string|null }}
 */
const reconcileInvoiceData = ({ invoice: rawInvoice, purchaseOrder, grn, duplicates }) => {
  const schema = validateInvoiceSchema(rawInvoice);
  const canonicalBankAccount = purchaseOrder?.vendor?.vendorBankAccount ?? null;

  if (!schema.valid || !schema.invoice) {
    return result('MATH_ERROR', schema.issues, null, canonicalBankAccount);
  }

  const invoice = schema.invoice;

  if (purchaseOrder) {
    const bankIssues = checkVendorBankAccount(invoice, purchaseOrder);
    if (bankIssues.length > 0) {
      return result('PROMPT_INJECTION_DETECTED', bankIssues, invoice, canonicalBankAccount);
    }
  }

  const duplicateIssues = checkDuplicateInvoice(invoice, duplicates || []);
  if (duplicateIssues.length > 0) {
    return result('DUPLICATE_INVOICE', duplicateIssues, invoice, canonicalBankAccount);
  }

  if (!purchaseOrder) {
    return result(
      'MISSING_PO_OR_GRN',
      [{ code: 'purchase_order_not_found', detail: invoice.poNumber }],
      invoice,
      canonicalBankAccount,
    );
  }

  const grnUsable = Boolean(grn)
    && grn.found === true
    && grn.hasPostedGrn === true
    && Array.isArray(grn.lines)
    && grn.lines.length > 0;

  if (!grnUsable) {
    return result(
      'MISSING_PO_OR_GRN',
      [{ code: grn?.found ? 'grn_not_posted' : 'grn_not_found' }],
      invoice,
      canonicalBankAccount,
    );
  }

  const mathIssues = checkInvoiceMath(invoice);
  if (mathIssues.length > 0) {
    return result('MATH_ERROR', mathIssues, invoice, canonicalBankAccount);
  }

  const qtyIssues = checkQuantityAgainstGrn(invoice, grn);
  if (qtyIssues.length > 0) {
    return result('QTY_EXCEEDS_GRN', qtyIssues, invoice, canonicalBankAccount);
  }

  const priceIssues = checkPriceAgainstPo(invoice, purchaseOrder);
  if (priceIssues.length > 0) {
    return result('PRICE_MISMATCH', priceIssues, invoice, canonicalBankAccount);
  }

  return result('MATCHED_3WAY', [], invoice, canonicalBankAccount);
};

module.exports = {
  MATH_TOLERANCE_VND,
  PRICE_TOLERANCE_PCT,
  validateInvoiceSchema,
  checkInvoiceMath,
  checkDuplicateInvoice,
  checkQuantityAgainstGrn,
  checkPriceAgainstPo,
  checkVendorBankAccount,
  reconcileInvoiceData,
};
