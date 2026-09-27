const inventoryService = require("../src/modules/inventory/inventory.service");

jest.mock("../src/config/prisma", () => ({
  inventory: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  inventoryTransaction: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  product: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

jest.mock("../src/modules/accounting/posting-error.service", () => ({
  tryPostOrQueue: jest.fn(),
}));

jest.mock("../src/modules/accounting/autopost.service", () => ({
  postInventoryAdjustment: jest.fn(),
}));

jest.mock("../src/utils/warehouse.helper", () => ({
  findInventory: jest.fn(),
  resolveWarehouseId: jest.fn().mockResolvedValue("wh-test"),
}));

const { findInventory } = require("../src/utils/warehouse.helper");
const prisma = require("../src/config/prisma");

const makeTx = () => ({
  inventory: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
  inventoryTransaction: { create: jest.fn() },
  product: { findUnique: jest.fn(), update: jest.fn() },
  inventoryLot: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
});

describe("inventory.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("importStock thành công", async () => {
    findInventory.mockResolvedValue({ id: "inv1", productId: "p1", warehouseId: "wh1", quantity: 5 });
    const tx = makeTx();
    tx.inventory.update.mockResolvedValue({ id: "inv1", quantity: 15 });
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const result = await inventoryService.importStock({ productId: "p1", quantity: 10, warehouseId: "wh1" }, "u1");
    expect(result.quantity).toBe(15);
  });

  test("exportStock reject khi tồn không đủ", async () => {
    findInventory.mockResolvedValue({ id: "inv1", productId: "p1", warehouseId: "wh1", quantity: 2, reserved: 0 });

    await expect(inventoryService.exportStock({ productId: "p1", quantity: 10, warehouseId: "wh1" }, "u1"))
      .rejects.toMatchObject({ status: 400 });
  });

  test("exportStock giảm tồn qua updateMany atomic và ghi giao dịch EXPORT", async () => {
    findInventory.mockResolvedValue({ id: "inv1", productId: "p1", warehouseId: "wh1", quantity: 10, reserved: 0 });
    const tx = makeTx();
    tx.inventory.updateMany.mockResolvedValue({ count: 1 });
    tx.inventoryTransaction.create.mockResolvedValue({ id: "tx1" });
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const result = await inventoryService.exportStock({ productId: "p1", quantity: 3, warehouseId: "wh1" }, "u1");
    expect(tx.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv1", quantity: { gte: 3 } },
        data: { quantity: { decrement: 3 } },
      }),
    );
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "EXPORT", quantity: 3 }) }),
    );
    expect(result.id).toBe("inv1");
  });

  test("adjustment không thay đổi nếu quantity giống nhau", async () => {
    findInventory.mockResolvedValue({ id: "inv1", productId: "p1", warehouseId: "wh1", quantity: 5, reserved: 0 });
    const tx = makeTx();
    tx.inventory.update.mockResolvedValue({ id: "inv1", quantity: 5 });
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    const result = await inventoryService.adjustment({ productId: "p1", actualQuantity: 5, warehouseId: "wh1" }, "u1");
    expect(result.quantity).toBe(5);
  });
});
