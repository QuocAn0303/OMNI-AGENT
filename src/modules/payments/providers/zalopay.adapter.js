/**
 * modules/payments/providers/zalopay.adapter.js — ZaloPay merchant adapter
 *
 * Tạo order ZaloPay + verify webhook (HMAC-SHA256 với key ZALOPAY_KEY1).
 * Mock mode khi ZALOPAY_APP_ID / ZALOPAY_KEY1 thiếu.
 */
const crypto = require('crypto');
const ptService = require('../payment-transaction.service');
const { safeEqual, webhookConfigured } = require('../../../utils/webhookSignature');

const APP_ID = process.env.ZALOPAY_APP_ID;
const KEY1 = process.env.ZALOPAY_KEY1;
const KEY2 = process.env.ZALOPAY_KEY2;
const ENDPOINT = process.env.ZALOPAY_ENDPOINT || 'https://sb-openapi.zalopay.vn/v2/create';

const isConfigured = () => !!(APP_ID && KEY1);

function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

async function createPayment({ orderId, orderCode, amount }) {
  const appTransId = `${new Date().YYMMDD()}_${orderCode}`;
  if (!isConfigured()) {
    return { mock: true, orderId, orderUrl: `zalopay://mock?orderId=${orderCode}&amount=${amount}`, message: 'ZaloPay chưa cấu hình — mock mode' };
  }
  const order = {
    app_id: Number(APP_ID),
    app_trans_id: appTransId,
    app_user: 'erp',
    amount: Math.round(amount),
    item: JSON.stringify([]),
    embed_data: JSON.stringify({}),
    callback_url: process.env.ZALOPAY_CALLBACK_URL || '',
    description: `Thanh toan ${orderCode}`,
  };
  const data = [APP_ID, appTransId, order.app_user, order.amount, order.timestamp || '', JSON.stringify(order.embed_data), JSON.stringify(order.item)].join('|');
  order.mac = hmacSha256(data, KEY1);

  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) });
  const json = await res.json();
  await ptService.createPending({ provider: 'ZALOPAY', providerTxId: appTransId, orderId, amount });
  return { orderId, orderUrl: json.order_url, raw: json };
}

function verifyWebhook(body, rawBody) {
  // H3: thiếu cấu hình → TỪ CHỐI (không phụ thuộc NODE_ENV). Chỉ dev bật tường
  // minh ALLOW_UNSIGNED_WEBHOOKS=true mới nhận, và cờ bị vô hiệu ở production.
  if (!webhookConfigured('ZaloPay', isConfigured() ? KEY2 : '')) return false;
  if (!isConfigured()) return true;
  if (!body.mac) return false;
  // Dùng rawBody nếu có (chính xác hơn), fallback sang JSON.stringify
  const dataStr = rawBody ? Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody : JSON.stringify(body.data || '');
  // ZaloPay sign trên raw data field, không phải toàn body
  const dataField = body.data || '';
  // M8: constant-time
  return safeEqual(hmacSha256(dataField, KEY2), body.mac);
}

async function handleWebhook(body) {
  if (body.return_code === 1) {
    await ptService.markSuccess(body.app_trans_id, { rawResponse: body, amount: body.amount });
    return { ok: true, return_code: 1 };
  }
  return { ok: false, return_code: 0 };
}

module.exports = { isConfigured, createPayment, verifyWebhook, handleWebhook };

// Helper: Date.YYMMDD
Date.prototype.YYMMDD = function () {
  const yy = String(this.getFullYear()).slice(-2);
  const mm = String(this.getMonth() + 1).padStart(2, '0');
  const dd = String(this.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};
