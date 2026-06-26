const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middleware/auth.middleware");
const vietqrService = require("./vietqr.service");

// Casso webhook (public — no auth needed, Casso sends signature header)
router.post("/webhook/casso", async (req, res, next) => {
  try {
    const result = await vietqrService.processWebhook(req.body, "casso");
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// SePay webhook (public — SePay sends Authorization header)
router.post("/webhook/sepay", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const sepayToken = process.env.SEPAY_WEBHOOK_TOKEN;
    if (sepayToken && (!authHeader || authHeader !== `Bearer ${sepayToken}`)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = req.body;
    const txn = {
      amount: body.transferAmount || body.amount,
      description: body.description || body.content || "",
      reference: body.referenceCode || body.id || "",
      when: body.transactionDate || body.date,
    };

    const result = await vietqrService.processWebhook(txn, "sepay");
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

// Internal: manual check pending transactions
router.get("/check/:orderId", async (req, res, next) => {
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
