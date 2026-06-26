jest.mock("../src/config/prisma", () => {
  const mockPrisma = {};
  mockPrisma.product = {
    findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(),
  };
  mockPrisma.order = {
    findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(),
    aggregate: jest.fn(), groupBy: jest.fn(),
  };
  mockPrisma.customer = {
    findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(),
  };
  mockPrisma.customerNote = {
    create: jest.fn().mockResolvedValue({ id: "note1" }),
  };
  mockPrisma.inventory = {
    findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn(), aggregate: jest.fn(),
  };
  mockPrisma.debt = {
    findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), update: jest.fn().mockResolvedValue({}),
  };
  mockPrisma.purchaseOrder = {
    findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), aggregate: jest.fn(), create: jest.fn(),
  };
  mockPrisma.vendor = {
    findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(),
  };
  mockPrisma.expense = { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() };
  mockPrisma.journalEntry = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.account = { findMany: jest.fn(), findUnique: jest.fn() };
  mockPrisma.employee = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.payroll = { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() };
  mockPrisma.shift = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.user = { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() };
  mockPrisma.workOrder = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.bom = { findMany: jest.fn() };
  mockPrisma.inventoryLot = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.project = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.promotion = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.invoice = { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() };
  mockPrisma.delivery = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.orderReturn = { findMany: jest.fn(), count: jest.fn() };
  mockPrisma.notification = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) };
  mockPrisma.agentHumanGate = { create: jest.fn().mockResolvedValue({}) };
  mockPrisma.agentSession = { create: jest.fn().mockResolvedValue({}) };
  mockPrisma.category = { findMany: jest.fn() };
  mockPrisma.warehouse = { findMany: jest.fn() };
  return mockPrisma;
});

jest.mock("../src/modules/notifications/notification.service", () => ({
  notifyRoles: jest.fn(),
}));
jest.mock("../src/modules/orders/order.service", () => ({
  create: jest.fn().mockResolvedValue({
    id: "order1", orderCode: "ORD-20260625-0001", total: 500000,
    items: [{ productId: "p1", product: { name: "Test Product" } }],
  }),
}));
jest.mock("../src/modules/accounting/purchase.service", () => ({
  create: jest.fn().mockResolvedValue({
    id: "po1", poCode: "PO-20260625-0001", total: 1000000,
    vendor: { name: "Test Vendor" },
  }),
}));

const { resolveIntent, extractParams, processQuery, HANDLERS } = require("../src/modules/ai/db-agent.service");
const prisma = require("../src/config/prisma");

