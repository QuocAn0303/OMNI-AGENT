const customerService = require("../src/modules/customers/customer.service");

jest.mock("../src/config/prisma", () => ({
  customer: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  order: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 100000 }, _count: { all: 5 }, _max: { createdAt: new Date() } }),
    count: jest.fn().mockResolvedValue(0),
  },
  debt: { findMany: jest.fn().mockResolvedValue([]) },
  loyaltyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
  customerNote: { findMany: jest.fn().mockResolvedValue([]) },
  customerTagOnCustomer: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn((fn) => fn({})),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../src/config/prisma");

describe("customer.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("getAll trả về danh sách có phân trang", async () => {
    prisma.customer.findMany.mockResolvedValue([{ id: "c1", name: "Nguyen Van A" }]);
    prisma.customer.count.mockResolvedValue(1);
    const result = await customerService.getAll({ page: 1, limit: 20 });
    expect(result.pagination).toBeDefined();
    expect(result.customers).toHaveLength(1);
  });

  test("create tạo khách hàng mới", async () => {
    prisma.customer.create.mockResolvedValue({ id: "c1", name: "Test" });
    const result = await customerService.create({ name: "Test" }, "user1");
    expect(result.name).toBe("Test");
  });

  test("getCustomer360 trả về customer 360", async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: "c1", name: "Test", isActive: true });
    const result = await customerService.getCustomer360("c1");
    expect(result.customer.name).toBe("Test");
    expect(result.rfm).toBeDefined();
  });

  test("getCustomer360 throw 404 nếu không tìm thấy", async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    await expect(customerService.getCustomer360("invalid")).rejects.toMatchObject({ status: 404 });
  });

  test("update cập nhật thông tin", async () => {
    prisma.customer.findUnique = jest.fn().mockResolvedValue({ id: "c1", isActive: true });
    prisma.customer.update.mockResolvedValue({ id: "c1", name: "Updated" });
    const result = await customerService.update("c1", { name: "Updated" }, "user1");
    expect(result.name).toBe("Updated");
  });

  test("remove soft-delete khách hàng", async () => {
    prisma.customer.findUnique = jest.fn().mockResolvedValue({ id: "c1", isActive: true });
    prisma.customer.update.mockResolvedValue({ id: "c1", isActive: false });
    await customerService.remove("c1", "user1");
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  test("updateCreditLimit cập nhật hạn mức", async () => {
    prisma.customer.findUnique = jest.fn().mockResolvedValue({ id: "c1", isActive: true });
    prisma.customer.update.mockResolvedValue({ id: "c1", creditLimit: 5000000 });
    const result = await customerService.updateCreditLimit("c1", 5000000, "user1");
    expect(result.creditLimit).toBe(5000000);
  });
});
