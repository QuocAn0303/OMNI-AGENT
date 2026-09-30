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

jest.mock("../src/modules/crm/segments.service", () => ({
  buildWhereForSegment: jest.fn(),
  evaluateSegment: jest.fn(),
}));

const prisma = require("../src/config/prisma");
const segmentsService = require("../src/modules/crm/segments.service");

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

// ---------------------------------------------------------------------------
// Lọc theo phân khúc (?segment=<id>) — Phase 0
// ---------------------------------------------------------------------------
describe("customer.service — segmentId filter", () => {
  beforeEach(() => jest.clearAllMocks());

  const emptyPage = () => {
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.count.mockResolvedValue(0);
  };

  test("không truyền segmentId thì không gọi segmentsService", async () => {
    emptyPage();
    await customerService.getAll({ page: 1, limit: 20 });
    expect(segmentsService.buildWhereForSegment).not.toHaveBeenCalled();
    expect(prisma.customer.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
  });

  test("gộp điều kiện segment bằng AND ở top-level", async () => {
    emptyPage();
    segmentsService.buildWhereForSegment.mockResolvedValue({
      where: { isActive: true, AND: [{ tier: { in: ["GOLD"] } }] },
      postFilter: null,
      rules: {},
    });

    await customerService.getAll({ page: 1, limit: 20, segmentId: "seg1" });

    expect(segmentsService.buildWhereForSegment).toHaveBeenCalledWith("seg1");
    const where = prisma.customer.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([{ isActive: true, AND: [{ tier: { in: ["GOLD"] } }] }]);
  });

  test("AND segment + OR tìm kiếm không đụng nhau ở khoá gốc", async () => {
    emptyPage();
    segmentsService.buildWhereForSegment.mockResolvedValue({
      where: { isActive: true, AND: [{ tier: { in: ["GOLD"] } }] },
      postFilter: null,
      rules: {},
    });

    await customerService.getAll({ page: 1, limit: 20, segmentId: "seg1", search: "An" });

    const where = prisma.customer.findMany.mock.calls[0][0].where;
    // khoá OR phải bị dời vào trong AND, không còn ở top-level
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
    expect(where.AND[1].OR).toEqual([
      { name: { contains: "An", mode: "insensitive" } },
      { phone: { contains: "An", mode: "insensitive" } },
      { email: { contains: "An", mode: "insensitive" } },
    ]);
  });

  test("có postFilter (rule orderCount) thì fallback sang evaluateSegment", async () => {
    emptyPage();
    const rules = { all: [{ field: "orderCount", op: "gte", value: 3 }] };
    segmentsService.buildWhereForSegment.mockResolvedValue({
      where: { isActive: true },
      postFilter: { combinator: "AND", postFilters: [{ field: "orderCount" }] },
      rules,
    });
    segmentsService.evaluateSegment.mockResolvedValue({
      customers: [{ id: "c1" }, { id: "c2" }],
      total: 2,
    });

    await customerService.getAll({ page: 1, limit: 20, segmentId: "seg1" });

    expect(segmentsService.evaluateSegment).toHaveBeenCalledWith(rules);
    expect(prisma.customer.findMany.mock.calls[0][0].where.id).toEqual({ in: ["c1", "c2"] });
  });

  test("segment vượt trần số id thì báo 400 thay vì query khổng lồ", async () => {
    emptyPage();
    segmentsService.buildWhereForSegment.mockResolvedValue({
      where: { isActive: true },
      postFilter: { combinator: "AND", postFilters: [{ field: "orderCount" }] },
      rules: {},
    });
    segmentsService.evaluateSegment.mockResolvedValue({
      customers: Array.from({ length: 20001 }, (_, i) => ({ id: `c${i}` })),
      total: 20001,
    });

    await expect(customerService.getAll({ page: 1, limit: 20, segmentId: "seg1" }))
      .rejects.toMatchObject({ status: 400 });
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  test("segment không tồn tại thì ném 404 (không nuốt lỗi)", async () => {
    segmentsService.buildWhereForSegment.mockRejectedValue(
      Object.assign(new Error("Segment không tồn tại"), { status: 404 }),
    );
    await expect(customerService.getAll({ page: 1, limit: 20, segmentId: "nope" }))
      .rejects.toMatchObject({ status: 404 });
  });
});
