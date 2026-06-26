/**
 * modules/accounting/accounting.routes.js — Định tuyến kế toán tổng hợp
 * 
 * Tổng quan:
 * - File routes chính của module Accounting, định nghĩa tất cả endpoints REST cho:
 *   Chart of Accounts, Journal Entries, Vendors, Expenses, Purchase Orders, Tax, Báo cáo tài chính,
 *   Dashboard founder, Posting Errors và Fiscal Period.
 * - Tích hợp Zod validation, authenticate + authorize + requireModule middleware.
 * - Sử dụng các response helper: success, created, paginated.
 * 
 * Hàm:
 * - GET /accounts: Danh sách tài khoản (accountService.list)
 * - GET /accounts/tree: Cây tài khoản (accountService.tree)
 * - GET /accounts/:id: Chi tiết tài khoản (accountService.getById)
 * - GET /accounts/:id/balance: Số dư tài khoản (accountService.getBalance)
 * - GET/POST /journal: Danh sách / tạo bút toán (journalService.listEntries / postEntry)
 * - POST /journal/:id/reverse: Đảo bút toán (journalService.reverseEntry)
 * - POST /journal/capital-contribution: Ghi nhận góp vốn (autopostService.postCapitalContribution)
 * - CRUD /vendors: Quản lý nhà cung cấp (vendorService)
 * - GET /vendors/:id/debts: Công nợ nhà cung cấp (debtService.listByVendor)
 * - CRUD + workflow /expenses: Quản lý chi phí (expenseService: list, create, submit, approve, markPaid, reject)
 * - CRUD + workflow /purchase-orders: Quản lý đơn nhập hàng (purchaseService: list, create, submit, approve, receive, pay, cancel)
 * - GET /tax-rates, GET /reports/vat: Thuế (taxService)
 * - GET /reports/*: Báo cáo tài chính (reportService: balanceSheet, profitLoss, cashFlow, trialBalance, generalLedger, agingReport)
 * - GET /dashboard: Dashboard founder (founderService.overview)
 * - GET/POST /posting-errors: Lỗi bút toán (postingErrorService: list, retry, dismiss)
 * - GET/POST /fiscal-periods: Kỳ kế toán (fiscalService: list, close, reopen, lock)
 */
// src/modules/accounting/accounting.routes.js
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule, checkFeature } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");

const accountService = require("./account.service");
const journalService = require("./journal.service");
const vendorService = require("./vendor.service");
const expenseService = require("./expense.service");
const purchaseService = require("./purchase.service");
const reportService = require("./financial-report.service");
const taxService = require("./tax.service");
const fiscalService = require("./fiscal-period.service");
const founderService = require("./founder-dashboard.service");
const autopostService = require("./autopost.service");
const postingErrorService = require("./posting-error.service");
const debtService = require("../debt/debt.service");

router.use(authenticate, requireModule("accounting"));

// ==================== CHART OF ACCOUNTS ====================

router.get("/accounts", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = await accountService.list(req.query);
    success(res, data);
  } catch (e) { next(e); }
});

router.get("/accounts/tree", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await accountService.tree());
  } catch (e) { next(e); }
});

router.get("/accounts/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await accountService.getById(req.params.id));
  } catch (e) { next(e); }
});

router.get("/accounts/:id/balance", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await accountService.getBalance(req.params.id, req.query));
  } catch (e) { next(e); }
});

// ==================== JOURNAL ENTRIES ====================

const journalLineSchema = z.object({
  accountCode: z.string().optional(),
  accountId: z.string().optional(),
  debit: z.number().optional(),
  credit: z.number().optional(),
  description: z.string().optional(),
  partyType: z.string().optional(),
  partyId: z.string().optional(),
}).refine((d) => d.accountCode || d.accountId, { message: "Cần accountCode hoặc accountId" });

const manualEntrySchema = z.object({
  date: z.string().optional(),
  description: z.string().min(1),
  lines: z.array(journalLineSchema).min(2),
});

router.get("/journal", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await journalService.listEntries(req.query));
  } catch (e) { next(e); }
});

router.get("/journal/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await journalService.getEntryById(req.params.id));
  } catch (e) { next(e); }
});

router.post("/journal", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = manualEntrySchema.parse(req.body);
    const entry = await journalService.postEntry({
      ...data,
      date: data.date ? new Date(data.date) : new Date(),
      source: "MANUAL",
      userId: req.user.id,
    });
    created(res, entry, "Đã ghi sổ bút toán");
  } catch (e) { next(e); }
});

