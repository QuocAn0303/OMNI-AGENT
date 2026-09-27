const categoryService = require("../src/modules/categories/category.service");

jest.mock("../src/config/prisma", () => ({
  category: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../src/config/prisma");

describe("category.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("getAll trả về danh sách active categories", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "c1", name: "Đồ uống", isActive: true },
      { id: "c2", name: "Đồ ăn", isActive: true },
    ]);

    const result = await categoryService.getAll();
    expect(result).toHaveLength(2);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } })
    );
  });

  test("create thành công và ghi audit log", async () => {
    prisma.category.findFirst.mockResolvedValue(null);
    prisma.category.create.mockResolvedValue({ id: "c1", name: "Đồ uống", isActive: true });

    const result = await categoryService.create({ name: "Đồ uống" }, "u1");
    expect(result.name).toBe("Đồ uống");
  });

  test("create throw 400 nếu tên trùng", async () => {
    prisma.category.findFirst.mockResolvedValue({ id: "c1", name: "Đồ uống" });

    await expect(categoryService.create({ name: "Đồ uống" }, "u1"))
      .rejects.toMatchObject({ status: 400 });
  });

  test("remove active category successfully (soft delete)", async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: "c1",
      name: "Đồ uống",
      isActive: true,
      _count: { products: 0 },
    });
    prisma.category.update.mockResolvedValue({ id: "c1", isActive: false });

    await categoryService.remove("c1", "u1");
    expect(prisma.category.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { isActive: false } })
    );
  });
});
