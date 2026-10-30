/**
 * modules/einvoice/einvoice.routes.js — Định tuyến module Hóa đơn điện tử
 *
 * Tổng quan:
 * - Định nghĩa endpoint REST cho HĐĐT: danh sách, chi tiết, phát hành, hủy, đồng bộ
 * - Yêu cầu authenticate + requireModule("einvoice")
 * - Giới hạn quyền ADMIN/MANAGER qua authorize()
 *
 * Hàm:
 * - GET / → svc.list: Danh sách HĐĐT (ADMIN, MANAGER)
 * - GET /:id → svc.getById: Chi tiết HĐĐT (ADMIN, MANAGER)
 * - POST /order/:orderId/issue → svc.issueForOrder: Phát hành (ADMIN, MANAGER)
 * - POST /:id/cancel → svc.cancelInvoice: Hủy HĐĐT (ADMIN)
 * - POST /:id/sync → svc.syncStatus: Đồng bộ VNPT (ADMIN, MANAGER)
 */

/**
 * @swagger
 * /api/einvoice:
 *   get:
 *     summary: Danh sách hóa đơn điện tử (ADMIN, MANAGER, ACCOUNTANT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/einvoice/{id}:
 *   get:
 *     summary: Chi tiết hóa đơn điện tử (ADMIN, MANAGER, ACCOUNTANT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/einvoice/order/{orderId}/issue:
 *   post:
 *     summary: Phát hành hóa đơn điện tử cho đơn hàng (ADMIN, MANAGER, ACCOUNTANT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/einvoice/{id}/cancel:
 *   post:
 *     summary: Hủy hóa đơn điện tử (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *
 * /api/einvoice/{id}/sync:
 *   post:
 *     summary: Đồng bộ trạng thái hóa đơn từ VNPT (ADMIN, MANAGER, ACCOUNTANT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 */
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");
const svc = require("./einvoice.service");

router.use(authenticate, requireModule("einvoice"));

// GET /api/einvoice - danh sách HĐĐT
router.get("/", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { success(res, await svc.list(req.query)); } catch (e) { next(e); }
});

// GET /api/einvoice/:id
router.get("/:id", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { success(res, await svc.getById(req.params.id)); } catch (e) { next(e); }
});

// POST /api/einvoice/order/:orderId/issue - phát hành HĐĐT cho đơn hàng
router.post("/order/:orderId/issue", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { success(res, await svc.issueForOrder(req.params.orderId, req.user.id)); } catch (e) { next(e); }
});

// POST /api/einvoice/:id/cancel - hủy HĐĐT
router.post("/:id/cancel", authenticate, authorize("ADMIN"), async (req, res, next) => {
  try { success(res, await svc.cancelInvoice(req.params.id, req.user.id)); } catch (e) { next(e); }
});

// POST /api/einvoice/:id/sync - đồng bộ trạng thái từ VNPT
router.post("/:id/sync", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try { success(res, await svc.syncStatus(req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
