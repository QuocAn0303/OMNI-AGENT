const einvoiceService = require("../src/modules/einvoice/einvoice.service");

jest.mock("../src/config/prisma", () => ({
  electronicInvoice: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  order: { findUnique: jest.fn(), update: jest.fn() },
  integrationConfig: { findFirst: jest.fn() },
  $transaction: jest.fn((fn) => fn({})),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

jest.mock("../src/modules/einvoice/provider/vnpt.adapter", () => ({
  issueInvoice: jest.fn().mockResolvedValue({ invoiceNo: "VNPT001", cqtStatus: "PENDING" }),
  getInvoiceStatus: jest.fn().mockResolvedValue({ cqtStatus: "APPROVED" }),
  cancelInvoice: jest.fn().mockResolvedValue({ rawResponse: "{}" }),
}));

jest.mock("../src/modules/integrations/integration-config.service", () => ({
  get: jest.fn().mockResolvedValue("dummy"),
  set: jest.fn(),
  getMany: jest.fn().mockResolvedValue({}),
}));

const prisma = require("../src/config/prisma");
const vnpt = require("../src/modules/einvoice/provider/vnpt.adapter");

describe("einvoice.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("list returns paginated invoices", async () => {
    prisma.electronicInvoice.findMany.mockResolvedValue([{ id: "e1", invoiceNo: "HDD-001" }]);
    prisma.electronicInvoice.count.mockResolvedValue(1);
    const result = await einvoiceService.list({ page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.pagination).toBeDefined();
  });

  test("getById throws 404 if not found", async () => {
    prisma.electronicInvoice.findUnique.mockResolvedValue(null);
    await expect(einvoiceService.getById("invalid")).rejects.toMatchObject({ status: 404 });
  });

  test("getById returns invoice when found", async () => {
    prisma.electronicInvoice.findUnique.mockResolvedValue({ id: "e1", invoiceNo: "HDD-001" });
    const result = await einvoiceService.getById("e1");
    expect(result.invoiceNo).toBe("HDD-001");
  });

  test("issueForOrder creates invoice from completed order", async () => {
    prisma.electronicInvoice.upsert = jest.fn().mockResolvedValue({ id: "e1", invoiceNo: "VNPT001" });
    prisma.electronicInvoice.count = jest.fn().mockResolvedValue(0);
    prisma.order.findUnique.mockResolvedValue({
      id: "ord1", orderCode: "ORD-001", totalAmount: 100000, status: "COMPLETED",
      paymentMethod: "CASH",
      customer: { name: "Test", taxCode: "" },
      items: [{ product: { name: "SP1", unit: "cai" }, quantity: 1, unitPrice: 100000 }],
    });
    const result = await einvoiceService.issueForOrder("ord1", "user1");
    expect(result).toBeDefined();
    expect(vnpt.issueInvoice).toHaveBeenCalled();
  });

  test("issueForOrder throws if order not found", async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(einvoiceService.issueForOrder("invalid", "user1")).rejects.toMatchObject({ status: 404 });
  });

  test("syncStatus updates status from CQT", async () => {
    prisma.electronicInvoice.findUnique.mockResolvedValue({ id: "e1", invoiceNo: "VNPT001", cqtStatus: "PENDING" });
    prisma.electronicInvoice.update.mockResolvedValue({ id: "e1", cqtStatus: "APPROVED" });
    const result = await einvoiceService.syncStatus("e1");
    expect(result.cqtStatus).toBe("APPROVED");
  });

  test("cancelInvoice cancels invoice", async () => {
    prisma.electronicInvoice.findUnique.mockResolvedValue({ id: "e1", cqtStatus: "PENDING" });
    prisma.electronicInvoice.update.mockResolvedValue({ id: "e1", status: "CANCELLED" });
    const result = await einvoiceService.cancelInvoice("e1", "user1");
    expect(result.status).toBe("CANCELLED");
  });

  test("autoIssueForOrder returns existing if already issued", async () => {
    prisma.electronicInvoice.findUnique.mockResolvedValue({ id: "e1", cqtStatus: "APPROVED" });
    const result = await einvoiceService.autoIssueForOrder("ord1", "user1");
    expect(result).toBeDefined();
    expect(result.id).toBe("e1");
  });
});
