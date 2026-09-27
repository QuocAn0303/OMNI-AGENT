/**
 * modules/accounting/purchase-invoice.service.js — Hoá đơn NCC + 3-Way Matching (Mục 6.2–6.3)
 *
 * Logic đối soát (dung sai ±1% — TOLERANCE):
 *   poAmount  = PurchaseOrder.total (tham chiếu)
 *   grnAmount = Σ (GoodsReceiptItem.passQty × PurchaseItem.unitCost) của các GRN POSTED
 *   invAmount = PurchaseInvoiceRecord.invoiceAmount
 *   variance  = |invAmount - grnAmount| / grnAmount
 *   - grnAmount = 0            → giữ PENDING (chưa nhận hàng, chưa đối soát được)
 *   - variance <= 1%           → MATCHED  → tạo Debt PAYABLE qua debtService
 *                                (createPayableForPoInTx — idempotent, nối đúng
 *                                autopost bút toán, KHÔNG insert thẳng bảng Debt)
 *   - variance > 1%            → VARIANCE_HOLD → CHẶN thanh toán + Notification
 *                                cho ADMIN/ACCOUNTANT
 *   - APPROVED_OVERRIDE        → ADMIN chấp nhận lệch có kiểm soát → vẫn tạo Debt
 *
 * Route: POST /api/purchase-invoices (ghi nhận HĐ NCC, tự match nếu đã có GRN POSTED),
 * POST /:id/match (đối soát thủ công), POST /:id/approve-override (ADMIN).
 */
const prisma = require("../../config/prisma");
const debtService = require("../debt/debt.service");
const notificationService = require("../notifications/notification.service");
const auditService = require("../audit/audit.service");
const logger = require("../../utils/logger");

const TOLERANCE = 0.01; // ±1%

const toNum = (v) => Number(v || 0);
const round2 = (v) => Math.round(v * 100) / 100;

// grnAmount = Σ passQty × unitCost của các GRN POSTED cho PO
const computeGrnAmount = async (purchaseOrderId, client = prisma) => {
  const rows = await client.goodsReceiptItem.findMany({
    where: { grn: { purchaseOrderId, status: "POSTED" } },
    include: { purchaseItem: { select: { unitCost: true } } },
  });
  return rows.reduce((sum, r) => sum + toNum(r.purchaseItem?.unitCost) * r.passQty, 0);
};

// Tính variance từ 2 số tiền — hàm thuần để test đúng biên ±1%
const evaluateVariance = (invoiceAmount, grnAmount, tolerance = TOLERANCE) => {
  if (!grnAmount || grnAmount <= 0) {
    return { status: "PENDING", varianceAmount: null, variancePct: null };
  }
  const varianceAmount = round2(Math.abs(toNum(invoiceAmount) - grnAmount));
  const variancePct = varianceAmount / grnAmount;
  return {
    status: variancePct <= tolerance ? "MATCHED" : "VARIANCE_HOLD",
    varianceAmount,
    variancePct: Math.round(variancePct * 10000) / 10000,
  };
};

// Tạo công nợ phải trả khi MATCHED — nối đúng service Debt (idempotent)
const ensurePayableDebt = async (record, userId) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: record.purchaseOrderId },
    include: { vendor: true },
  });
  if (!po) throw { status: 404, message: "Không tìm thấy PO" };
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.purchaseOrder.findUnique({
      where: { id: po.id },
      include: { vendor: true, items: true },
    });
    const debt = await debtService.createPayableForPoInTx(tx, { po: fresh, userId });
    return debt;
  });
};

