/**
 * modules/currency/currency.routes.js — Routes cho tiền tệ & tỷ giá
 * 
 * Tổng quan:
 * - REST API cho currency module
 * - Yêu cầu module "currency" trong plan
 * 
 * Routes:
 * - GET /: Danh sách tiền tệ kèm tỷ giá hiện tại
 * - GET /:code/rates: Lịch sử tỷ giá của một loại tiền
 * - POST /:code/rates: Thiết lập tỷ giá (ADMIN/MANAGER)
 * - POST /: Tạo/cập nhật tiền tệ (ADMIN)
 */
// src/modules/currency/currency.routes.js
const router = require("express").Router();
const { authenticate, requireSuperOmega } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./currency.service");

router.use(authenticate, requireModule("currency"));

// GET /api/currencies — list all with current rates
router.get("/", authenticate, async (req, res, next) => {
  try { res.json({ success: true, data: await svc.getAllCurrentRates() }); }
  catch (e) { next(e); }
});

// GET /api/currencies/:code/rates — rate history
router.get("/:code/rates", authenticate, async (req, res, next) => {
  try {
    const data = await svc.getRateHistory(req.params.code, { limit: req.query.limit });
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/currencies/:code/rates — set exchange rate
// M12: Currency/ExchangeRate là catalog GLOBAL (không tenantId) — tỷ giá tenant A
// ảnh hưởng tenant B. Chỉ nền tảng (SUPER_OMEGA) mới được ghi; tenant chỉ đọc.
router.post("/:code/rates", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const data = await svc.setRate(req.params.code, req.body);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// POST /api/currencies — add / update currency
// M12: catalog tiền tệ GLOBAL → chỉ nền tảng ghi, tenant chỉ đọc
router.post("/", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const data = await svc.upsertCurrency(req.body);
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

module.exports = router;
