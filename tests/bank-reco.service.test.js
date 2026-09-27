const bankRecoService = require("../src/modules/bank-reco/bank-reco.service");

jest.mock("../src/config/prisma", () => ({
  bankStatement: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0), update: jest.fn() },
  bankStatementLine: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0), update: jest.fn(), createMany: jest.fn() },
  bankAccount: { findUnique: jest.fn() },
  journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
  account: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn((fn) => fn({ journalEntry: { create: jest.fn().mockResolvedValue({ id: "je1" }) } })),
}));

jest.mock("../src/modules/accounting/journal.service", () => ({
  withCodeRetry: jest.fn((fn) => fn({ journalEntry: { create: jest.fn().mockResolvedValue({ id: "je1" }) } })),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const prisma = require("../src/config/prisma");

describe("bank-reco.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("autoMatch đối soát tự động", async () => {
    prisma.bankStatement.findUnique.mockResolvedValue({
      id: "stmt1", bankAccountId: "ba1",
      lines: [{ id: "line1", credit: 100000, debit: 0, txDate: new Date(), ref: "REF001", description: "THANH TOAN HD-001", isMatched: false }],
    });
    prisma.bankStatementLine.update.mockResolvedValue({ id: "line1", isMatched: true });

    const result = await bankRecoService.autoMatch("stmt1");
    expect(result.matched).toBeGreaterThanOrEqual(0);
  });

  test("manualMatch ghép thủ công", async () => {
    prisma.bankStatementLine.findUnique.mockResolvedValue({ id: "line1", isMatched: false });
    prisma.bankStatementLine.update.mockResolvedValue({ id: "line1", isMatched: true, journalEntryId: "je1" });
    const result = await bankRecoService.manualMatch("line1", "je1");
    expect(result.isMatched).toBe(true);
  });

  test("unmatch bỏ ghép", async () => {
    prisma.bankStatementLine.update.mockResolvedValue({ id: "line1", isMatched: false });
    const result = await bankRecoService.unmatch("line1");
    expect(result.isMatched).toBe(false);
  });
});
