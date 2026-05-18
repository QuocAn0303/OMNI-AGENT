const stockTransfer = require("../src/modules/warehouses/stock-transfer.service");

jest.mock("../src/config/prisma", () => ({
  stockTransfer: {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn({})),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../src/config/prisma");
const { findInventory } = require("../src/utils/warehouse.helper");

describe("stock-transfer.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("complete từ chối khi kho âm", async () => {
    prisma.stockTransfer.findUnique.mockResolvedValue({
      id: "t1",
      status: "PENDING",
      transferCode: "ST-1",
      fromWarehouseId: "w1",
      toWarehouseId: "w2",
      items: [{ productId: "p1", quantity: 5 }],
    });
    findInventory.mockResolvedValue({ id: "inv1", quantity: 2, reserved: 0 });

    prisma.$transaction.mockImplementation((fn) => {
      const tx = {
        inventory: { update: jest.fn(), create: jest.fn() },
        inventoryTransaction: { create: jest.fn() },
        stockTransfer: { update: jest.fn() },
      };
      return fn(tx);
    });

    await expect(stockTransfer.complete("t1", "u1")).rejects.toMatchObject({
      status: 400,
    });
  });
});
