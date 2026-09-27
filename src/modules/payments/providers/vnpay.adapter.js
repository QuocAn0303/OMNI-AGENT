/**
 * modules/payments/providers/vnpay.adapter.js — VNPay QR dynamic (NAPAS)
 *
 * Tạo URL thanh toán VNPay + verify webhook signature (HMAC-SHA512).
 * Mock mode khi VNPAY_TMN_CODE / VNPAY_HASH_SECRET thiếu.
 */
const crypto = require('crypto');
const ptService = require('../payment-transaction.service');

const TMN_CODE = process.env.VNPAY_TMN_CODE;
const HASH_SECRET = process.env.VNPAY_HASH_SECRET;
const PAYMENT_URL = process.env.VNPAY_PAYMENT_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const RETURN_URL = process.env.VNPAY_RETURN_URL || '';

const isConfigured = () => !!(TMN_CODE && HASH_SECRET);

// VNPay dùng HMAC-SHA512, sort key asc, format key=value& (không encode ở bản đơn giản)
function sign(params) {
  const sorted = Object.keys(params).filter((k) => params[k] !== '' && params[k] !== undefined).sort();
  const raw = sorted.map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  return crypto.createHmac('sha512', HASH_SECRET).update(raw).digest('hex');
}

function createPaymentUrl({ orderId, orderCode, amount }) {
  if (!isConfigured()) {
    return { mock: true, paymentUrl: `vnpay://mock?orderId=${orderCode}&amount=${amount}`, message: 'VNPay chưa cấu hình — mock mode' };
  }
  const date = new Date();
  const vnp_TxnRef = orderCode;
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: TMN_CODE,
    vnp_Amount: Math.round(amount) * 100, // VNPay tính theo x100
    vnp_CurrCode: 'VND',
    vnp_TxnRef,
    vnp_OrderInfo: `Thanh toan ${orderCode}`,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: RETURN_URL,
    vnp_CreateDate: date.toISOString().replace(/[-:T]/g, '').slice(0, 14),
    vnp_IpAddr: '127.0.0.1',
  };
  params.vnp_SecureHash = sign(params);
  const paymentUrl = `${PAYMENT_URL}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  return { orderId, paymentUrl, txnRef: vnp_TxnRef };
}

function verifyWebhook(query) {
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') return false;
    return true;
  }
  const secureHash = query.vnp_SecureHash;
  if (!secureHash) return false;
  delete query.vnp_SecureHash;
  delete query.vnp_SecureHashType;
  return sign(query) === secureHash;
}

async function handleWebhook(query) {
  if (query.vnp_ResponseCode === '00') {
    await ptService.markSuccess(query.vnp_TxnRef, {
      rawResponse: query,
      amount: Number(query.vnp_Amount) / 100,
    });
    return { ok: true, matched: true };
  }
  return { ok: false };
}

module.exports = { isConfigured, createPaymentUrl, verifyWebhook, handleWebhook };
