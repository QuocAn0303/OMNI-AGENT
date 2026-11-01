/**
 * modules/agent-gateway/finance.service.js — Dữ liệu + gate cho UC-004.
 *
 * ============================================================================
 * BA LỚP TRÁCH NHIỆM TÁCH RỜI
 * ============================================================================
 * 1. `finance-reconciliation.js` — hàm THUẦN, quyết định phân loại.
 * 2. Tệp này — đọc Prisma (đã được tenant-scope), dựng đề nghị thanh toán và
 *    tạo gate. KHÔNG tự tính lại công thức nào.
 * 3. `finance.routes.js` — HTTP, danh tính lấy từ `req.user`.
 *
 * BẤT BIẾN: số tài khoản nhận tiền trên đề nghị LUÔN đọc từ
 * `Vendor.bankAccount` (master data). Không có nhánh nào lấy STK từ nội dung
 * hoá đơn — hoá đơn là dữ liệu do người ngoài soạn.
 *
 * Hàm:
 * - lookupPurchaseOrder({ poNumber })            → PO + STK chuẩn (null nếu không có)
 * - lookupGrn({ poNumber })                      → luỹ kế `receivedQty` của GRN POSTED
 * - checkDuplicateInvoice({ vendorTaxCode, invoiceNumber }) → lịch sử trên mọi PO
 * - reconcileInvoice({ invoice, poNumber })      → phân loại tất định
 * - createPaymentDraft({ invoice, poNumber, actor }) → nháp `pending_approval`
 * - reconcileAndCreateGate({...})                → nháp + gate PENDING (chỉ khi khớp)
 */
const prisma = require('../../config/prisma');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/apiError');
const { createGatewayGate } = require('./agent-gateway.service');
const { reconcileInvoiceData } = require('./finance-reconciliation');

const INVOICE_ACTION_TYPE = 'INVOICE_3WAY_APPROVAL';

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();

const trimText = (value) => String(value ?? '').trim();

/** STK chuẩn: giữ nguyên chuỗi trong DB, chỉ bỏ khoảng trắng đầu/cuối. */
const canonicalBank = (value) => trimText(value) || null;

/**
 * PO + dòng hàng + STK CHUẨN của NCC.
 *
 * `poCode` là unique toàn cục, nhưng vẫn dùng `findFirst` để extension tenant
 * thêm điều kiện `tenantId` — `findUnique` sẽ bỏ qua scope và rò dữ liệu tenant
 * khác khi trùng mã.
 *
 * @param {{ poNumber: string }} input
 * @returns {Promise<object|null>}
 */
const lookupPurchaseOrder = async ({ poNumber }) => {
  const code = trimText(poNumber);
  if (!code) return null;

  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { poCode: code },
    include: {
      vendor: true,
      items: {
        include: { product: { select: { sku: true, name: true } } },
      },
    },
  });

  if (!purchaseOrder) return null;

  return {
    id: purchaseOrder.id,
    poCode: purchaseOrder.poCode,
    status: purchaseOrder.status,
    vendor: {
      id: purchaseOrder.vendor.id,
      name: purchaseOrder.vendor.name,
      taxCode: purchaseOrder.vendor.taxCode || null,
      // Tên `vendorBankAccount` (không phải `bankAccount`) là CỐ Ý — xem
      // `agents/src/agents/finance/financeContract.ts`.
      vendorBankAccount: canonicalBank(purchaseOrder.vendor.bankAccount),
    },
    items: (purchaseOrder.items || []).map((item) => ({
      sku: item.product?.sku || '',
      name: item.product?.name || '',
      qty: toNumber(item.quantity),
      unitPrice: toNumber(item.unitCost),
    })),
    subtotal: toNumber(purchaseOrder.subtotal),
    taxAmount: toNumber(purchaseOrder.taxAmount),
    total: toNumber(purchaseOrder.total),
  };
};

/**
 * Số lượng thực nhận LUỸ KẾ trên các GRN `POSTED` của PO.
 *
 * Chỉ `POSTED` mới là hàng đã vào kho. GRN `DRAFT`/`CANCELLED` không được dùng
 * làm cơ sở đối chiếu — nếu không, hoá đơn của hàng chưa nhận sẽ "khớp".
 *
 * @param {{ poNumber: string }} input
 * @returns {Promise<{ found: boolean, hasPostedGrn: boolean, lines: object[] }>}
 */
