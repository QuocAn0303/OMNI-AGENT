/**
 * modules/agent-gateway/sales.routes.js — HTTP cho UC-005 (Sales CRM + báo giá).
 *
 * Mount BÊN TRONG `agent-gateway.routes.js`, sau `authenticate`, nên `req.user`
 * luôn là danh tính đã xác thực và tenant context đã được đặt. Không route nào
 * đọc `role`/`department`/`tenantId` từ body.
 *
 * Route:
 *   POST /customers/search   → tìm khách (chuẩn hoá SĐT/email/tên)
 *   POST /customers/upsert   → tạo/cập nhật chống trùng, trả CUSTOMER_AMBIGUOUS
 *   POST /deals/update       → cập nhật deal (không có route xoá)
 *   POST /price-list         → bảng giá chuẩn
 *   POST /quotes             → báo giá; >10% tạo gate QUOTE_DISCOUNT_APPROVAL
 *   POST /quote-drafts       → chốt sau gate APPROVED, lưu email nháp
 *   GET  /quotes/:id         → đọc báo giá/nháp đã lưu
 */
const express = require('express');

const { success, created } = require('../../utils/response');
const ApiError = require('../../utils/apiError');
const service = require('./agent-gateway.service');
const sales = require('./sales.service');

const router = express.Router();

const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
  ? req.body
  : {});

const requireText = (value, field) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ApiError(400, `${field} là bắt buộc`);
  return text;
};

const actorOf = (req, runId = null) => service.getAuthContext({ userId: req.user.id, runId });

// ─────────────────────────────────────────────────────────────────────────────
// CRM
// ─────────────────────────────────────────────────────────────────────────────

router.post('/customers/search', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const data = await sales.searchCustomers({
      query: body.query ? String(body.query) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      email: body.email ? String(body.email) : undefined,
      limit: body.limit,
    });
    return success(res, data, `Tìm thấy ${data.total} khách hàng`);
  } catch (e) {
    return next(e);
  }
});

router.post('/customers/upsert', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const data = await sales.upsertCustomer({
      customer: body.customer,
      actorRole: actor.role,
      idempotencyKey: body.idempotencyKey
        ? String(body.idempotencyKey)
        : `${actor.runId}:customer-upsert:${body.customer?.phone || body.customer?.email || body.customer?.name || ''}`,
    });

    const message = data.status === 'CUSTOMER_AMBIGUOUS'
      ? 'Tên gần giống khách hàng đã có — cần xác nhận'
      : data.status === 'CREATED'
        ? 'Đã tạo khách hàng'
        : 'Đã cập nhật khách hàng hiện có (chống trùng)';

    if (data.status === 'CREATED') return created(res, data, message);
    return success(res, data, message);
  } catch (e) {
    return next(e);
  }
});

router.post('/deals/update', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const actor = await actorOf(req, body.runId ? String(body.runId) : null);
    const dealId = requireText(body.dealId, 'dealId');
    const data = await sales.updateDeal({
      dealId,
      patch: body.patch,
      actorRole: actor.role,
      idempotencyKey: body.idempotencyKey
        ? String(body.idempotencyKey)
        : `${actor.runId}:deal-update:${dealId}`,
    });
    return success(res, data, 'Đã cập nhật deal');
  } catch (e) {
    return next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bảng giá + báo giá
// ─────────────────────────────────────────────────────────────────────────────

router.post('/price-list', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const data = await sales.readPriceList({
      priceListId: body.priceListId ? String(body.priceListId) : undefined,
    });
    return success(res, data, 'Bảng giá chuẩn');
  } catch (e) {
    return next(e);
  }
});

router.post('/quotes', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const runId = body.runId ? String(body.runId) : '';
    const actor = await actorOf(req, runId || null);

    const data = await sales.createQuote({
      runId,
      nodeId: body.nodeId ? String(body.nodeId) : '',
      customer: body.customer,
      lines: body.lines,
      discountPercent: body.discountPercent,
      vatRate: body.vatRate,
      quoteNumber: body.quoteNumber,
      dealId: body.dealId ? String(body.dealId) : undefined,
      email: body.email,
      priceListId: body.priceListId ? String(body.priceListId) : undefined,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      actor,
    });

    if (data.status === 'PENDING_APPROVAL') {
      return created(res, data, data.reused
        ? 'Chiết khấu vượt hạn mức — dùng lại gate đã tạo (idempotent)'
        : 'Chiết khấu vượt hạn mức — đã tạo gate chờ duyệt, chưa tạo nháp');
    }
    return created(res, data, 'Đã tạo báo giá và thư nháp');
  } catch (e) {
    return next(e);
  }
});

router.post('/quote-drafts', async (req, res, next) => {
  try {
    const body = bodyOf(req);
    const gateId = requireText(body.gateId, 'gateId');
    const runId = body.runId ? String(body.runId) : '';
    const actor = await actorOf(req, runId || null);

    const data = await sales.finalizeApprovedQuote({
      gateId,
      runId,
      nodeId: body.nodeId ? String(body.nodeId) : '',
      quote: body.quote,
      lines: body.lines,
      discountPercent: body.discountPercent,
      vatRate: body.vatRate,
      quoteNumber: body.quoteNumber,
      priceListId: body.priceListId ? String(body.priceListId) : undefined,
      customer: body.customer,
      dealId: body.dealId ? String(body.dealId) : undefined,
      email: body.email,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      actor,
    });

    return created(res, data, 'Gate đã duyệt — đã tạo báo giá và thư nháp');
  } catch (e) {
    return next(e);
  }
});

router.get('/quotes/:id', async (req, res, next) => {
  try {
    const actor = await actorOf(req);
    const data = await sales.getQuoteDraft({ id: req.params.id, actor });
    return success(res, data, 'Chi tiết báo giá/nháp');
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
