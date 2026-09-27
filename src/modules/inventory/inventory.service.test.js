/**
 * modules/inventory/inventory.service.test.js — Unit test cho Inventory Service
 * 
 * Tổng quan:
 * - Mock Prisma ($transaction, inventory, inventoryTransaction) để test các hàm inventory.
 * - Kiểm tra getLowStock, importStock, exportStock, getTransactions.
 * 
 * Test suites:
 * - getLowStock: Trả về sản phẩm có tồn khả dụng < threshold; dùng threshold mặc định 10
 * - importStock: Gọi $transaction, cập nhật quantity + tạo giao dịch IMPORT; ném 404 nếu không tìm thấy inventory
 * - exportStock: Giảm tồn + tạo giao dịch EXPORT; ném 400 nếu tồn không đủ
 * - getTransactions: Trả về danh sách transactions với pagination
 */
const inventoryService = require('./inventory.service');
const prisma = require('../../config/prisma');

jest.mock('../../config/prisma', () => ({
  $transaction: jest.fn(),
  inventory: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  inventoryTransaction: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  inventoryLot: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  lotTransaction: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
}));

describe('Inventory Service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getLowStock', () => {
    it('trả về danh sách sản phẩm có tồn khả dụng thấp hơn threshold', async () => {
      const mockRows = [
        { id: 'inv-1', quantity: 5, reserved: 0, product: { name: 'Giày', sku: 'G01', isActive: true } },
        { id: 'inv-2', quantity: 50, reserved: 0, product: { name: 'Áo', sku: 'A01', isActive: true } },
      ];
      prisma.inventory.findMany.mockResolvedValue(mockRows);

      const result = await inventoryService.getLowStock(10);

      expect(result).toHaveLength(1);
      expect(result[0].available).toBe(5);
      expect(prisma.inventory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { product: { isActive: true } },
        })
      );
    });

    it('dùng threshold mặc định là 10 khi không truyền tham số', async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { id: 'inv-1', quantity: 8, reserved: 0, product: { isActive: true } },
      ]);

      const result = await inventoryService.getLowStock();
      expect(result).toHaveLength(1);
    });
  });

  describe('importStock', () => {
    it('gọi $transaction và trả về inventory đã cập nhật', async () => {
      const mockUpdatedInventory = { id: 'inv-1', quantity: 50 };
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          inventory: {
            findUnique: jest.fn().mockResolvedValue({ id: 'inv-1', quantity: 0 }),
            update: jest.fn().mockResolvedValue(mockUpdatedInventory),
          },
          inventoryTransaction: {
            create: jest.fn().mockResolvedValue({}),
          },
          inventoryLot: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
          lotTransaction: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
          product: { findUnique: jest.fn().mockResolvedValue({ costPrice: 0 }) },
        };
        return callback(tx);
      });

      const result = await inventoryService.importStock(
        { productId: 'prod-1', quantity: 50, note: 'Nhập lô mới' },
        'user-admin'
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual(mockUpdatedInventory);
    });

    it('ném lỗi 404 khi không tìm thấy inventory', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          inventory: { findUnique: jest.fn().mockResolvedValue(null) },
          inventoryLot: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
          lotTransaction: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
          product: { findUnique: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        inventoryService.importStock({ productId: 'nope', quantity: 10 }, 'user-1')
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('exportStock', () => {
    it('giảm tồn và ghi giao dịch EXPORT', async () => {
      const mockUpdated = { id: 'inv-1', quantity: 40 };
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          inventory: {
            findUnique: jest.fn().mockResolvedValue({ id: 'inv-1', quantity: 50, reserved: 0 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          inventoryTransaction: {
            create: jest.fn().mockResolvedValue({}),
          },
          inventoryLot: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({}),
          },
          lotTransaction: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({}),
          },
          product: {
            findUnique: jest.fn().mockResolvedValue({ costPrice: 0 }),
          },
        };
        return callback(tx);
      });

      const result = await inventoryService.exportStock(
        { productId: 'prod-1', quantity: 10, note: 'Xuất điều chuyển' },
        'user-wh'
      );

      expect(result).toEqual({ id: 'inv-1', quantity: 40, reserved: 0 });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('ném lỗi 400 khi tồn không đủ', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          inventory: {
            findUnique: jest.fn().mockResolvedValue({ id: 'inv-1', quantity: 5 }),
          },
          inventoryLot: { findMany: jest.fn().mockResolvedValue([]) },
          lotTransaction: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
          product: { findUnique: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        inventoryService.exportStock({ productId: 'prod-1', quantity: 10 }, 'user-1')
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getTransactions', () => {
    it('trả về danh sách transactions với pagination', async () => {
      const mockTxs = [{ id: 'tx1', type: 'IMPORT', quantity: 10 }];
      prisma.inventoryTransaction.findMany.mockResolvedValue(mockTxs);
      prisma.inventoryTransaction.count.mockResolvedValue(1);

      const result = await inventoryService.getTransactions({ page: 1, limit: 10 });

      expect(result.transactions).toEqual(mockTxs);
      expect(result.pagination.total).toBe(1);
    });
  });
});
