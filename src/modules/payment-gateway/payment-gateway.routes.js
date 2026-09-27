/**
 * modules/payment-gateway/payment-gateway.routes.js — Unified payment gateway
 *
 * - POST /api/payment-gateway/create  → tạo QR/link (Momo/VNPay/ZaloPay)
 * - GET  /api/payment-gateway/transactions → list
 * - POST /api/payment-gateway/webhooks/momo   (public, verify HMAC)
 * - POST /api/payment-gateway/webhooks/vnpay  (public, verify HMAC)
 * - POST /api/payment-gateway/webhooks/zalopay (public, verify HMAC)
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { sendSuccess } = require('../../utils/response');
const ptService = require('../payments/payment-transaction.service');
const momo = require('../payments/providers/momo.adapter');
const vnpay = require('../payments/providers/vnpay.adapter');
const zalopay = require('../payments/providers/zalopay.adapter');
const { createPayment } = require('./payment-gateway.validation');

// Tạo link thanh toán (yêu cầu auth)
router.post('/create', authenticate, async (req, res, next) => {
  try {
    const { provider, orderId, orderCode, amount } = createPayment.parse(req.body);
    let result;
    if (provider === 'MOMO') result = await momo.createPayment({ orderId, orderCode, amount });
    else if (provider === 'VNPAY') result = vnpay.createPaymentUrl({ orderId, orderCode, amount });
    else if (provider === 'ZALOPAY') result = await zalopay.createPayment({ orderId, orderCode, amount });
    sendSuccess(res, result);
  } catch (e) { next(e); }
});

// List transactions (auth)
router.get('/transactions', authenticate, async (req, res, next) => {
  try { sendSuccess(res, await ptService.list(req.query)); }
  catch (e) { next(e); }
});

// ===== WEBHOOKS (public — verify signature trên RAW body) =====
// app.js đã đăng ký express.raw cho /api/payment-gateway/webhooks
// → req.body là Buffer, cần parse thủ công để verify signature chính xác

router.post('/webhooks/momo', async (req, res, next) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const body = JSON.parse(rawBody);
    const sig = req.headers['signature'] || body.signature;
    if (!momo.verifyWebhook(body, sig, rawBody)) return res.status(400).json({ message: 'Sai signature' });
    const result = await momo.handleWebhook(body);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/webhooks/vnpay', async (req, res, next) => {
  try {
    // VNPay gửi query params cho return URL, body cho IPN
    const query = req.query || {};
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : null;
    const body = rawBody ? JSON.parse(rawBody) : {};
    const params = { ...query, ...body };
    if (!vnpay.verifyWebhook(params)) return res.status(400).json({ message: 'Sai signature' });
    const result = await vnpay.handleWebhook(params);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/webhooks/zalopay', async (req, res, next) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const body = JSON.parse(rawBody);
    if (!zalopay.verifyWebhook(body, rawBody)) return res.status(400).json({ message: 'Sai signature' });
    const result = await zalopay.handleWebhook(body);
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;
