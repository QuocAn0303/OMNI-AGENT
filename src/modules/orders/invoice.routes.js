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
const router = require("express").Router();
const { z } = require("zod");
const invoiceService = require("./invoice.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");

router.use(authenticate);

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