router.post("/journal/:id/reverse", authorize("ADMIN"), async (req, res, next) => {
  try {
    const reversal = await journalService.reverseEntry(req.params.id, req.user.id);
    created(res, reversal, "Đã đảo bút toán");
  } catch (e) { next(e); }
});

// Quick action: ghi nhận góp vốn
router.post("/journal/capital-contribution", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { amount, method = "BANK_TRANSFER", description } = req.body;
    const entry = await autopostService.postCapitalContribution({
      amount: Number(amount),
      method,
      description: description || "Góp vốn chủ sở hữu",
      userId: req.user.id,
    });
    created(res, entry, "Đã ghi nhận góp vốn");
  } catch (e) { next(e); }
});

// ==================== OPENING BALANCE ====================

const openingBalanceSchema = z.object({
  accountCode: z.string().min(1),
  debit: z.number().optional().default(0),
  credit: z.number().optional().default(0),
  date: z.string().optional(),
  description: z.string().optional(),
});

router.post("/opening-balance", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { accountCode, debit, credit, date, description } = openingBalanceSchema.parse(req.body);
    if (debit <= 0 && credit <= 0) throw { status: 400, message: "Cần nhập số dư Nợ hoặc Có" };

    const entry = await journalService.postEntry({
      date: date ? new Date(date) : new Date(new Date().getFullYear(), 0, 1),
      description: description || `Số dư đầu kỳ TK ${accountCode}`,
      source: "MANUAL",
      sourceId: null,
      operation: `OPENING_BALANCE:${accountCode}:${Date.now()}`,
      userId: req.user.id,
      lines: [
        { accountCode, debit, description: `SDDK TK ${accountCode}` },
        { accountCode: "911", credit: debit || credit, description: "SDDK đối ứng 911" },
      ].filter((l) => l.debit > 0 || l.credit > 0),
    });
    created(res, entry, "Đã ghi nhận số dư đầu kỳ");
  } catch (e) { next(e); }
});

// ==================== VENDORS ====================

const vendorSchema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  taxCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  paymentTerms: z.number().int().nonnegative().optional(),
});

router.get("/vendors", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await vendorService.list(req.query)); }
  catch (e) { next(e); }
});

router.get("/vendors/:id/debts", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await debtService.listByVendor(req.params.id));
  } catch (e) {
    next(e);
  }
});

router.get("/vendors/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await vendorService.getById(req.params.id)); }
  catch (e) { next(e); }
});

router.post("/vendors", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = vendorSchema.parse(req.body);
    created(res, await vendorService.create(data), "Đã tạo nhà cung cấp");
  } catch (e) { next(e); }
});

router.put("/vendors/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = vendorSchema.partial().parse(req.body);
    success(res, await vendorService.update(req.params.id, data), "Đã cập nhật");
  } catch (e) { next(e); }
});

router.delete("/vendors/:id", authorize("ADMIN"), async (req, res, next) => {
  try { success(res, await vendorService.remove(req.params.id), "Đã vô hiệu hóa"); }
  catch (e) { next(e); }
});

// ==================== EXPENSES ====================

const expenseSchema = z.object({
  date: z.string().optional(),
  categoryId: z.string(),
  vendorId: z.string().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  description: z.string().min(2),
  amount: z.number().positive(),
  taxRateId: z.string().optional().nullable(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD"]).optional(),
  bankAccountId: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PAID"]).optional(),
  invoiceNumber: z.string().optional(),
  invoiceUrl: z.string().optional(),
  note: z.string().optional(),
});

router.get("/expenses", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await expenseService.list(req.query));
  } catch (e) { next(e); }
});

router.get("/expense-categories", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await expenseService.listCategories()); }
  catch (e) { next(e); }
});

router.get("/expenses/summary", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await expenseService.summary(req.query)); }
  catch (e) { next(e); }
});

router.get("/expenses/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await expenseService.getById(req.params.id)); }
  catch (e) { next(e); }
});

router.post("/expenses", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const data = expenseSchema.parse(req.body);
    created(res, await expenseService.create(data, req.user.id), "Đã ghi nhận chi phí");
  } catch (e) { next(e); }
});

router.post("/expenses/:id/submit", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try { success(res, await expenseService.submit(req.params.id, req.user.id), "Đã gửi duyệt"); }
  catch (e) { next(e); }
});

