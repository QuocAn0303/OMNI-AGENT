const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middleware/auth.middleware");
const vietqrService = require("./vietqr.service");
const { verifyHmacWebhook, verifyBearerWebhook } = require("../../utils/webhookSignature");

// Casso: X-Casso-Signature = HMAC-SHA256(secret, rawBody)
const verifyCasso = (rawBody, signature) =>
  verifyHmacWebhook({
    provider: "Casso",
    secret: process.env.CASSO_WEBHOOK_SECRET,
    rawBody,
    signature,
  });

// SePay: Authorization: Bearer <SEPAY_WEBHOOK_TOKEN>
const verifySePay = (req) =>
  verifyBearerWebhook({
    provider: "SePay",
    token: process.env.SEPAY_WEBHOOK_TOKEN,
    provided: (req.headers.authorization || "").replace(/^Bearer\s+/i, ""),
  });

// Casso webhook (public — verify HMAC-SHA256 qua X-Casso-Signature, raw body từ express.raw trong app.js)
router.post("/webhook/casso", async (req, res, next) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
    const signature = req.headers["x-casso-signature"];
    if (!verifyCasso(rawBody, signature)) {
      return res.status(401).json({ success: false, message: "Chữ ký webhook không hợp lệ" });
    }
    const body = JSON.parse(rawBody);
    const result = await vietqrService.processWebhook(body, "casso", true);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// SePay webhook (public — yêu cầu Authorization: Bearer <SEPAY_WEBHOOK_TOKEN>)
router.post("/webhook/sepay", async (req, res, next) => {
  try {
    if (!verifySePay(req)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = req.body;
    const txn = {
      amount: body.transferAmount || body.amount,
      description: body.description || body.content || "",
      reference: body.referenceCode || body.id || "",
      when: body.transactionDate || body.date,
    };

    const result = await vietqrService.processWebhook(txn, "sepay", true);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// PayOS webhook (public — PayOS uses signature verification in processWebhook)
router.post("/webhook/payos", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    const body = JSON.parse(req.body.toString());
    const result = await vietqrService.processWebhook(body, "payos");
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Internal: manual check pending transactions (yêu cầu đăng nhập — tenant scope tự động qua Payment model)
router.get("/check/:orderId", authenticate, async (req, res, next) => {
  try {
    const payments = await vietqrService.getPendingTransactions({
      orderId: req.params.orderId,
    });
    res.json({ success: true, data: payments });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
