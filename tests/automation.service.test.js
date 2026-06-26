jest.mock("../src/config/prisma", () => {
  const mockPrisma = {};
  const handlers = {};
  mockPrisma.$transaction = jest.fn(async (fn) => fn(mockPrisma));

  mockPrisma.inventory = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  mockPrisma.product = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  };
  mockPrisma.purchaseOrder = {
    create: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  };
  mockPrisma.purchaseItem = {
    findFirst: jest.fn(),
  };
  mockPrisma.payroll = {
    findFirst: jest.fn(),
  };
  mockPrisma.debt = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };
  mockPrisma.customer = {
    findFirst: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  };
  mockPrisma.customerNote = {
    create: jest.fn().mockResolvedValue({ id: "note1" }),
  };
  mockPrisma.notification = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "notif1" }),
  };
  mockPrisma.order = {
    count: jest.fn(),
    aggregate: jest.fn(),
    findUnique: jest.fn(),
  };
  mockPrisma.expense = {
    aggregate: jest.fn(),
  };
  mockPrisma.user = {
    findFirst: jest.fn(),
  };
  mockPrisma.agentHumanGate = {
    create: jest.fn(),
  };
  mockPrisma.agentSession = {
    create: jest.fn(),
  };

  return mockPrisma;
});

jest.mock("../src/modules/notifications/notification.service", () => ({
  notifyRoles: jest.fn(),
}));
jest.mock("../src/modules/hr/hr.service", () => ({
  generatePayrollForMonth: jest.fn(),
}));
jest.mock("../src/modules/accounting/journal.service", () => ({
  postEntry: jest.fn(),
}));
jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn(),
}));

const prisma = require("../src/config/prisma");
const {
  checkAutoReorder,
  debtAutoCollection,
  morningBriefing,
  anomalyDetection,
} = require("../src/modules/automation/automation.service");
const notif = require("../src/modules/notifications/notification.service");