router.post("/expenses/:id/approve", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    success(res, await expenseService.approve(req.params.id, req.user.id, { role: req.user.role }), "Đã duyệt");
  } catch (e) { next(e); }
});

router.post("/expenses/:id/mark-paid", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try { success(res, await expenseService.markPaid(req.params.id, req.body || {}, req.user.id), "Đã thanh toán"); }
  catch (e) { next(e); }
});

router.post("/expenses/:id/pay", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try { success(res, await expenseService.markPaid(req.params.id, req.body || {}, req.user.id), "Đã thanh toán"); }
  catch (e) { next(e); }
});

router.post("/expenses/:id/reject", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await expenseService.reject(req.params.id, req.user.id), "Đã từ chối"); }
  catch (e) { next(e); }
});

// ==================== PURCHASE ORDERS ====================

const poSchema = z.object({
  vendorId: z.string(),
  expectedAt: z.string().optional(),
  invoiceNumber: z.string().optional(),
  note: z.string().optional(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
    unitCost: z.number().nonnegative(),
    taxRateId: z.string().optional().nullable(),
  })).min(1),
});

router.get("/purchase-orders", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await purchaseService.list(req.query)); }
  catch (e) { next(e); }
});

router.get("/purchase-orders/:id", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await purchaseService.getById(req.params.id)); }
  catch (e) { next(e); }
});

router.post("/purchase-orders", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try {
    const data = poSchema.parse(req.body);
    created(res, await purchaseService.create(data, req.user.id), "Đã tạo PO");
  } catch (e) { next(e); }
});

router.post("/purchase-orders/:id/submit", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try { success(res, await purchaseService.submit(req.params.id, req.user.id), "Đã gửi duyệt"); }
  catch (e) { next(e); }
});

router.post("/purchase-orders/:id/approve", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await purchaseService.approve(req.params.id, req.user.role, req.user.id), "Đã duyệt"); }
  catch (e) { next(e); }
});

router.post("/purchase-orders/:id/receive", authorize("ADMIN", "MANAGER", "WAREHOUSE"), async (req, res, next) => {
  try { success(res, await purchaseService.receive(req.params.id, req.user.id), "Đã nhập kho"); }
  catch (e) { next(e); }
});

router.post("/purchase-orders/:id/payment", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const { amount, method } = req.body;
    success(res, await purchaseService.pay(req.params.id, { amount: Number(amount), method }, req.user.id), "Đã thanh toán");
  } catch (e) { next(e); }
});

router.post("/purchase-orders/:id/pay", authorize("ADMIN", "MANAGER", "CASHIER"), async (req, res, next) => {
  try {
    const { amount, method } = req.body;
    success(res, await purchaseService.pay(req.params.id, { amount: Number(amount), method }, req.user.id), "Đã thanh toán");
  } catch (e) { next(e); }
});

router.post("/purchase-orders/:id/cancel", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await purchaseService.cancel(req.params.id, req.user.id), "Đã hủy"); }
  catch (e) { next(e); }
});

// ==================== TAX ====================

router.get("/tax-rates", authorize("ADMIN", "MANAGER"), async (_, res, next) => {
  try { success(res, await taxService.list()); } catch (e) { next(e); }
});

router.get("/reports/vat", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await taxService.vatReport(req.query)); }
  catch (e) { next(e); }
});

// ==================== FINANCIAL REPORTS ====================

router.get("/reports/balance-sheet", authorize("ADMIN", "MANAGER"), checkFeature("accountingBalanceSheet"), async (req, res, next) => {
  try { success(res, await reportService.balanceSheet(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/profit-loss", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.profitAndLoss(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/cash-flow", authorize("ADMIN", "MANAGER"), checkFeature("accountingCashFlow"), async (req, res, next) => {
  try { success(res, await reportService.cashFlow(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/trial-balance", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.trialBalance(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/general-ledger", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    if (!req.query.accountId) throw { status: 400, message: "Cần accountId" };
    success(res, await reportService.generalLedger(req.query));
  } catch (e) { next(e); }
});

router.get("/reports/aging", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.agingReport(req.query)); }
  catch (e) { next(e); }
});

// ==================== FOUNDER DASHBOARD ====================

router.get("/dashboard", authorize("ADMIN", "MANAGER"), async (_, res, next) => {
  try { success(res, await founderService.overview()); }
  catch (e) { next(e); }
});

// ==================== POSTING ERRORS (OUTBOX) ====================

router.get("/posting-errors", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await postingErrorService.list(req.query)); }
  catch (e) { next(e); }
});

