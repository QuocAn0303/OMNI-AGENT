/**
 * modules/products/product.service.test.js — Unit test cho Product Service
 * 
 * Tổng quan:
 * - Mock Prisma để test các hàm CRUD của product service.
 * - Kiểm tra pagination, tạo sản phẩm kèm inventory, getById, soft delete.
 * 
 * Test suites:
 * - getAll: Trả về danh sách + pagination hợp lệ; skip tính đúng khi page > 1
 * - create: Tạo sản phẩm và khởi tạo inventory với quantity = 0
 * - getById: Trả về sản phẩm theo id kèm inventory; ném 404 khi không tìm thấy
 * - remove: Soft delete (set isActive = false)
 */
const productService = require('./product.service');
const prisma = require('../../config/prisma');

jest.mock('../../config/prisma', () => ({
  product: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

describe('Product Service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getAll', () => {
    it('trả về danh sách sản phẩm và phân trang hợp lệ', async () => {
      const mockProducts = [{ id: '1', name: 'Vợt cầu lông', inventories: [] }];
      prisma.product.findMany.mockResolvedValue(mockProducts);
      prisma.product.count.mockResolvedValue(1);

      const result = await productService.getAll({ page: 1, limit: 10 });

      expect(result.products).toEqual([{ ...mockProducts[0], inventory: null }]);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    });

    it('pagination tính đúng skip khi page > 1', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(25);

      const result = await productService.getAll({ page: 2, limit: 10 });

      expect(result.pagination.totalPages).toBe(3);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });
  });

  describe('create', () => {
    it('tạo sản phẩm và khởi tạo kho bằng 0', async () => {
      const inputData = {
        name: 'Vợt Yonex',
        sku: 'YNX01',
        price: 2000000,
        costPrice: 1500000,
        categoryId: 'cat-1',
      };
      const expectedOutput = { id: 'new-id', ...inputData };
      prisma.product.create.mockResolvedValue(expectedOutput);

      const result = await productService.create(inputData);

      expect(result).toEqual(expectedOutput);
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: {
          name: inputData.name,
          sku: inputData.sku,
          price: inputData.price,
          costPrice: inputData.costPrice,
          categoryId: inputData.categoryId,
          inventories: { create: { quantity: 0, warehouseId: 'wh-test' } },
        },
      });
    });
  });

  describe('getById', () => {
    it('trả về sản phẩm theo id', async () => {
      const mockProduct = {
        id: 'p1',
        name: 'SP A',
        inventories: [{ quantity: 10, warehouseId: 'wh-test' }],
      };
      prisma.product.findUnique.mockResolvedValue(mockProduct);

      const result = await productService.getById('p1');
      expect(result.inventory).toEqual({ quantity: 10, warehouseId: 'wh-test' });
    });

    it('ném lỗi 404 khi không tìm thấy', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(productService.getById('nope')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('remove', () => {
    it('soft delete: set isActive = false', async () => {
      prisma.product.update.mockResolvedValue({ id: 'p1', isActive: false });
      await productService.remove('p1');
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } })
      );
    });
  });
});
