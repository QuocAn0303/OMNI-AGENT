const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middleware/auth.middleware");
const vietqrService = require("./vietqr.service");
const logger = require("../../utils/logger");

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

// Casso: X-Casso-Signature = HMAC-SHA256(secret, rawBody)
const verifyCasso = (rawBody, signature) => {
  const secret = process.env.CASSO_WEBHOOK_SECRET || "";
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    logger.warn("[vietqr] CASSO_WEBHOOK_SECRET chưa cấu hình — chấp nhận webhook ở môi trường dev (tránh forge khi production)");
    return true;
  }
  if (!signature || !rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
};

// SePay: Authorization: Bearer <SEPAY_WEBHOOK_TOKEN>
const verifySePay = (req) => {
  const token = process.env.SEPAY_WEBHOOK_TOKEN || "";
  if (!token) {
    if (process.env.NODE_ENV === "production") return false;
    logger.warn("[vietqr] SEPAY_WEBHOOK_TOKEN chưa cấu hình — chấp nhận webhook ở môi trường dev (tránh forge khi production)");
    return true;
  }
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided) return false;
  return safeEqual(token, provided);
};

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
