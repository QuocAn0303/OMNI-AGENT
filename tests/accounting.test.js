jest.mock("../src/config/prisma", () => {
  const m = {};
  m.$transaction = jest.fn(async (arg) => (typeof arg === "function" ? arg(m) : arg));
  m.account = { findUnique: jest.fn(), findMany: jest.fn() };
  m.journalEntry = { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  m.journalLine = { findMany: jest.fn(), create: jest.fn() };
  m.fiscalPeriod = { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() };
  m.prepaidExpense = {
    findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(),
    create: jest.fn(), update: jest.fn(), count: jest.fn(),
  };
  m.customer = { findMany: jest.fn(), findUnique: jest.fn() };
  m.vendor = { findMany: jest.fn(), findUnique: jest.fn() };
  m.expense = { findMany: jest.fn(), aggregate: jest.fn() };
  return m;
});
jest.mock("../src/modules/accounting/journal.service", () => ({
  postEntry: jest.fn(),
  getAccountBalance: jest.fn(),
}));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn().mockResolvedValue({}) }));

const prisma = require("../src/config/prisma");
const journalService = require("../src/modules/accounting/journal.service");
const {
  closeRevenue, closeExpenses, closeProfitLoss, runPeriodClose,
  createPrepaid, runMonthlyAllocation, calculateCIT,
} = require("../src/modules/accounting/period-close.service");
const {
  trialBalance6Col, generalJournal, accountLedger, subLedger,
  balanceSheetB01, profitAndLossB02,
} = require("../src/modules/accounting/financial-report.service");

describe("accounting — period-close", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe("closeRevenue", () => {
    test("should close all revenue accounts to TK 911", async () => {
      prisma.account.findUnique.mockImplementation(({ where }) => {
        if (["511", "515", "711"].includes(where.code)) return { id: where.code, name: `TK ${where.code}` };
        return null;
      });
      journalService.getAccountBalance.mockResolvedValue({ debit: 0, credit: 10000000 });
      journalService.postEntry.mockResolvedValue({ id: "entry-1" });

      const entries = await closeRevenue({ year: 2026, month: 6, userId: "u1" });
      expect(entries).toHaveLength(3);
      expect(journalService.postEntry).toHaveBeenCalledTimes(3);
    });

    test("should skip accounts with zero balance", async () => {
      prisma.account.findUnique.mockImplementation(({ where }) => {
        if (where.code === "511") return { id: "511", name: "Doanh thu" };
        return null;
      });
      journalService.getAccountBalance.mockResolvedValue({ debit: 0, credit: 0 });
      const entries = await closeRevenue({ year: 2026, month: 6, userId: "u1" });
      expect(entries).toHaveLength(0);
    });
  });

  describe("closeExpenses", () => {
    test("should close expense accounts to TK 911", async () => {
      prisma.account.findUnique.mockImplementation(({ where }) => {
        if (["632", "641", "642"].includes(where.code)) return { id: where.code, name: `TK ${where.code}` };
        return null;
      });
      journalService.getAccountBalance.mockResolvedValue({ debit: 5000000, credit: 0 });
      journalService.postEntry.mockResolvedValue({ id: "entry-1" });

      const entries = await closeExpenses({ year: 2026, month: 6, userId: "u1" });
      expect(entries).toHaveLength(3);
    });
  });

  describe("closeProfitLoss", () => {
    test("should post profit to TK 421", async () => {
      prisma.account.findUnique.mockResolvedValue({ id: "911", name: "Xac dinh KQKD" });
      journalService.getAccountBalance.mockResolvedValue({ debit: 5000000, credit: 15000000 });
      journalService.postEntry.mockResolvedValue({ id: "entry-1" });

      const entry = await closeProfitLoss({ year: 2026, month: 6, userId: "u1" });
      expect(entry).toBeDefined();
      expect(journalService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ accountCode: "911", debit: 10000000 }),
            expect.objectContaining({ accountCode: "421", credit: 10000000 }),
          ]),
        })
      );
    });

    test("should post loss — DR 421 / CR 911", async () => {
      prisma.account.findUnique.mockResolvedValue({ id: "911", name: "Xac dinh KQKD" });
      journalService.getAccountBalance.mockResolvedValue({ debit: 15000000, credit: 5000000 });
      journalService.postEntry.mockResolvedValue({ id: "entry-1" });

      const entry = await closeProfitLoss({ year: 2026, month: 6, userId: "u1" });
      expect(journalService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({ accountCode: "421", debit: 10000000 }),
            expect.objectContaining({ accountCode: "911", credit: 10000000 }),
          ]),
        })
      );
    });

    test("should skip when balance is zero", async () => {
      prisma.account.findUnique.mockResolvedValue({ id: "911", name: "Xac dinh KQKD" });
      journalService.getAccountBalance.mockResolvedValue({ debit: 5000000, credit: 5000000 });
      const entry = await closeProfitLoss({ year: 2026, month: 6, userId: "u1" });
      expect(entry).toBeNull();
    });
  });

  describe("runPeriodClose", () => {
    test("should run full period close sequence", async () => {
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      prisma.account.findUnique.mockImplementation(({ where }) => {
        if (where.code) return { id: where.code, name: `TK ${where.code}` };
        return null;
      });
      journalService.getAccountBalance.mockResolvedValue({ debit: 0, credit: 10000000 });
      journalService.postEntry.mockResolvedValue({ id: "entry-1" });

      const result = await runPeriodClose({ year: 2026, month: 6, userId: "u1" });
      expect(result.revenue).toBeDefined();
      expect(result.expenses).toBeDefined();
      expect(result.profitLoss).toBeDefined();
    });

    test("should reject if already closed", async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({ id: "existing" });
      await expect(
        runPeriodClose({ year: 2026, month: 6, userId: "u1" })
      ).rejects.toEqual(expect.objectContaining({ status: 400 }));
    });
  });
});