const lookupGrn = async ({ poNumber }) => {
  const code = trimText(poNumber);
  if (!code) return { found: false, hasPostedGrn: false, lines: [] };

  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { poCode: code },
    select: { id: true },
  });
  if (!purchaseOrder) return { found: false, hasPostedGrn: false, lines: [] };

  const grns = await prisma.goodsReceiptNote.findMany({
    where: { purchaseOrderId: purchaseOrder.id },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          receivedQty: true,
          product: { select: { sku: true } },
        },
      },
    },
  });

  const posted = grns.filter((grn) => grn.status === 'POSTED');
  const receivedBySku = new Map();

  for (const grn of posted) {
    for (const item of grn.items || []) {
      const sku = item.product?.sku;
      if (!sku) continue;
      receivedBySku.set(sku, (receivedBySku.get(sku) || 0) + toNumber(item.receivedQty));
    }
  }

  return {
    // `found` = có bản ghi GRN nào đó; `hasPostedGrn` = có GRN đã vào kho.
    found: grns.length > 0,
    hasPostedGrn: posted.length > 0,
    lines: [...receivedBySku.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sku, receivedQty]) => ({ sku, receivedQty })),
  };
};

/**
 * Lịch sử trùng theo cặp `(vendorTaxCode, invoiceNumber)` trên MỌI PO.
 *
 * Bảng chỉ unique theo `(purchaseOrderId, invoiceNumber)`, nên cùng một số hoá
 * đơn có thể nằm ở hai PO khác nhau. Vì vậy phải lọc thêm MST NCC trong JS;
 * lọc chỉ theo `invoiceNumber` sẽ báo trùng nhầm giữa hai nhà cung cấp.
 *
 * @param {{ vendorTaxCode: string, invoiceNumber: string }} input
 * @returns {Promise<object[]>}
 */
const checkDuplicateInvoice = async ({ vendorTaxCode, invoiceNumber }) => {
  const taxCode = normalizeCode(vendorTaxCode);
  const number = trimText(invoiceNumber);
  if (!taxCode || !number) return [];

  const rows = await prisma.purchaseInvoiceRecord.findMany({
    where: { invoiceNumber: { equals: number, mode: 'insensitive' } },
    include: {
      purchaseOrder: {
        select: {
          poCode: true,
          vendor: { select: { taxCode: true } },
        },
      },
    },
    take: 50,
  });

  return rows
    .filter(
      (row) => normalizeCode(row.purchaseOrder?.vendor?.taxCode) === taxCode,
    )
    .map((row) => ({
      invoiceNumber: row.invoiceNumber,
      vendorTaxCode: row.purchaseOrder?.vendor?.taxCode || null,
      poCode: row.purchaseOrder?.poCode || null,
    }));
};

const resolvePoNumber = (invoice, poNumber) => {
  if (trimText(poNumber)) return trimText(poNumber);
  return isRecord(invoice) ? trimText(invoice.poNumber) : '';
};

/**
 * Nạp đủ ba nguồn dữ liệu rồi chạy bộ đối chiếu tất định.
 *
 * @param {{ invoice: unknown, poNumber?: string }} input
 */
const reconcileInvoice = async ({ invoice, poNumber }) => {
  const targetPoNumber = resolvePoNumber(invoice, poNumber);

  const purchaseOrder = targetPoNumber
    ? await lookupPurchaseOrder({ poNumber: targetPoNumber })
    : null;
  const grn = purchaseOrder
    ? await lookupGrn({ poNumber: targetPoNumber })
    : null;
  const duplicates = isRecord(invoice)
    ? await checkDuplicateInvoice({
      vendorTaxCode: invoice.vendorTaxCode,
      invoiceNumber: invoice.invoiceNumber,
    })
    : [];

  const match = reconcileInvoiceData({ invoice, purchaseOrder, grn, duplicates });

  logger.info(
    `[agent-gateway] finance reconcile po=${targetPoNumber || '-'} `
    + `invoice=${match.invoice?.invoiceNumber || '-'} → ${match.classification}`,
  );

  return { ...match, poNumber: targetPoNumber, purchaseOrder };
};

/**
 * Dựng nháp đề nghị thanh toán. Chỉ gọi khi đã `MATCHED_3WAY`.
 *
 * `bankAccountSource: 'vendor_master'` là dấu hiệu máy đọc được: STK này KHÔNG
 * đến từ hoá đơn. Agent kiểm lại giá trị với PO trước khi xin duyệt.
 */
const buildPaymentDraft = ({ invoice, purchaseOrder }) => ({
  status: 'pending_approval',
  poCode: purchaseOrder.poCode,
  vendorId: purchaseOrder.vendor.id,
  vendorName: purchaseOrder.vendor.name,
  invoiceNumber: invoice.invoiceNumber,
  amount: Math.round(toNumber(invoice.totalAmount)),
  currency: 'VND',
  bankAccount: canonicalBank(purchaseOrder.vendor.vendorBankAccount) || '',
  bankAccountSource: 'vendor_master',
  finalized: false,
});

