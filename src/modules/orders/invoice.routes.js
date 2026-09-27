/**
 * modules/orders/invoice.routes.js — Routes quản lý hóa đơn
 * 
 * Tổng quan:
 * - Download hóa đơn PDF và gửi email
 * - Yêu cầu authenticate
 * 
 * Endpoints:
 * - GET /:id/download: Tải xuống hóa đơn PDF (ADMIN, MANAGER, CASHIER)
 * - POST /:id/send-email: Gửi email hóa đơn cho khách (ADMIN, MANAGER)
 */

/**
 * @swagger
 * /api/invoices:
 *   get:
 *     summary: Danh sách hóa đơn (ADMIN, MANAGER, ACCOUNTANT, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: OK }
 *
 * /api/invoices/{id}/download:
 *   get:
 *     summary: Tải hóa đơn PDF (ADMIN, MANAGER, CASHIER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: File PDF hóa đơn
 *         content:
 *           application/pdf: { schema: { type: string, format: binary } }
 *
 * /api/invoices/{id}/send-email:
 *   post:
 *     summary: Gửi email hóa đơn cho khách (ADMIN, MANAGER)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Đã gửi email hóa đơn }
 */
const router = require("express").Router();
const { z } = require("zod");
const invoiceService = require("./invoice.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, paginated } = require("../../utils/response");

router.use(authenticate);

router.get(
  "/",
  authorize("ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER"),
  async (req, res, next) => {
    try {
      const { invoices, pagination } = await invoiceService.list(req.query);
      paginated(res, invoices, pagination);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:id/download",
  authorize("ADMIN", "MANAGER", "CASHIER"),
  async (req, res, next) => {
    try {
      const invoice = await invoiceService.getById(req.params.id);
      const { buffer, redirectUrl } = await invoiceService.generateInvoicePDF(
        invoice.orderId,
      );
      if (redirectUrl) return res.redirect(redirectUrl);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${invoice.invoiceCode}.pdf"`,
      );
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:id/send-email",
  authorize("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      success(
        res,
        await invoiceService.sendEmail(req.params.id, req.user.id),
        "Đã gửi email hóa đơn",
      );
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
