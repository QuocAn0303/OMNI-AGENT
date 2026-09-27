const productService = require("../src/modules/products/product.service");

jest.mock("../src/config/prisma", () => ({
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
  },
  category: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn({})),
}));

jest.mock("../src/modules/audit/audit.service", () => ({
  log: jest.fn().mockResolvedValue(true),
}));

const prisma = require("../src/config/prisma");

describe("product.service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("getAll trả về danh sách sản phẩm có phân trang", async () => {
    prisma.product.findMany.mockResolvedValue([{ id: "p1", name: "Cafe", isActive: true }]);
    prisma.product.count.mockResolvedValue(1);

    const result = await productService.getAll({ page: 1, limit: 20 });
    expect(result.pagination).toBeDefined();
    expect(result.products).toHaveLength(1);
  });

  test("getById throw 404 nếu không tìm thấy", async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(productService.getById("invalid")).rejects.toMatchObject({ status: 404 });
  });

  test("getById trả sản phẩm nếu tìm thấy", async () => {
    prisma.product.findUnique.mockResolvedValue({ id: "p1", name: "Cafe", isActive: true });
    const result = await productService.getById("p1");
    expect(result.name).toBe("Cafe");
  });
});