/**
 * Tạo nháp đề nghị thanh toán — KHÔNG tạo gate.
 *
 * Tách khỏi `reconcileAndCreateGate` để agent có thể dựng nháp rồi tự gọi
 * `POST /gates`; gộp hai việc sẽ tạo hai gate cho cùng một run/node.
 *
 * @param {{ invoice: unknown, poNumber?: string, actor?: object }} input
 */
const createPaymentDraft = async ({ invoice, poNumber, actor }) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const match = await reconcileInvoice({ invoice, poNumber });
  if (match.classification !== 'MATCHED_3WAY' || !match.invoice || !match.purchaseOrder) {
    throw new ApiError(
      409,
      `Không thể tạo đề nghị thanh toán: ${match.classification}`,
      { classification: match.classification, issues: match.issues },
    );
  }

  return buildPaymentDraft({
    invoice: match.invoice,
    purchaseOrder: match.purchaseOrder,
  });
};

/**
 * Đối chiếu + tạo gate `INVOICE_3WAY_APPROVAL` khi và chỉ khi khớp ba bên.
 *
 * Không khớp ⇒ KHÔNG tạo gate, trả `issues` để người dùng sửa chứng từ. Gate
 * chỉ là cửa duyệt cho một khoản đã đối chiếu xong; tạo gate cho hoá đơn sai
 * sẽ biến "chờ duyệt" thành "sắp chi".
 *
 * @param {{
 *   invoice: unknown,
 *   poNumber?: string,
 *   runId: string,
 *   nodeId: string,
 *   summary?: string,
 *   actor: object,
 * }} input
 */
const reconcileAndCreateGate = async ({
  invoice,
  poNumber,
  runId,
  nodeId,
  summary,
  actor,
}) => {
  if (!actor?.userId) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const match = await reconcileInvoice({ invoice, poNumber });
  const invoiceNumber = match.invoice?.invoiceNumber || null;

  if (match.classification !== 'MATCHED_3WAY') {
    logger.warn(
      `[agent-gateway] finance chặn tạo gate: ${match.classification} `
      + `invoice=${invoiceNumber || '-'} issues=${match.issues.map((i) => i.code).join(',')}`,
    );
    return {
      classification: match.classification,
      issues: match.issues,
      invoiceNumber,
      canonicalBankAccount: match.canonicalBankAccount,
      paymentDraft: null,
      gateId: null,
      gateStatus: null,
      reused: false,
    };
  }

  if (!match.purchaseOrder || !match.invoice) {
    // Không thể xảy ra nếu `reconcileInvoiceData` đúng; giữ nhánh để lỗi lập
    // trình không âm thầm tạo gate thiếu dữ liệu.
    throw new ApiError(500, 'Đối chiếu khớp nhưng thiếu dữ liệu PO/hoá đơn');
  }
  if (!trimText(runId) || !trimText(nodeId)) {
    throw new ApiError(400, 'runId và nodeId là bắt buộc để tạo gate duyệt hoá đơn');
  }

  const paymentDraft = buildPaymentDraft({
    invoice: match.invoice,
    purchaseOrder: match.purchaseOrder,
  });

  const { gate, reused } = await createGatewayGate({
    actionType: INVOICE_ACTION_TYPE,
    runId: trimText(runId),
    nodeId: trimText(nodeId),
    summary: trimText(summary)
      || `Đề nghị thanh toán HĐ ${paymentDraft.invoiceNumber} theo ${paymentDraft.poCode}: `
        + `${paymentDraft.amount} VND`,
    details: {
      invoiceNumber: paymentDraft.invoiceNumber,
      poCode: paymentDraft.poCode,
      vendorId: paymentDraft.vendorId,
      vendorName: paymentDraft.vendorName,
      vendorTaxCode: match.purchaseOrder.vendor.taxCode || null,
      bankAccount: paymentDraft.bankAccount,
      paymentDraft,
      classification: match.classification,
    },
    amount: paymentDraft.amount,
    actor,
  });

  return {
    classification: match.classification,
    issues: [],
    invoiceNumber,
    canonicalBankAccount: match.canonicalBankAccount,
    paymentDraft,
    gateId: gate.id,
    gateStatus: gate.status,
    reused,
  };
};

module.exports = {
  INVOICE_ACTION_TYPE,
  lookupPurchaseOrder,
  lookupGrn,
  checkDuplicateInvoice,
  reconcileInvoice,
  buildPaymentDraft,
  createPaymentDraft,
  reconcileAndCreateGate,
};
