/**
 * modules/bank-reco/bank-reco.routes.js — Routes cho đối soát ngân hàng
 * 
 * Tổng quan:
 * - REST API cho bank-reco module
 * - Yêu cầu module "bank-reco" trong plan
 * - Hỗ trợ upload file sao kê, auto/manual match, tạo adjustment
 * 
 * Routes:
 * - GET /bank-accounts: Danh sách tài khoản ngân hàng
 * - GET /statements: Danh sách sao kê (ADMIN/MANAGER)
 * - GET /statements/:id/lines: Dòng sao kê, lọc theo isMatched (ADMIN/MANAGER)
 * - POST /statements/import: Import file sao kê (ADMIN/MANAGER, upload file)
 * - POST /statements/:id/auto-match: Tự động so khớp (ADMIN/MANAGER)
 * - PATCH /lines/:id/match: Ghép thủ công (ADMIN/MANAGER)
 * - PATCH /lines/:id/unmatch: Huỷ ghép (ADMIN/MANAGER)
 * - POST /lines/:id/adjustment: Tạo bút toán điều chỉnh (ADMIN)
 */
// src/modules/bank-reco/bank-reco.routes.js
const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const prisma  = require("../../config/prisma");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./bank-reco.service");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls) hoặc CSV'));
  },
});
const ok = (res, data) => res.json({ success: true, data });

router.use(requireModule("bank-reco"));

// GET /api/bank-reco/bank-accounts — danh sách TK ngân hàng để chọn khi import sao kê
// L9: thông tin TK ngân hàng là dữ liệu tài chính nhạy cảm — chỉ quản lý/kế toán
router.get("/bank-accounts", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { bankName: "asc" }],
      select: {
        id: true, accountNumber: true, bankName: true, accountName: true,
        currentBalance: true, isDefault: true,
      },
    });
    ok(res, accounts);
  } catch (e) { next(e); }
});

// GET /api/bank-reco/statements
router.get("/statements", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { ok(res, await svc.listStatements(req.query)); } catch (e) { next(e); }
});

// GET /api/bank-reco/statements/:id/lines
router.get("/statements/:id/lines", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const isMatched = req.query.isMatched !== undefined ? req.query.isMatched === "true" : undefined;
    ok(res, await svc.getStatementLines(req.params.id, { ...req.query, isMatched }));
  } catch (e) { next(e); }
});

// POST /api/bank-reco/statements/import
router.post(
  "/statements/import",
  authenticate,
  authorize("ADMIN", "MANAGER", "ACCOUNTANT"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) throw { status: 400, message: "Vui lòng upload file sao kê" };
      const { bankAccountId, bank = "VCB" } = req.body;
      if (!bankAccountId) throw { status: 400, message: "bankAccountId là bắt buộc" };
      const stmt = await svc.importStatement(bankAccountId, req.file.buffer, req.file.originalname, bank);
      ok(res, stmt);
    } catch (e) { next(e); }
  },
);

// POST /api/bank-reco/statements/:id/auto-match
router.post("/statements/:id/auto-match", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { ok(res, await svc.autoMatch(req.params.id)); } catch (e) { next(e); }
});

// PATCH /api/bank-reco/lines/:id/match
router.patch("/lines/:id/match", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { entryId } = req.body;
    if (!entryId) throw { status: 400, message: "entryId là bắt buộc" };
    ok(res, await svc.manualMatch(req.params.id, entryId));
  } catch (e) { next(e); }
});

// PATCH /api/bank-reco/lines/:id/unmatch
router.patch("/lines/:id/unmatch", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { ok(res, await svc.unmatch(req.params.id)); } catch (e) { next(e); }
});

// POST /api/bank-reco/lines/:id/adjustment
router.post("/lines/:id/adjustment", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try {
    const { bankAccountId, description, amount } = req.body;
    ok(res, await svc.createAdjustmentEntry({
      lineId: req.params.id,
      bankAccountId, description,
      amount: Number(amount),
      userId: req.user.id,
    }));
  } catch (e) { next(e); }
});

// GET /api/bank-reco/journal-entries/search — search journal entries for manual matching
router.get("/journal-entries/search", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { q, from, to } = req.query;
    const where = { status: 'POSTED' };
    if (q) {
      where.OR = [
        { entryCode: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (from) where.date = { ...where.date, gte: new Date(from) };
    if (to) where.date = { ...where.date, lte: new Date(to) };

    const entries = await prisma.journalEntry.findMany({
      where,
      select: { id: true, entryCode: true, date: true, description: true, source: true },
      orderBy: { date: 'desc' },
      take: 30,
    });
    ok(res, entries);
  } catch (e) { next(e); }
});

// POST /api/bank-reco/statements/auto-match-all — batch auto-match all imported statements
router.post("/statements/auto-match-all", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const result = await svc.autoMatchAll();
    ok(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
