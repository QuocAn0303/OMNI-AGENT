const taxReportService = require("../src/modules/tax-report/tax-report.service");

jest.mock("../src/config/prisma", () => ({
  account: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
  journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
  journalLine: { findMany: jest.fn().mockResolvedValue([]) },
  invoice: { findMany: jest.fn().mockResolvedValue([]) },
  einvoice: { findMany: jest.fn().mockResolvedValue([]) },
  order: { findMany: jest.fn().mockResolvedValue([]) },
  purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
  payroll: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn((fn) => fn({})),
}));

jest.mock("exceljs", () => {
  const mockWorksheet = { addRow: jest.fn(), getRow: jest.fn().mockReturnValue({ getCell: jest.fn().mockReturnValue({ value: "" }) }), columns: [] };
  const mockWorkbook = { addWorksheet: jest.fn().mockReturnValue(mockWorksheet), xlsx: { writeBuffer: jest.fn().mockResolvedValue(Buffer.from("test")) } };
  return { Workbook: jest.fn().mockImplementation(() => mockWorkbook) };
});

const prisma = require("../src/config/prisma");

describe("tax-report.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("generateSalesList trả về danh sách bán ra", async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: "inv1", invoiceNo: "HD-001", totalAmount: 100000, status: "PAID", invoiceDate: new Date() },
    ]);
    const result = await taxReportService.generateSalesList(2026, 6);
    expect(result).toBeDefined();
  });

  test("generatePIT trả về báo cáo thuế TNCN", async () => {
    prisma.payroll.findMany.mockResolvedValue([
      { id: "pr1", employeeId: "emp1", grossSalary: 15000000, netSalary: 12000000, finalSalary: 12000000, bhxhEmployee: 0, bhxhEmployer: 0, employee: { user: { fullName: "NV A" } }, year: 2026, month: 6 },
    ]);
    const result = await taxReportService.generatePIT(2026, 6);
    expect(result).toBeDefined();
  });

  test("generatePurchaseList trả về danh sách mua vào", async () => {
    prisma.purchaseOrder.findMany.mockResolvedValue([
      { id: "po1", code: "PO-001", totalAmount: 50000, status: "COMPLETED", vendor: { name: "NCC A", taxCode: "123", address: "HCMC" }, invoiceNumber: "INV-001", receivedAt: new Date(), subtotal: 50000, vatAmount: 5000, createdAt: new Date() },
    ]);
    const result = await taxReportService.generatePurchaseList(2026, 6);
    expect(result).toBeDefined();
  });
});
