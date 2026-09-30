const storeCreditService = require("../src/modules/customers/store-credit.service");

// Pattern B (như tests/rfm.service.test.js): dùng tiền tố "mock" để được phép
// tham chiếu ngoài factory — jest.mock được hoist lên trên các khai báo const.
const mockTx = {
  customer: { update: jest.fn(), updateMany: jest.fn() },
  storeCreditTransaction: { create: jest.fn() },
};

jest.mock("../src/config/prisma", () => ({
  customer: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  storeCreditTransaction: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockTx)),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../src/config/prisma");
const auditService = require("../src/modules/audit/audit.service");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.customer.findUnique.mockResolvedValue({ id: "c1", storeCredit: 100000 });
});

describe("store-credit.service — createdBy select", () => {
  test("listByCustomer lấy fullName (không lấy field name không tồn tại trên User)", async () => {
    prisma.storeCreditTransaction.findMany.mockResolvedValue([]);
    prisma.storeCreditTransaction.count.mockResolvedValue(0);

    await storeCreditService.listByCustomer("c1", { page: 1, limit: 20 });

    expect(prisma.storeCreditTransaction.findMany.mock.calls[0][0].include.createdBy.select)
      .toEqual({ id: true, fullName: true });
  });
});

describe("store-credit.service — guard số dư không âm", () => {
  test("SPEND đủ số dư → trừ bằng updateMany có điều kiện", async () => {
    mockTx.customer.updateMany.mockResolvedValue({ count: 1 });
    mockTx.storeCreditTransaction.create.mockResolvedValue({ id: "tx1" });

    await storeCreditService.create({ customerId: "c1", amount: 50000, type: "SPEND" }, "u1");

    expect(mockTx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", storeCredit: { gte: 50000 } },
      data: { storeCredit: { increment: -50000 } },
    });
    expect(mockTx.storeCreditTransaction.create).toHaveBeenCalled();
  });

  test("SPEND vượt số dư → 400, không tạo giao dịch", async () => {
    mockTx.customer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      storeCreditService.create({ customerId: "c1", amount: 999999999, type: "SPEND" }, "u1"),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockTx.storeCreditTransaction.create).not.toHaveBeenCalled();
  });

  test("ADJUST giảm cũng bị chặn khi không đủ số dư", async () => {
    mockTx.customer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      storeCreditService.create({ customerId: "c1", amount: 1, type: "ADJUST" }, "u1"),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("EARN dùng update thường, không cần điều kiện số dư", async () => {
    mockTx.customer.update.mockResolvedValue({ id: "c1" });
    mockTx.storeCreditTransaction.create.mockResolvedValue({ id: "tx2" });

    await storeCreditService.create({ customerId: "c1", amount: 200000, type: "EARN" }, "u1");

    expect(mockTx.customer.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { storeCredit: { increment: 200000 } },
    });
    expect(mockTx.customer.updateMany).not.toHaveBeenCalled();
  });

  test("REFUND cộng vào số dư", async () => {
    mockTx.customer.update.mockResolvedValue({ id: "c1" });
    mockTx.storeCreditTransaction.create.mockResolvedValue({ id: "tx3" });

    await storeCreditService.create({ customerId: "c1", amount: 30000, type: "REFUND" }, "u1");

    expect(mockTx.customer.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { storeCredit: { increment: 30000 } },
    });
  });

  test("khách hàng không tồn tại → 404, không mở transaction", async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      storeCreditService.create({ customerId: "nope", amount: 1000, type: "SPEND" }, "u1"),
    ).rejects.toMatchObject({ status: 404 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("ghi audit sau khi giao dịch thành công", async () => {
    mockTx.customer.update.mockResolvedValue({ id: "c1" });
    mockTx.storeCreditTransaction.create.mockResolvedValue({ id: "tx4" });

    await storeCreditService.create({ customerId: "c1", amount: 1000, type: "EARN" }, "u1");

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE_STORE_CREDIT", entityId: "tx4" }),
    );
  });

  test("giao dịch thất bại thì không ghi audit", async () => {
    mockTx.customer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      storeCreditService.create({ customerId: "c1", amount: 999999999, type: "SPEND" }, "u1"),
    ).rejects.toMatchObject({ status: 400 });

    expect(auditService.log).not.toHaveBeenCalled();
  });
});