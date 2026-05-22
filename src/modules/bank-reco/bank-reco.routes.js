// src/modules/bank-reco/bank-reco.routes.js
const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const svc = require("./bank-reco.service");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const ok   = (res, data) => res.json({ success: true, data });
const fail = (res, err)  => res.status(err.status || 500).json({ success: false, message: err.message || "Lỗi server" });

// GET /api/bank-reco/statements
router.get("/statements", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.listStatements(req.query)); } catch (e) { fail(res, e); }
});

// GET /api/bank-reco/statements/:id/lines
router.get("/statements/:id/lines", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const isMatched = req.query.isMatched !== undefined ? req.query.isMatched === "true" : undefined;
    ok(res, await svc.getStatementLines(req.params.id, { ...req.query, isMatched }));
  } catch (e) { fail(res, e); }
});

// POST /api/bank-reco/statements/import
router.post(
  "/statements/import",
  authenticate,
  authorize("ADMIN", "MANAGER"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) throw { status: 400, message: "Vui lòng upload file sao kê" };
      const { bankAccountId, bank = "VCB" } = req.body;
      if (!bankAccountId) throw { status: 400, message: "bankAccountId là bắt buộc" };
      const stmt = await svc.importStatement(bankAccountId, req.file.buffer, req.file.originalname, bank);
      ok(res, stmt);
    } catch (e) { fail(res, e); }
  },
);

// POST /api/bank-reco/statements/:id/auto-match
router.post("/statements/:id/auto-match", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.autoMatch(req.params.id)); } catch (e) { fail(res, e); }
});

// PATCH /api/bank-reco/lines/:id/match
router.patch("/lines/:id/match", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { entryId } = req.body;
    if (!entryId) throw { status: 400, message: "entryId là bắt buộc" };
    ok(res, await svc.manualMatch(req.params.id, entryId));
  } catch (e) { fail(res, e); }
});

// PATCH /api/bank-reco/lines/:id/unmatch
router.patch("/lines/:id/unmatch", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try { ok(res, await svc.unmatch(req.params.id)); } catch (e) { fail(res, e); }
});

// POST /api/bank-reco/lines/:id/adjustment
router.post("/lines/:id/adjustment", authenticate, authorize("ADMIN"), async (req, res) => {
  try {
    const { bankAccountId, description, amount } = req.body;
    ok(res, await svc.createAdjustmentEntry({
      lineId: req.params.id,
      bankAccountId, description,
      amount: Number(amount),
      userId: req.user.id,
    }));
  } catch (e) { fail(res, e); }
});

module.exports = router;
