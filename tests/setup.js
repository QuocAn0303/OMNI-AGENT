require('dotenv').config();

process.env.JWT_SECRET = 'test-secret-key';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';
process.env.DEFAULT_WAREHOUSE_ID = 'wh-test';

jest.mock('../src/utils/warehouse.helper', () => ({
  getDefaultWarehouseId: jest.fn().mockResolvedValue('wh-test'),
  resolveWarehouseId: jest.fn().mockResolvedValue('wh-test'),
  findInventory: jest.fn(async (tx, productId) => {
    const client = tx?.inventory?.findUnique ? tx : require('../src/config/prisma');
    return client.inventory.findUnique({ where: { productId } });
  }),
  attachDefaultInventory: (p, inv) => ({ ...p, inventory: inv }),
  clearWarehouseCache: jest.fn(),
}));
