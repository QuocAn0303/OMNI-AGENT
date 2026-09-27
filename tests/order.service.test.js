const orderService = require("../src/modules/orders/order.service");

const mockOrder = {
  id: "ord1",
  orderCode: "ORD-20260703-0001",
  status: "PENDING",
  totalAmount: 100000,
  subtotal: 100000,
  discountAmount: 0,
  paymentStatus: "UNPAID",
  customerId: "c1",
  customer: { id: "c1", name: "Test", creditLimit: 500000, totalDebt: 0 },
  items: [{ id: "item1", productId: "p1", product: { id: "p1", name: "SP1", costPrice: 30000, isActive: true }, quantity: 2, unitPrice: 50000 }],
  payments: [],
  createdAt: new Date(),
};

jest.mock("../src/config/prisma", () => ({
  order: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), update: jest.fn() },
  orderItem: { createMany: jest.fn(), findMany: jest.fn() },
  product: { findUnique: jest.fn(), findMany: jest.fn() },
  inventory: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  inventoryTransaction: { create: jest.fn(), createMany: jest.fn() },
  inventoryLot: { findMany: jest.fn(), update: jest.fn() },
  lotTransaction: { create: jest.fn() },
  customer: { findUnique: jest.fn() },
  $transaction: jest.fn((fn) => fn({ order: { findUnique: jest.fn(), update: jest.fn() }, orderItem: { findMany: jest.fn().mockResolvedValue([]) }, inventory: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() }, inventoryTransaction: { create: jest.fn() }, inventoryLot: { findMany: jest.fn().mockResolvedValue([]) }, lotTransaction: { create: jest.fn() }, customer: { update: jest.fn() }, debt: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) }, delivery: { findMany: jest.fn().mockResolvedValue([]) }, promotion: { findMany: jest.fn().mockResolvedValue([]) }, promotionResult: { findMany: jest.fn().mockResolvedValue([]) }, loyaltyTransaction: { findMany: jest.fn().mockResolvedValue([]) }, notification: { create: jest.fn() }, saleChannel: { findUnique: jest.fn() } })),
}));

jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn().mockResolvedValue(true) }));
jest.mock("../src/modules/accounting/autopost.service", () => ({ postOrderCreated: jest.fn(), postOrderPayment: jest.fn(), postOrderCompleted: jest.fn(), postOrderCancelled: jest.fn(), postOrderConfirmed: jest.fn() }));
jest.mock("../src/modules/accounting/posting-error.service", () => ({ record: jest.fn(), tryPostOrQueue: jest.fn() }));
jest.mock("../src/modules/accounting/journal.service", () => ({ withCodeRetry: jest.fn((fn) => fn({ journalEntry: { create: jest.fn() } })) }));
jest.mock("../src/modules/debt/debt.service", () => ({ createOrUpdateForOrder: jest.fn(), createReceivableForOrderInTx: jest.fn(), createOrUpdatePayableForReturnInTx: jest.fn() }));
jest.mock("../src/modules/promotions/promotion.service", () => ({ applyPromotion: jest.fn((items) => ({ items, discount: 0 })), rollbackOrderPromotions: jest.fn() }));
jest.mock("../src/modules/loyalty/loyalty.service", () => ({ awardPoints: jest.fn(), earnOnOrderCompleted: jest.fn(), rollbackOnCancel: jest.fn() }));
jest.mock("../src/utils/warehouse.helper", () => ({ getDefaultWarehouseId: jest.fn().mockResolvedValue("wh-test"), resolveWarehouseId: jest.fn().mockResolvedValue("wh-test"), findInventory: jest.fn().mockResolvedValue({ id: "inv1", quantity: 100, reserved: 0 }) }));
jest.mock("../src/modules/inventory/valuation.service", () => ({ recordFifoConsumption: jest.fn().mockResolvedValue(50000) }));
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../src/config/prisma");
const autopostService = require("../src/modules/accounting/autopost.service");

describe("order.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    test("returns paginated orders", async () => {
      prisma.order.findMany.mockResolvedValue([mockOrder]);
      prisma.order.count.mockResolvedValue(1);
      const result = await orderService.getAll({ page: 1, limit: 20 });
      expect(result.pagination).toBeDefined();
      expect(result.orders).toHaveLength(1);
    });

    test("filters by status", async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      await orderService.getAll({ status: "PENDING" });
      expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "PENDING" }) }));
    });
  });

  describe("getById", () => {
    test("throws 404 if not found", async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(orderService.getById("invalid")).rejects.toMatchObject({ status: 404 });
    });

    test("returns order when found", async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      const result = await orderService.getById("ord1");
      expect(result.orderCode).toBe("ORD-20260703-0001");
    });
  });

  describe("create", () => {
    test("throws if product not found", async () => {
      prisma.product.findMany.mockResolvedValue([]);
      await expect(orderService.create({ items: [{ productId: "invalid" }] }, "user1"))
        .rejects.toMatchObject({ status: 400 });
    });

    test("throws if insufficient inventory", async () => {
      prisma.product.findMany.mockResolvedValue([{ id: "p1", name: "SP1", isActive: true, inventories: [], costPrice: 30000 }]);
      prisma.inventory.findUnique.mockResolvedValue({ id: "inv1", quantity: 0, reserved: 0 });
      prisma.customer.findUnique.mockResolvedValue(mockOrder.customer);
      await expect(orderService.create({ customerId: "c1", items: [{ productId: "p1", quantity: 2, unitPrice: 50000 }], paidAmount: 100000 }, "user1"))
        .rejects.toMatchObject({ status: 400 });
    });
  });
});
