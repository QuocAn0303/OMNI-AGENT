/**
 * modules/agent-gateway/finance.routes.js — HTTP cho UC-004 (đối chiếu 3 bên).
 *
 * Toàn bộ nhóm route này được mount BÊN TRONG `agent-gateway.routes.js`, sau
 * `router.use(authenticate)`. Nhờ vậy:
 *   - `req.user` luôn tồn tại và là danh tính đã xác thực;
 *   - tenant context (AsyncLocalStorage) đã được đặt → mọi query Prisma tự lọc
 *     `tenantId`, không cần (và không được) đọc `tenantId` từ body.
 *
 * Route:
 *   POST /po/lookup                 → PO + STK chuẩn của NCC
 *   POST /grn/lookup                → luỹ kế số lượng nhận trên GRN POSTED
 *   POST /invoice/check-duplicate   → lịch sử trùng (MST, số hoá đơn)
 *   POST /payment-drafts            → nháp đề nghị thanh toán (KHÔNG tạo gate)
 *   POST /reconcile-invoice         → đối chiếu + tạo gate khi MATCHED_3WAY
 */
const express = require('express');

const { success, created } = require('../../utils/response');
const ApiError = require('../../utils/apiError');
const service = require('./agent-gateway.service');
const finance = require('./finance.service');

const router = express.Router();

const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
  ? req.body
  : {});

const requireText = (value, field) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ApiError(400, `${field} là bắt buộc`);
  return text;
};

const requireInvoice = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invoice là bắt buộc (object đã trích từ hoá đơn)');
  }
  return value;
};

const actorOf = (req, runId = null) => service.getAuthContext({ userId: req.user.id, runId });

// ─────────────────────────────────────────────────────────────────────────────
// Dữ liệu đối chiếu (chỉ đọc)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/po/lookup', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const poNumber = requireText(body.poNumber, 'poNumber');
    const data = await finance.lookupPurchaseOrder({ poNumber });
    return success(res, data, data ? 'Thông tin đơn mua hàng' : 'Không tìm thấy đơn mua hàng');
  } catch (e) {
    return next(e);
  }
});

router.post('/grn/lookup', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const poNumber = requireText(body.poNumber, 'poNumber');
    const data = await finance.lookupGrn({ poNumber });
    return success(res, data, 'Số lượng thực nhận trên GRN POSTED');
  } catch (e) {
    return next(e);
  }
});

router.post('/invoice/check-duplicate', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const vendorTaxCode = requireText(body.vendorTaxCode, 'vendorTaxCode');
    const invoiceNumber = requireText(body.invoiceNumber, 'invoiceNumber');
    const data = await finance.checkDuplicateInvoice({ vendorTaxCode, invoiceNumber });
    return success(res, data, data.length > 0 ? 'Phát hiện hoá đơn trùng' : 'Không có hoá đơn trùng');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Đề nghị thanh toán + gate duyệt
// ─────────────────────────────────────────────────────────────────────────────

router.post('/payment-drafts', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const invoice = requireInvoice(body.invoice);
    const actor = await actorOf(req);
    const data = await finance.createPaymentDraft({
      invoice,
      poNumber: body.poNumber ? String(body.poNumber) : undefined,
      actor,
    });
    return created(res, data, 'Đã tạo nháp đề nghị thanh toán');
  } catch (e) {
    return next(e);
  }
});

router.post('/reconcile-invoice', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const invoice = requireInvoice(body.invoice);
    const runId = body.runId ? String(body.runId) : '';
    const actor = await actorOf(req, runId || null);

    const data = await finance.reconcileAndCreateGate({
      invoice,
      poNumber: body.poNumber ? String(body.poNumber) : undefined,
      runId,
      nodeId: body.nodeId ? String(body.nodeId) : '',
      summary: body.summary ? String(body.summary) : '',
      actor,
    });

    if (data.gateId) {
      return created(res, data, data.reused
        ? 'Đối chiếu khớp — dùng lại gate đã tạo (idempotent)'
        : 'Đối chiếu khớp — đã tạo gate chờ duyệt');
    }
    return success(res, data, `Đối chiếu không khớp: ${data.classification}`);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
