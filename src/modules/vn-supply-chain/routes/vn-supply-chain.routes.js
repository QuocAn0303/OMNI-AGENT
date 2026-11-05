'use strict';

const { Router } = require('express');
const { buildVnSeedData } = require('../vnSeedData');
const { quoteShipping } = require('../services/logistics.service');
const { logQuerySchema } = require('../services/validation');

/** Explicit opt-in mounting. All data is synthetic, read-only and shared demo data. */
function createRouter(dependencies = {}) {
  const { authenticate, authorize } = dependencies.auth || require('../../../middleware/auth.middleware');
  const { success } = dependencies.response || require('../../../utils/response');
  const router = Router();
  let dataset;
  const getDataset = () => {
    if (!dataset) dataset = buildVnSeedData();
    return dataset;
  };
  router.use(authenticate);
  router.use(authorize('ADMIN', 'MANAGER', 'WAREHOUSE', 'ACCOUNTANT'));

  /**
   * @swagger
   * /api/vn-supply-chain/catalog:
   *   get:
   *     summary: Danh mục kho, SKU, NCC và 3PL mô phỏng Việt Nam
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Danh mục mô phỏng, tiền tệ VNĐ }
   */
  router.get('/catalog', (req, res, next) => {
    try { success(res, getDataset().catalog); } catch (error) { next(error); }
  });

  /**
   * @swagger
   * /api/vn-supply-chain/operations:
   *   get:
   *     summary: Cầu và đơn theo ngày, kho, SKU, kênh trong 60 ngày mô phỏng
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: query, name: date, schema: { type: string, format: date } }
   *       - { in: query, name: warehouseId, schema: { type: string, enum: [WH-HCM, WH-HN] } }
   *       - { in: query, name: sku, schema: { type: string, enum: [VN-A-001, VN-A-002, VN-B-001, VN-B-002, VN-S-001] } }
   *       - { in: query, name: channel, schema: { type: string, enum: [Shopee, TikTok Shop, Website, POS] } }
   *       - { in: query, name: page, schema: { type: integer, minimum: 1, maximum: 10000, default: 1 } }
   *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 200, default: 100 } }
   *     responses:
   *       200: { description: Dữ liệu và phân trang }
   *       400: { description: Bộ lọc không hợp lệ }
   */
  router.get('/operations', (req, res, next) => {
    try {
      const { page, limit, ...filters } = logQuerySchema.parse(req.query);
      const rows = getDataset().operations.demand.filter(row =>
        Object.entries(filters).every(([key, value]) => row[key] === value));
      success(res, { rows: rows.slice((page - 1) * limit, page * limit),
        pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) },
        metadata: getDataset().operations.metadata });
    } catch (error) { next(error); }
  });

  /**
   * @swagger
   * /api/vn-supply-chain/audit:
   *   get:
   *     summary: Đối chiếu tồn kho với GRN, xuất bán và hoàn đạt QC
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Kết quả cân bằng 600 dòng tồn kho }
   */
  router.get('/audit', (req, res, next) => {
    try { success(res, getDataset().audit); } catch (error) { next(error); }
  });

  /**
   * @swagger
   * /api/vn-supply-chain/shipping-quote:
   *   post:
   *     summary: Tính phí vận chuyển mô phỏng bằng VNĐ
   *     tags: [VN Supply Chain]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [carrierId, lane, originCity, destinationCity, weightGram, volumeCm3]
   *             properties:
   *               carrierId: { type: string, enum: [GHN, GHTK, VTP, AHAMOVE_2H] }
   *               lane: { type: string, enum: [INTRACITY, REGIONAL, INTERREGIONAL] }
   *               originCity: { type: string }
   *               destinationCity: { type: string }
   *               weightGram: { type: integer, minimum: 1, maximum: 1000000 }
   *               volumeCm3: { type: integer, minimum: 1, maximum: 10000000 }
   *               distanceKm: { type: number, minimum: 0, maximum: 3000, default: 5 }
   *               codAmount: { type: integer, minimum: 0, maximum: 100000000, default: 0 }
   *     responses:
   *       200: { description: Phí và SLA mô phỏng }
   *       400: { description: Tuyến hoặc trọng lượng không hợp lệ }
   */
  router.post('/shipping-quote', (req, res, next) => {
    try { success(res, quoteShipping(req.body)); } catch (error) { next(error); }
  });
  return router;
}
module.exports = createRouter;