describe("accounting — prepaid expenses", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe("createPrepaid", () => {
    test("should create prepaid and post initial entry", async () => {
      prisma.prepaidExpense.create.mockResolvedValue({
        id: "pp1", description: "Thue van phong", amount: 12000000, totalMonths: 12,
        monthlyAmount: 1000000, remainingAmount: 12000000, status: "ACTIVE",
      });
      journalService.postEntry.mockResolvedValue({ id: "entry-1" });

      const result = await createPrepaid("u1", {
        description: "Thue van phong", amount: 12000000, totalMonths: 12,
        startMonth: 1, startYear: 2026, paymentAccountCode: "112",
      });

      expect(result.status).toBe("ACTIVE");
      expect(journalService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "PREPAID",
          lines: expect.arrayContaining([
            expect.objectContaining({ accountCode: "242" }),
            expect.objectContaining({ accountCode: "112" }),
          ]),
        })
      );
    });
  });

  describe("runMonthlyAllocation", () => {
    test("should allocate all active prepaids for the month", async () => {
      prisma.prepaidExpense.findMany.mockResolvedValue([
        { id: "pp1", description: "Thue VP", amount: 12000000, totalMonths: 12,
          monthlyAmount: 1000000, remainingAmount: 11000000, allocatedMonths: 1,
          startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31), status: "ACTIVE" },
      ]);
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      journalService.postEntry.mockResolvedValue({ id: "entry-alloc" });

      const results = await runMonthlyAllocation(2026, 2, "u1");
      expect(results).toHaveLength(1);
      expect(journalService.postEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "PREPAID",
          lines: expect.arrayContaining([
            expect.objectContaining({ accountCode: "642" }),
            expect.objectContaining({ accountCode: "242" }),
          ]),
        })
      );
    });

    test("should skip already allocated months", async () => {
      prisma.prepaidExpense.findMany.mockResolvedValue([
        { id: "pp1", description: "Thue VP", amount: 12000000, totalMonths: 12,
          monthlyAmount: 1000000, remainingAmount: 11000000, allocatedMonths: 1,
          startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31), status: "ACTIVE" },
      ]);
      prisma.journalEntry.findFirst.mockResolvedValue({ id: "existing-alloc" });

      const results = await runMonthlyAllocation(2026, 2, "u1");
      expect(results).toHaveLength(0);
    });
  });
});

describe("accounting — CIT", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test("should calculate CIT at 20% rate", async () => {
    prisma.account.findUnique.mockResolvedValue({ id: "911", name: "Xac dinh KQKD" });
    journalService.getAccountBalance.mockResolvedValue({ debit: 5000000, credit: 55000000 });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    journalService.postEntry.mockResolvedValue({ id: "entry-cit" });

    const result = await calculateCIT({ year: 2026, quarter: 2, userId: "u1" });
    expect(result.citAmount).toBe(10000000);
    expect(journalService.postEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: expect.arrayContaining([
          expect.objectContaining({ accountCode: "821" }),
          expect.objectContaining({ accountCode: "3334" }),
        ]),
      })
    );
  });

  test("should return zero when no profit", async () => {
    prisma.account.findUnique.mockResolvedValue({ id: "911", name: "Xac dinh KQKD" });
    journalService.getAccountBalance.mockResolvedValue({ debit: 50000000, credit: 30000000 });

    const result = await calculateCIT({ year: 2026, quarter: 1, userId: "u1" });
    expect(result.citAmount).toBe(0);
  });
});

