/**
 * modules/pos/pos.routes.js — Routes cho POS (bán hàng nhanh tại quầy)
 *
 * Tổng quan:
 * - Các endpoint hỗ trợ POS: danh mục, sản phẩm, quét SKU, tạo đơn nhanh
 * - Yêu cầu authenticate + gói pos + role ADMIN/MANAGER/CASHIER
 */

/**
 * @swagger
 * /api/pos/products:
 *   get:
 *     summary: Danh sách sản phẩm cho POS (có barcode để quét)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/pos/categories:
 *   get:
 *     summary: Danh sách danh mục cho POS
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *
 * /api/pos/products/sku/{sku}:
 *   get:
 *     summary: Tìm sản phẩm theo mã SKU (quét barcode)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sku
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Không tìm thấy sản phẩm }
 *
 * /api/pos/orders:
 *   post:
 *     summary: Tạo đơn hàng nhanh từ POS
 *     security: [{ bearerAuth: [] }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object } } } }
 *     responses:
 *       201: { description: Tạo đơn thành công }
 */
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const controller = require("./pos.controller");

router.use(authenticate, requireModule("pos"));
router.use(authorize("ADMIN", "MANAGER", "CASHIER"));

router.get("/products", controller.listProducts);
router.get("/categories", controller.listCategories);
router.get("/products/sku/:sku", controller.findBySku);
router.post("/orders", controller.createOrder);

module.exports = router;
