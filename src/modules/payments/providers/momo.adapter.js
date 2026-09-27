/**
 * modules/payments/providers/momo.adapter.js — Momo Merchant API adapter
 *
 * Endpoints:
 * - createPayment(orderId, amount) → trả QR/deeplink cho khách quét
 * - queryStatus(orderId) → trạng thái
 * - refund(orderId, amount) → hoàn tiền
 * - verifyWebhook(rawBody, signature) → xác thực HMAC-SHA256 từ Momo
 *
 * Mock mode: khi MOMO_PARTNER_CODE / MOMO_ACCESS_KEY / MOMO_SECRET_KEY thiếu → trả mock
 * (giống einvoice/provider/vnpt.adapter.js pattern)
 */
const crypto = require('crypto');
const ptService = require('../payment-transaction.service');

const PARTNER_CODE = process.env.MOMO_PARTNER_CODE;
const ACCESS_KEY = process.env.MOMO_ACCESS_KEY;
const SECRET_KEY = process.env.MOMO_SECRET_KEY;
const ENDPOINT = process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create';
const NOTIFY_URL = process.env.MOMO_NOTIFY_URL || '';
const RETURN_URL = process.env.MOMO_RETURN_URL || '';

const isConfigured = () => !!(PARTNER_CODE && ACCESS_KEY && SECRET_KEY);

function sign(data) {
  // Momo signature: HMAC-SHA256 của rawSignature string với SECRET_KEY
  const raw = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('&');
  return crypto.createHmac('sha256', SECRET_KEY).update(raw).digest('hex');
}

async function createPayment({ orderId, orderCode, amount, orderInfo }) {
  const requestType = 'captureWallet';
  const extraData = '';
  const requestId = `${orderId}-${Date.now()}`;

  if (!isConfigured()) {
    // Mock mode — trả QR giả lập
    return {
      mock: true,
      orderId,
      payUrl: `momo://mock?orderId=${orderCode}&amount=${amount}`,
      qrCode: `momo_mock_${orderCode}_${amount}`,
      message: 'Momo chưa cấu hình — đang chạy mock mode',
    };
  }

  const params = {
    partnerCode: PARTNER_CODE,
    accessKey: ACCESS_KEY,
    requestId,
    amount: Math.round(amount),
    orderId: orderCode,
    orderInfo: orderInfo || `Thanh toan ${orderCode}`,
    returnUrl: RETURN_URL,
    notifyUrl: NOTIFY_URL,
    extraData,
    requestType,
  };
  params.signature = sign(params);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();

  await ptService.createPending({
    provider: 'MOMO',
    providerTxId: requestId,
    orderId,
    amount,
  });

  return { orderId, payUrl: json.payUrl, qrCode: json.qrCode, raw: json };
}

// Verify webhook từ Momo (gọi trong route POST /webhooks/payment/momo)
function verifyWebhook(body, signature, rawBody) {
  if (!isConfigured()) {
    // Production: reject tất cả webhook khi chưa cấu hình (tránh forge)
    if (process.env.NODE_ENV === 'production') return false;
    // Dev: cho phép test mock webhook
    return true;
  }
  if (!signature) return false;
  const expected = sign(body);
  return expected === signature;
}

// Xử lý webhook thành công
async function handleWebhook(body) {
  if (body.resultCode === 0 || body.status === 0) {
    await ptService.markSuccess(body.requestId || body.orderId, {
      rawResponse: body,
      orderId: body.orderId,
      amount: body.amount,
    });
    return { ok: true, matched: true };
  }
  return { ok: false, matched: false };
}

module.exports = { isConfigured, createPayment, verifyWebhook, handleWebhook };