router.post("/posting-errors/:id/retry", authorize("ADMIN"), async (req, res, next) => {
  try { success(res, await postingErrorService.retry(req.params.id, req.user.id), "Đã retry thành công"); }
  catch (e) { next(e); }
});

router.post("/posting-errors/:id/dismiss", authorize("ADMIN"), async (req, res, next) => {
  try { success(res, await postingErrorService.dismiss(req.params.id), "Đã đánh dấu bỏ qua"); }
  catch (e) { next(e); }
});

// ==================== FISCAL PERIOD ====================

router.get("/fiscal-periods", authorize("ADMIN", "MANAGER"), async (_, res, next) => {
  try { success(res, await fiscalService.list()); } catch (e) { next(e); }
});

router.post("/fiscal-periods/close", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    success(res, await fiscalService.close({ year: Number(year), month: Number(month) }, req.user.id), "Đã đóng kỳ");
  } catch (e) { next(e); }
});

router.post("/fiscal-periods/reopen", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    success(
      res,
      await fiscalService.reopen({ year: Number(year), month: Number(month) }, req.user.id, req.user.role),
      "Đã mở lại kỳ"
    );
  } catch (e) { next(e); }
});

router.post("/fiscal-periods/lock", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    success(
      res,
      await fiscalService.lock({ year: Number(year), month: Number(month) }, req.user.id, req.user.role),
      "Đã khóa kỳ"
    );
  } catch (e) { next(e); }
});

// ==================== PERIOD CLOSE & PREPAID (UPGRADED) ====================

const periodCloseService = require("./period-close.service");

router.post("/fiscal-periods/period-close", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    success(res, await periodCloseService.runPeriodClose({
      year: Number(year), month: Number(month), userId: req.user.id,
    }), "Kết chuyển cuối kỳ thành công");
  } catch (e) { next(e); }
});

router.post("/fiscal-periods/reverse-close", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    success(res, await periodCloseService.reversePeriodClose({
      year: Number(year), month: Number(month), userId: req.user.id,
    }), "Đảo kết chuyển thành công");
  } catch (e) { next(e); }
});

router.post("/depreciation/run", authorize("ADMIN"), async (req, res, next) => {
  try {
    const y = req.body.year || new Date().getFullYear();
    const m = req.body.month || new Date().getMonth() + 1;
    success(res, await periodCloseService.runMonthlyDepreciation(y, m, req.user.id), "Khấu hao thành công");
  } catch (e) { next(e); }
});

router.get("/reports/inventory-valuation", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const y = parseInt(req.query.year) || new Date().getFullYear();
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    success(res, await periodCloseService.inventoryValuation(y, m));
  } catch (e) { next(e); }
});

router.post("/prepaid", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await periodCloseService.createPrepaid(req.user.id, req.body), "Tạo chi phí trả trước thành công"); }
  catch (e) { next(e); }
});

router.post("/prepaid/allocate", authorize("ADMIN"), async (req, res, next) => {
  try {
    const { year, month } = req.body;
    success(res, await periodCloseService.runMonthlyAllocation(
      Number(year || new Date().getFullYear()), Number(month || new Date().getMonth() + 1), req.user.id
    ), "Phân bổ chi phí thành công");
  } catch (e) { next(e); }
});

router.post("/tax/cit", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const { year, quarter } = req.body;
    success(res, await periodCloseService.calculateCIT({
      year: Number(year), quarter: Number(quarter), userId: req.user.id,
    }), "Tính thuế TNDN thành công");
  } catch (e) { next(e); }
});

// ==================== TT200 UPGRADED REPORTS ====================

router.get("/reports/trial-balance-6col", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.trialBalance6Col(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/general-journal", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.generalJournal(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/account-ledger", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.accountLedger(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/sub-ledger", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.subLedger(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/balance-sheet-b01", authorize("ADMIN", "MANAGER"), checkFeature("accountingBalanceSheet"), async (req, res, next) => {
  try { success(res, await reportService.balanceSheetB01(req.query)); }
  catch (e) { next(e); }
});

router.get("/reports/profit-loss-b02", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try { success(res, await reportService.profitAndLossB02(req.query)); }
  catch (e) { next(e); }
});

module.exports = router;