describe("automation.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("checkAutoReorder", () => {
    test("should skip when inventory above minStock", async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { productId: "p1", warehouseId: "w1", quantity: 100, reserved: 0, minStock: 5,
          product: { id: "p1", name: "Test", sku: "SKU1", costPrice: 10000, isActive: true } },
      ]);

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    test("should skip when product is not active", async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { productId: "p1", warehouseId: "w1", quantity: 1, reserved: 0, minStock: 10,
          product: { id: "p1", name: "Test", sku: "SKU1", costPrice: 10000, isActive: false } },
      ]);

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    test("should skip when no vendor found", async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { productId: "p1", warehouseId: "w1", quantity: 1, reserved: 0, minStock: 10,
          product: { id: "p1", name: "Test", sku: "SKU1", costPrice: 10000, isActive: true } },
      ]);
      prisma.purchaseItem.findFirst.mockResolvedValue(null);

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    test("should skip when draft PO already exists", async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { productId: "p1", warehouseId: "w1", quantity: 1, reserved: 0, minStock: 10,
          product: { id: "p1", name: "Test", sku: "SKU1", costPrice: 10000, isActive: true } },
      ]);
      prisma.purchaseItem.findFirst.mockResolvedValue({
        purchaseOrder: { vendorId: "v1", vendor: { id: "v1", name: "Vendor", isActive: true } },
      });
      prisma.purchaseOrder.findFirst.mockResolvedValue({ poCode: "PO-EXIST", id: "po1" });

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    test("should create PO with auto-approve for small orders", async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { productId: "p1", warehouseId: "w1", quantity: 2, reserved: 0, minStock: 10,
          product: { id: "p1", name: "Test Product", sku: "SKU1", costPrice: 10000, isActive: true } },
      ]);
      prisma.purchaseItem.findFirst.mockResolvedValue({
        purchaseOrder: { vendorId: "v1", vendor: { id: "v1", name: "Vendor", isActive: true }, date: new Date() },
      });
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      prisma.purchaseOrder.count.mockResolvedValue(3);
      prisma.user.findFirst.mockResolvedValue({ id: "user1" });

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "APPROVED",
            vendorId: "v1",
          }),
        })
      );
    });

    test("should create PO without auto-approve for large orders (>5M)", async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { productId: "p1", warehouseId: "w1", quantity: 1, reserved: 0, minStock: 100,
          product: { id: "p1", name: "Expensive Item", sku: "EXP1", costPrice: 500000, isActive: true } },
      ]);
      prisma.purchaseItem.findFirst.mockResolvedValue({
        purchaseOrder: { vendorId: "v1", vendor: { id: "v1", name: "Vendor", isActive: true }, date: new Date() },
      });
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      prisma.purchaseOrder.count.mockResolvedValue(0);
      prisma.user.findFirst.mockResolvedValue({ id: "user1" });

      await checkAutoReorder(["p1"], "w1");

      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "DRAFT",
          }),
        })
      );
    });
  });

  describe("debtAutoCollection", () => {
    test("should skip when no debts found", async () => {
      prisma.debt.findMany.mockResolvedValue([]);

      await debtAutoCollection();

      expect(notif.notifyRoles).not.toHaveBeenCalled();
    });

    test("should notify MANAGER for upcoming debts (≤3 days)", async () => {
      const mockDebt = {
        id: "d1",
        amount: 1000000,
        paidAmount: 0,
        status: "OPEN",
        type: "RECEIVABLE",
        dueDate: new Date(Date.now() + 2 * 86400000),
        customer: { id: "c1", name: "Test Customer", phone: "0909123456" },
        vendor: null,
      };

      prisma.debt.findMany.mockResolvedValueOnce([mockDebt]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.notification.findFirst.mockResolvedValue(null);

      await debtAutoCollection();

      expect(notif.notifyRoles).toHaveBeenCalledWith(
        ["MANAGER"],
        expect.objectContaining({
          type: "DEBT_OVERDUE",
          severity: "WARNING",
        })
      );
    });

    test("should escalate to ADMIN for 7-day overdue debts", async () => {
      const mockDebt = {
        id: "d2",
        amount: 5000000,
        paidAmount: 0,
        status: "OPEN",
        type: "RECEIVABLE",
        dueDate: new Date(Date.now() - 10 * 86400000),
        customer: { id: "c2", name: "Late Customer" },
        vendor: null,
      };

      prisma.debt.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockDebt])
        .mockResolvedValueOnce([]);
      prisma.notification.findFirst.mockResolvedValue(null);

      await debtAutoCollection();

      expect(notif.notifyRoles).toHaveBeenCalledWith(
        ["ADMIN"],
        expect.objectContaining({
          severity: "CRITICAL",
        })
      );
      expect(prisma.debt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "OVERDUE" },
        })
      );
    });

    test("should debounce duplicate notifications within 24h", async () => {
      const mockDebt = {
        id: "d3",
        amount: 1000000,
        paidAmount: 0,
        status: "OPEN",
        type: "RECEIVABLE",
        dueDate: new Date(Date.now() + 1 * 86400000),
        customer: { id: "c3", name: "Debounced" },
        vendor: null,
      };

      prisma.debt.findMany
        .mockResolvedValueOnce([mockDebt])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.notification.findFirst.mockResolvedValue({ id: "existing-notif" });

      await debtAutoCollection();

      expect(notif.notifyRoles).not.toHaveBeenCalled();
    });
  });

  describe("morningBriefing", () => {
    test("should generate briefing with revenue data", async () => {
      prisma.order.count.mockResolvedValue(5);
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 5000000 } })
        .mockResolvedValueOnce({ _sum: { total: 3000000 } })
        .mockResolvedValueOnce({ _sum: { total: 15000000 } })
        .mockResolvedValueOnce({ _sum: { total: 12000000 } });
      prisma.inventory.count.mockResolvedValue(3);
      prisma.purchaseOrder.count.mockResolvedValue(2);
      prisma.debt.count.mockResolvedValue(4);
      prisma.customer.count.mockResolvedValueOnce(100).mockResolvedValueOnce(12);

      const result = await morningBriefing();
      expect(result.success).toBe(true);
      expect(notif.notifyRoles).toHaveBeenCalledWith(
        ["ADMIN", "MANAGER"],
        expect.objectContaining({
          type: "SYSTEM",
          severity: "INFO",
        })
      );
    });

    test("should mark as WARNING when anomalies detected", async () => {
      prisma.order.count.mockResolvedValue(2);
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 1000000 } })
        .mockResolvedValueOnce({ _sum: { total: 5000000 } })
        .mockResolvedValueOnce({ _sum: { total: 5000000 } });
      prisma.inventory.count.mockResolvedValue(25);
      prisma.purchaseOrder.count.mockResolvedValue(8);
      prisma.debt.count.mockResolvedValue(15);
      prisma.customer.count.mockResolvedValueOnce(50).mockResolvedValueOnce(5);

      const result = await morningBriefing();
      expect(result.anomaly).toBe(true);
      expect(notif.notifyRoles).toHaveBeenCalledWith(
        ["ADMIN", "MANAGER"],
        expect.objectContaining({
          severity: "WARNING",
        })
      );
    });

    test("should handle errors gracefully", async () => {
      prisma.order.count.mockRejectedValue(new Error("DB Error"));

      const result = await morningBriefing();
      expect(result.success).toBe(false);
    });
  });

  describe("anomalyDetection", () => {
    test("should detect revenue drop >50%", async () => {
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 1000000 }, _count: { id: 4 } })
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });
      prisma.expense.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 5000000 } })
        .mockResolvedValueOnce({ _sum: { amount: 5000000 } });
      prisma.customer.count.mockResolvedValue(5);

      const result = await anomalyDetection();
      expect(result.alerts).toBeGreaterThan(0);
      expect(notif.notifyRoles).toHaveBeenCalled();
    });

    test("should detect expense spike >50%", async () => {
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } })
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });
      prisma.expense.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 30000000 } })
        .mockResolvedValueOnce({ _sum: { amount: 10000000 } });
      prisma.customer.count.mockResolvedValue(5);

      const result = await anomalyDetection();
      expect(result.alerts).toBeGreaterThan(0);
    });

    test("should detect dormant customers", async () => {
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } })
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });
      prisma.expense.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10000000 } })
        .mockResolvedValueOnce({ _sum: { amount: 10000000 } });
      prisma.customer.count.mockResolvedValue(15);

      const result = await anomalyDetection();
      expect(result.alerts).toBeGreaterThan(0);
    });

    test("should return 0 alerts when everything normal", async () => {
      prisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } })
        .mockResolvedValueOnce({ _sum: { total: 10000000 }, _count: { id: 10 } });
      prisma.expense.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 10000000 } })
        .mockResolvedValueOnce({ _sum: { amount: 10000000 } });
      prisma.customer.count.mockResolvedValue(5);

      const result = await anomalyDetection();
      expect(result.alerts).toBe(0);
    });

    test("should handle errors gracefully", async () => {
      prisma.order.aggregate.mockRejectedValue(new Error("DB Error"));

      const result = await anomalyDetection();
      expect(result.success).toBe(false);
    });
  });
});
