jest.mock("../src/config/prisma", () => {
  const m = {};
  m.$transaction = jest.fn(async (fn) => fn(m));
  m.inventory = { findMany: jest.fn(), count: jest.fn() };
  m.purchaseItem = { findFirst: jest.fn() };
  m.purchaseOrder = { findFirst: jest.fn(), create: jest.fn(), count: jest.fn(), aggregate: jest.fn() };
  m.product = { findFirst: jest.fn() };
  m.payroll = { findFirst: jest.fn() };
  m.debt = { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn() };
  m.customer = { count: jest.fn(), findFirst: jest.fn() };
  m.customerNote = { create: jest.fn().mockResolvedValue({}) };
  m.notification = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) };
  m.order = { count: jest.fn(), aggregate: jest.fn() };
  m.expense = { aggregate: jest.fn() };
  m.user = { findFirst: jest.fn().mockResolvedValue({ id: "sys-user" }) };
  return m;
});
jest.mock("../src/modules/notifications/notification.service", () => ({ notifyRoles: jest.fn() }));
jest.mock("../src/modules/hr/hr.service", () => ({ generatePayrollForMonth: jest.fn() }));
jest.mock("../src/modules/accounting/journal.service", () => ({ postEntry: jest.fn() }));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));

const prisma = require("../src/config/prisma");
const { checkAutoReorder, autoPayroll, debtAutoCollection, morningBriefing, anomalyDetection } = require("../src/modules/automation/automation.service");
const notif = require("../src/modules/notifications/notification.service");
const hrService = require("../src/modules/hr/hr.service");
const journalService = require("../src/modules/accounting/journal.service");

const MOCK_VENDOR = { id: "v1", name: "Test Vendor", isActive: true };
const MOCK_VENDOR_PO = { vendorId: "v1", vendor: MOCK_VENDOR, date: new Date() };

function setupReorderMock({ quantity = 1, reserved = 0, minStock = 10, sku = "SKU1", costPrice = 10000, isActive = true, quantity2, sku2 } = {}) {
  const items = [
    { productId: "p1", warehouseId: "w1", quantity, reserved, minStock,
      product: { id: "p1", name: "Product A", sku, costPrice, isActive } },
  ];
  if (quantity2 !== undefined) {
    items.push({ productId: "p2", warehouseId: "w1", quantity: quantity2, reserved: 0, minStock: 20,
      product: { id: "p2", name: "Product B", sku: sku2 || "B1", costPrice: 5000, isActive: true } });
  }
  prisma.inventory.findMany.mockResolvedValue(items);
}