describe("accounting — TT200 reports", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe("trialBalance6Col", () => {
    test("should return 6-column format with totals", async () => {
      prisma.account.findMany.mockResolvedValue([
        { id: "a1", code: "111", name: "Tien mat", nameVi: "Tiền mặt", type: "ASSET", normalBalance: "DEBIT" },
        { id: "a2", code: "331", name: "Phai tra NB", nameVi: "Phải trả NB", type: "LIABILITY", normalBalance: "CREDIT" },
      ]);
      journalService.getAccountBalance.mockResolvedValue({ debit: 10000000, credit: 0, balance: 10000000 });

      const result = await trialBalance6Col({ year: 2026, month: 6 });
      expect(result.rows).toHaveLength(2);
      expect(result.totals).toBeDefined();
      expect(result.rows[0]).toHaveProperty("opDebit");
      expect(result.rows[0]).toHaveProperty("periodDebit");
      expect(result.rows[0]).toHaveProperty("clDebit");
    });
  });

  describe("balanceSheetB01", () => {
    test("should return TT200-format balance sheet", async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      prisma.account.findMany.mockResolvedValue([]);
      journalService.getAccountBalance.mockResolvedValue({ debit: 50000000, credit: 0 });

      const result = await balanceSheetB01({ year: 2026, month: 6 });
      expect(result.assets).toBeDefined();
      expect(result.liabilities).toBeDefined();
      expect(result.equity).toBeDefined();
      expect(result.assets.short).toBeDefined();
    });
  });

  describe("profitAndLossB02", () => {
    test("should return TT200-format P&L with 16 line items", async () => {
      prisma.account.findUnique.mockResolvedValue({ id: "acc", name: "Test" });
      journalService.getAccountBalance.mockResolvedValue({ debit: 10000000, credit: 20000000 });

      const result = await profitAndLossB02({ year: 2026, month: 6 });
      expect(result.rows).toHaveLength(16);
      expect(result.rows[0].code).toBe("01");
      expect(result.rows[15].code).toBe("60");
      expect(result.summary.netProfit).toBeDefined();
    });
  });

  describe("generalJournal", () => {
    test("should return flat chronological list", async () => {
      prisma.journalEntry.findMany.mockResolvedValue([
        { id: "j1", entryCode: "JE-001", date: new Date("2026-06-01"), description: "Ban hang", source: "ORDER",
          lines: [
            { id: "l1", debit: 0, credit: 10000000, account: { code: "511", name: "Doanh thu" } },
            { id: "l2", debit: 10000000, credit: 0, account: { code: "131", name: "Phai thu" } },
          ] },
      ]);
      prisma.journalEntry.count.mockResolvedValue(1);

      const result = await generalJournal({ year: 2026, month: 6 });
      expect(result.rows).toHaveLength(2);
    });
  });

  describe("accountLedger", () => {
    test("should return per-account running balance", async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: "131", code: "131", name: "Phai thu KH", nameVi: "Phải thu KH", type: "ASSET", normalBalance: "DEBIT",
      });
      journalService.getAccountBalance.mockResolvedValue({ balance: 5000000 });
      prisma.journalLine.findMany.mockResolvedValue([
        { id: "l1", debit: 3000000, credit: 0,
          entry: { id: "e1", entryCode: "JE-001", date: new Date("2026-06-15"), description: "Ban hang", source: "ORDER",
            lines: [{ id: "l2", debit: 0, credit: 3000000, account: { code: "511", name: "Doanh thu" }, accountId: "511" }] },
          accountId: "131" },
      ]);

      const result = await accountLedger({ accountId: "131", year: 2026, month: 6 });
      expect(result.openingBalance).toBe(5000000);
      expect(result.rows[0].counterpart).toContain("511");
    });
  });

  describe("subLedger", () => {
    test("should return per-party sub-ledger", async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: "131", code: "131", name: "Phai thu KH", nameVi: "Phải thu KH", type: "ASSET", normalBalance: "DEBIT",
      });
      prisma.journalLine.findMany
        .mockResolvedValueOnce([{ debit: 5000000, credit: 0 }])
        .mockResolvedValueOnce([
          { id: "l1", debit: 0, credit: 2000000, partyType: "CUSTOMER", partyId: "c1",
            entry: { id: "e1", entryCode: "JE-002", date: new Date("2026-06-20"), description: "Thu tien", source: "PAYMENT" },
            accountId: "131" },
        ]);
      prisma.customer.findMany.mockResolvedValue([]);

      const result = await subLedger({ accountCode: "131", year: 2026, month: 6 });
      expect(result.account.code).toBe("131");
      expect(result.openingBalance).toBe(5000000);
    });
  });
});