describe("db-agent.service — intent resolution", () => {
  describe("resolveIntent", () => {
    test("should match read intents (no diacritics)", () => {
      expect(resolveIntent("doanh thu thang nay")).toBe("get_revenue");
      expect(resolveIntent("dashboard")).toBe("get_dashboard");
    });

    test("should match read intents (with diacritics)", () => {
      expect(resolveIntent("tồn kho sản phẩm")).toBe("search_inventory");
      expect(resolveIntent("đơn hàng hôm nay")).toBe("search_orders");
      expect(resolveIntent("khách hàng Nguyễn Văn A")).toBe("search_customers");
    });

    test("should match write intents", () => {
      expect(resolveIntent("tạo đơn hàng 5 áo polo cho khách A")).toBe("create_order");
      expect(resolveIntent("tạo PO nhập thêm 100 sản phẩm")).toBe("create_po");
      expect(resolveIntent("nhắc nợ khách Nguyễn Văn A")).toBe("send_reminder");
    });

    test("should return null for unknown queries", () => {
      expect(resolveIntent("trời đẹp quá")).toBeNull();
    });
  });

  describe("extractParams", () => {
    test("should extract period", () => {
      expect(extractParams("doanh thu hôm nay", "get_revenue").period).toBe("today");
      expect(extractParams("doanh thu tháng này", "get_revenue").period).toBe("this_month");
      expect(extractParams("doanh thu tháng trước", "get_revenue").period).toBe("last_month");
    });

    test("should extract status", () => {
      expect(extractParams("đơn hàng pending", "search_orders").status).toBe("PENDING");
      expect(extractParams("đơn hàng completed", "search_orders").status).toBe("COMPLETED");
    });

    test("should extract limit from 'top N' pattern", () => {
      const params = extractParams("top 10 sản phẩm bán chạy", "search_products");
      expect(params.limit).toBe(10);
      expect(params.sortOrder).toBe("desc");
    });

    test("should extract search query", () => {
      const params = extractParams("tìm sản phẩm áo polo", "search_products");
      expect(params.search).toBe("áo polo");
    });
  });

  describe("processQuery", () => {
    test("should process read query successfully", async () => {
      prisma.order.findMany.mockResolvedValue([
        { orderCode: "ORD-001", status: "COMPLETED", total: 500000, paymentStatus: "PAID",
          customer: { name: "Test", phone: "0909" },
          createdAt: new Date("2026-01-01"), items: [] },
      ]);
      prisma.order.count.mockResolvedValue(1);
      prisma.order.aggregate.mockResolvedValue({ _sum: { total: 500000 }, _count: { id: 1 } });

      const result = await processQuery("đơn hàng hôm nay");
      expect(result.success).toBe(true);
      expect(result.tool).toBe("search_orders");
      expect(result.total).toBe(1);
    });

    test("should block write tools from processQuery", async () => {
      const result = await processQuery("tạo đơn hàng 5 sản phẩm cho khách A");
      expect(result.success).toBe(false);
      expect(result.message).toContain("/api/agent/chat");
    });

    test("should return help for unknown queries", async () => {
      const result = await processQuery("trời hôm nay đẹp quá");
      expect(result.success).toBe(false);
    });
  });

  describe("HANDLERS — read tools", () => {
    test("search_products returns product list", async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: "p1", name: "Áo Polo", sku: "AP001", price: 200000,
          category: { name: "Áo" }, inventories: [{ quantity: 50 }] },
      ]);
      prisma.product.count.mockResolvedValue(1);

      const result = await HANDLERS.search_products({ search: "áo" });
      expect(result.total).toBe(1);
      expect(result.summary).toContain("1");
    });

    test("get_dashboard returns overview stats", async () => {
      prisma.order.count.mockResolvedValue(5);
      prisma.order.aggregate.mockResolvedValue({ _sum: { total: 5000000 } });
      prisma.customer.count.mockResolvedValue(100);
      prisma.inventory.count.mockResolvedValue(3);
      prisma.purchaseOrder.count.mockResolvedValue(2);
      prisma.employee.count.mockResolvedValue(10);

      const result = await HANDLERS.get_dashboard({});
      expect(result.data.orderToday).toBe(5);
    });
  });

  describe("HANDLERS — write tools", () => {
    test("create_order validates items required", async () => {
      const result = await HANDLERS.create_order({});
      expect(result.data).toBeNull();
      expect(result.summary).toContain("Vui lòng");
    });

    test("create_po validates items required", async () => {
      const result = await HANDLERS.create_po({});
      expect(result.data).toBeNull();
      expect(result.summary).toContain("Vui lòng");
    });

    test("send_reminder validates params", async () => {
      const result = await HANDLERS.send_reminder({});
      expect(result.data).toBeNull();
      expect(result.summary).toContain("Vui lòng");
    });

    test("create_order finds customer and creates order", async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: "c1", name: "Nguyễn Văn A", isActive: true });
      prisma.product.findFirst.mockResolvedValue({ id: "p1", name: "Áo Polo", sku: "AP001", price: 200000, isActive: true });

      const result = await HANDLERS.create_order({
        customerName: "Nguyễn Văn A",
        items: [{ productName: "Áo Polo", quantity: 5 }],
      }, "user1");

      expect(result.data).toBeDefined();
      expect(result.summary).toContain("ORD-20260625-0001");
    });

    test("create_order returns error when customer not found", async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const result = await HANDLERS.create_order({
        customerName: "Unknown",
        items: [{ productName: "Áo Polo", quantity: 1 }],
      }, "user1");

      expect(result.data).toBeNull();
      expect(result.summary).toContain("Unknown");
    });

    test("create_po finds vendor and creates PO", async () => {
      prisma.vendor.findFirst.mockResolvedValue({ id: "v1", name: "NCC Test" });
      prisma.product.findFirst.mockResolvedValue({ id: "p1", name: "Nguyên liệu", sku: "NL001", costPrice: 50000, isActive: true });

      const result = await HANDLERS.create_po({
        vendorName: "NCC Test",
        items: [{ productName: "Nguyên liệu", quantity: 100, unitCost: 45000 }],
      }, "user1");

      expect(result.data).toBeDefined();
      expect(result.summary).toContain("PO-20260625-0001");
    });
  });
});