describe("automation — advanced scenarios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue({ id: "sys-user" });
  });

  describe("checkAutoReorder — edge cases", () => {
    beforeEach(() => {
      prisma.purchaseItem.findFirst.mockResolvedValue({ purchaseOrder: MOCK_VENDOR_PO });
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      prisma.purchaseOrder.create.mockResolvedValue({ id: "new-po", poCode: "PO-001", vendor: MOCK_VENDOR });
    });

    test("two low-stock products → 2 POs", async () => {
      setupReorderMock({ quantity: 2, minStock: 10, quantity2: 0 });
      await checkAutoReorder(["p1", "p2"], "w1");
      expect(prisma.purchaseOrder.create).toHaveBeenCalledTimes(2);
    });

    test("one low, one OK → only 1 PO", async () => {
      setupReorderMock({ quantity: 1, minStock: 10, quantity2: 100 });
      await checkAutoReorder(["p1", "p2"], "w1");
      expect(prisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
    });

    test("PO creation should include correct quantity (minStock*2)", async () => {
      setupReorderMock({ quantity: 0, minStock: 50 });
      await checkAutoReorder(["p1"], "w1");
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          items: expect.objectContaining({ create: [expect.objectContaining({ quantity: 100 })] }),
        }),
      }));
    });

    test("reserved stock reduces available, triggers reorder", async () => {
      setupReorderMock({ quantity: 20, reserved: 18, minStock: 10 });
      await checkAutoReorder(["p1"], "w1");
      expect(prisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
    });

    test("inactive vendor should skip gracefully", async () => {
      setupReorderMock({ quantity: 1 });
      prisma.purchaseItem.findFirst.mockResolvedValue({
        purchaseOrder: { vendorId: "v1", vendor: { id: "v1", name: "V", isActive: false } },
      });
      await checkAutoReorder(["p1"], "w1");
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    test("exactly at minStock → should trigger reorder", async () => {
      setupReorderMock({ quantity: 10, minStock: 10 });
      await checkAutoReorder(["p1"], "w1");
      expect(prisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
    });

    test("DB failure should be caught, not crash caller", async () => {
      prisma.inventory.findMany.mockRejectedValue(new Error("DB down"));
      let threw = false;
      try { await checkAutoReorder(["p1"], "w1"); } catch { threw = true; }
      expect(threw).toBe(false);
    });
  });

  describe("autoPayroll — edge cases", () => {
    test("skip when payroll already locked", async () => {
      prisma.payroll.findFirst.mockResolvedValue({ id: "ex", isLocked: true });
      await autoPayroll();
      expect(hrService.generatePayrollForMonth).not.toHaveBeenCalled();
    });

    test("skip when zero employees", async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);
      hrService.generatePayrollForMonth.mockResolvedValue([]);
      await autoPayroll();
      expect(journalService.postEntry).not.toHaveBeenCalled();
    });

    test("create journal entries for salary + BHXH + PIT", async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);
      hrService.generatePayrollForMonth.mockResolvedValue([
        { finalSalary: 15000000, bhxhEmployee: 1575000, pitAmount: 500000 },
        { finalSalary: 20000000, bhxhEmployee: 2100000, pitAmount: 1200000 },
      ]);
      await autoPayroll();
      expect(journalService.postEntry).toHaveBeenCalledWith(expect.objectContaining({
        source: "PAYROLL", operation: "PRIMARY",
        lines: expect.arrayContaining([
          expect.objectContaining({ accountCode: "642" }),
          expect.objectContaining({ accountCode: "334" }),
          expect.objectContaining({ accountCode: "338" }),
          expect.objectContaining({ accountCode: "333" }),
        ]),
      }));
    });

    test("HR failure should not throw", async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);
      hrService.generatePayrollForMonth.mockRejectedValue(new Error("HR down"));
      let threw = false;
      try { await autoPayroll(); } catch { threw = true; }
      expect(threw).toBe(false);
    });

    test("notify ADMIN even when journal posting fails", async () => {
      prisma.payroll.findFirst.mockResolvedValue(null);
      hrService.generatePayrollForMonth.mockResolvedValue([{ finalSalary: 10000000, bhxhEmployee: 1050000, pitAmount: 100000 }]);
      journalService.postEntry.mockRejectedValue(new Error("Journal error"));
      await autoPayroll();
      expect(notif.notifyRoles).toHaveBeenCalledWith(["ADMIN"], expect.objectContaining({ type: "PAYROLL_DUE" }));
    });
  });

  describe("debtAutoCollection — edge cases", () => {
    test("30-day overdue flagged with special note", async () => {
      prisma.debt.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: "d-old", amount: 10000000, paidAmount: 0, status: "OPEN", type: "RECEIVABLE", dueDate: new Date(Date.now() - 45 * 86400000), customer: null, vendor: null, note: null },
      ]);
      prisma.notification.findFirst.mockResolvedValue(null);
      await debtAutoCollection();
      expect(prisma.debt.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ note: expect.stringContaining("QUA HAN 30+ NGAY") }),
      }));
    });

    test("RECEIVABLE only gets customer notes", async () => {
      prisma.debt.findMany.mockResolvedValueOnce([
        { id: "d-rec", amount: 1000000, paidAmount: 0, status: "OPEN", type: "RECEIVABLE", dueDate: new Date(Date.now() + 1 * 86400000), customer: { id: "c1", name: "C Rec" }, vendor: null },
        { id: "d-pay", amount: 1000000, paidAmount: 0, status: "OPEN", type: "PAYABLE", dueDate: new Date(Date.now() + 1 * 86400000), customer: null, vendor: { id: "v1", name: "V Pay" } },
      ]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.notification.findFirst.mockResolvedValue(null);
      await debtAutoCollection();
      expect(prisma.customerNote.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("morningBriefing — edge cases", () => {
    test("zero revenue day shows warning", async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 0 } }).mockResolvedValueOnce({ _sum: { total: 10000000 } }).mockResolvedValueOnce({ _sum: { total: 30000000 } });
      prisma.inventory.count.mockResolvedValue(5);
      prisma.purchaseOrder.count.mockResolvedValue(1);
      prisma.debt.count.mockResolvedValue(2);
      prisma.customer.count.mockResolvedValueOnce(50).mockResolvedValueOnce(3);
      const result = await morningBriefing();
      expect(result.anomaly).toBe(true);
    });

    test("first day of business — no yesterday data", async () => {
      prisma.order.count.mockResolvedValue(3);
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 15000000 } }).mockResolvedValueOnce({ _sum: { total: 0 } }).mockResolvedValueOnce({ _sum: { total: 15000000 } });
      prisma.inventory.count.mockResolvedValue(3);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      prisma.debt.count.mockResolvedValue(0);
      prisma.customer.count.mockResolvedValueOnce(20).mockResolvedValueOnce(20);
      const result = await morningBriefing();
      expect(result.success).toBe(true);
    });

    test("billions should display correctly", async () => {
      prisma.order.count.mockResolvedValue(500);
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 5_000_000_000 } }).mockResolvedValueOnce({ _sum: { total: 4_000_000_000 } }).mockResolvedValueOnce({ _sum: { total: 150_000_000_000 } });
      prisma.inventory.count.mockResolvedValue(10);
      prisma.purchaseOrder.count.mockResolvedValue(3);
      prisma.debt.count.mockResolvedValue(5);
      prisma.customer.count.mockResolvedValueOnce(2000).mockResolvedValueOnce(50);
      const result = await morningBriefing();
      expect(result.success).toBe(true);
      expect(notif.notifyRoles).toHaveBeenCalled();
    });
  });

  describe("anomalyDetection — edge cases", () => {
    test("all 3 anomaly types detected simultaneously", async () => {
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 500000 }, _count: { id: 2 } }).mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });
      prisma.expense.aggregate.mockResolvedValueOnce({ _sum: { amount: 50000000 } }).mockResolvedValueOnce({ _sum: { amount: 10000000 } });
      prisma.customer.count.mockResolvedValue(25);
      const result = await anomalyDetection();
      expect(result.alerts).toBe(3);
    });

    test("zero orders — no division by zero", async () => {
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 0 }, _count: { id: 0 } }).mockResolvedValueOnce({ _sum: { total: 5000000 }, _count: { id: 5 } });
      prisma.expense.aggregate.mockResolvedValueOnce({ _sum: { amount: 5000000 } }).mockResolvedValueOnce({ _sum: { amount: 5000000 } });
      prisma.customer.count.mockResolvedValue(5);
      const result = await anomalyDetection();
      expect(result.success).toBe(true);
    });

    test("no previous data — should not alert", async () => {
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } }).mockResolvedValueOnce({ _sum: { total: 0 }, _count: { id: 0 } });
      prisma.expense.aggregate.mockResolvedValueOnce({ _sum: { amount: 5000000 } }).mockResolvedValueOnce({ _sum: { amount: 0 } });
      prisma.customer.count.mockResolvedValue(5);
      const result = await anomalyDetection();
      expect(result.alerts).toBe(0);
    });
  });
});