// Ghi nhận hoá đơn NCC; nếu đã có GRN POSTED → tự động chạy match
const create = async ({ purchaseOrderId, invoiceNumber, invoiceAmount, invoiceTax = 0 }, userId) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!po) throw { status: 404, message: "Không tìm thấy PO" };

  let record;
  try {
    record = await prisma.purchaseInvoiceRecord.create({
      data: {
        purchaseOrderId,
        invoiceNumber,
        invoiceAmount: toNum(invoiceAmount),
        invoiceTax: toNum(invoiceTax),
        createdById: userId || null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      throw { status: 409, message: `Hoá đơn ${invoiceNumber} của PO này đã được ghi nhận` };
    }
    throw e;
  }

  auditService.log({
    userId,
    action: "CREATE_PURCHASE_INVOICE",
    entity: "PurchaseInvoiceRecord",
    entityId: record.id,
    before: null,
    after: { invoiceNumber, invoiceAmount: record.invoiceAmount, poCode: po.poCode },
  }).catch(() => {});

  // Tự động match nếu đã có GRN POSTED
  const grnAmount = await computeGrnAmount(purchaseOrderId);
  if (grnAmount > 0) {
    return match(record.id, userId);
  }
  return record;
};

// Chạy 3-way matching cho 1 record
const match = async (id, userId) => {
  const record = await prisma.purchaseInvoiceRecord.findUnique({
    where: { id },
    include: { purchaseOrder: true },
  });
  if (!record) throw { status: 404, message: "Không tìm thấy hoá đơn NCC" };
  if (["MATCHED", "APPROVED_OVERRIDE"].includes(record.matchStatus)) return record; // idempotent

  const grnAmount = await computeGrnAmount(record.purchaseOrderId);
  const result = evaluateVariance(record.invoiceAmount, grnAmount);

  if (result.status === "PENDING") {
    // Chưa nhận đủ hàng — chưa đối soát được
    return prisma.purchaseInvoiceRecord.update({
      where: { id },
      data: { matchStatus: "PENDING", varianceAmount: null, variancePct: null, matchedAt: null },
    });
  }

  if (result.status === "MATCHED") {
    const updated = await prisma.purchaseInvoiceRecord.update({
      where: { id },
      data: {
        matchStatus: "MATCHED",
        varianceAmount: result.varianceAmount,
        variancePct: result.variancePct,
        matchedAt: new Date(),
      },
    });
    await ensurePayableDebt(updated, userId).catch((e) =>
      logger.error(`[3way] tạo Debt payable cho record ${id} thất bại:`, e.message),
    );
    auditService.log({
      userId,
      action: "THREE_WAY_MATCH",
      entity: "PurchaseInvoiceRecord",
      entityId: id,
      before: { matchStatus: record.matchStatus },
      after: { matchStatus: "MATCHED", variancePct: result.variancePct },
    }).catch(() => {});
    return updated;
  }

  // VARIANCE_HOLD — chặn thanh toán + cảnh báo
  const updated = await prisma.purchaseInvoiceRecord.update({
    where: { id },
    data: {
      matchStatus: "VARIANCE_HOLD",
      varianceAmount: result.varianceAmount,
      variancePct: result.variancePct,
      matchedAt: null,
    },
  });
  for (const roleScope of ["ADMIN", "ACCOUNTANT"]) {
    await notificationService
      .createOne({
        type: "SYSTEM",
        severity: "CRITICAL",
        roleScope,
        title: `Lệch đối soát 3-way: PO ${record.purchaseOrder.poCode}`,
        message: `HĐ ${record.invoiceNumber} lệch ${(result.variancePct * 100).toFixed(2)}% (dung sai ±1%) — ĐÃ CHẶN thanh toán`,
        link: `/accounting/purchase-orders/${record.purchaseOrderId}`,
        meta: {
          purchaseInvoiceRecordId: id,
          purchaseOrderId: record.purchaseOrderId,
          grnAmount,
          invoiceAmount: toNum(record.invoiceAmount),
        },
      })
      .catch((e) => logger.error("[3way] notification failed:", e.message));
  }
  auditService.log({
    userId,
    action: "THREE_WAY_VARIANCE_HOLD",
    entity: "PurchaseInvoiceRecord",
    entityId: id,
    before: { matchStatus: record.matchStatus },
    after: { matchStatus: "VARIANCE_HOLD", variancePct: result.variancePct },
  }).catch(() => {});
  return updated;
};

// ADMIN chấp nhận lệch có kiểm soát → vẫn tạo công nợ
const approveOverride = async (id, userId) => {
  const record = await prisma.purchaseInvoiceRecord.findUnique({
    where: { id },
    include: { purchaseOrder: true },
  });
  if (!record) throw { status: 404, message: "Không tìm thấy hoá đơn NCC" };
  const updated = await prisma.purchaseInvoiceRecord.update({
    where: { id },
    data: { matchStatus: "APPROVED_OVERRIDE", matchedAt: new Date() },
  });
  await ensurePayableDebt({ ...updated, purchaseOrderId: record.purchaseOrderId }, userId).catch((e) =>
    logger.error(`[3way] tạo Debt payable (override) cho record ${id} thất bại:`, e.message),
  );
  auditService.log({
    userId,
    action: "THREE_WAY_OVERRIDE",
    entity: "PurchaseInvoiceRecord",
    entityId: id,
    before: { matchStatus: record.matchStatus },
    after: { matchStatus: "APPROVED_OVERRIDE" },
  }).catch(() => {});
  return updated;
};

const list = async ({ poId, matchStatus, page = 1, limit = 20 } = {}) => {
  const where = {};
  if (poId) where.purchaseOrderId = poId;
  if (matchStatus) where.matchStatus = matchStatus;
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    prisma.purchaseInvoiceRecord.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
      include: {
        purchaseOrder: {
          select: { id: true, poCode: true, total: true, vendor: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.purchaseInvoiceRecord.count({ where }),
  ]);
  return {
    invoices: items,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const record = await prisma.purchaseInvoiceRecord.findUnique({
    where: { id },
    include: {
      purchaseOrder: { select: { id: true, poCode: true, total: true, vendor: { select: { id: true, name: true } } } },
    },
  });
  if (!record) throw { status: 404, message: "Không tìm thấy hoá đơn NCC" };
  return record;
};

module.exports = {
  create,
  match,
  approveOverride,
  list,
  getById,
  evaluateVariance,
  computeGrnAmount,
  TOLERANCE,
};
