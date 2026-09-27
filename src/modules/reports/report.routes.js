/**
 * modules/reports/report.routes.js — Routes cho báo cáo & xuất Excel
 * 
 * Tổng quan:
 * - Yêu cầu authenticate + authorize ADMIN/MANAGER + requireModule("reports") cho tất cả route.
 * - Hỗ trợ xuất JSON và Excel (xlsx/csv).
 * 
 * Route:
 * - GET /revenue: Báo cáo doanh thu theo ngày (query: from, to)
 * - GET /revenue-monthly: Báo cáo doanh thu 12 tháng gần nhất
 * - GET /top-products: Top sản phẩm bán chạy (query: limit, default 10)
 * - GET /inventory: Báo cáo tồn kho (JSON hoặc export nếu có format)
 * - GET /revenue/export: Export Excel báo cáo doanh thu (query: from, to)
 * - GET /inventory/export: Export Excel báo cáo tồn kho
 * - GET /:type(sales|orders|inventory|customers|hr|profit): Export Excel theo loại báo cáo (query: from, to, format)
 */
// src/modules/reports/report.routes.js
const router = require("express").Router();
const { z } = require("zod");
const reportService = require("./report.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");
const {
  exportRevenueExcel,
  exportInventoryExcel,
} = require("./report.service");

// Báo cáo là dữ liệu nhạy cảm, chỉ ADMIN và MANAGER mới được xem
router.use(authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), requireModule("reports"));

// GET /api/reports/revenue?from=2024-01-01&to=2024-01-31
router.get("/revenue", async (req, res, next) => {
  try {
    const { from, to } = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const data = await reportService.getRevenue(from, to);
    success(res, data, "Lấy báo cáo doanh thu theo ngày thành công");
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/revenue-monthly
router.get("/revenue-monthly", async (req, res, next) => {
  try {
    const data = await reportService.getRevenueMonthly();
    success(res, data, "Lấy báo cáo doanh thu theo tháng thành công");
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/top-products?limit=10
router.get("/top-products", async (req, res, next) => {
  try {
    const { limit } = z
      .object({
        limit: z.coerce.number().int().positive().default(10),
      })
      .parse(req.query);

    const data = await reportService.getTopProducts(limit);
    success(res, data, "Lấy danh sách sản phẩm bán chạy thành công");
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/inventory
router.get("/inventory", async (req, res, next) => {
  try {
    if (req.query.format) {
      const { from, to, format } = z
        .object({
          from: z.string(),
          to: z.string(),
          format: z.enum(["xlsx", "csv", "pdf"]).default("xlsx"),
        })
        .parse(req.query);
      const exportFormat = format === "pdf" ? "xlsx" : format;
      const out = await reportService.exportReport("inventory", from, to, exportFormat);
      res.setHeader("Content-Type", out.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="inventory_${from}_${to}.${exportFormat}"`,
      );
      res.send(out.buffer);
      return;
    }

    const data = await reportService.getInventoryReport();
    success(res, data, "Lấy báo cáo tồn kho thành công");
  } catch (err) {
    next(err);
  }
});

// Specific export routes MUST come before the wildcard /:type route
router.get(
  "/revenue/export",
  authorize("ADMIN", "MANAGER", "ACCOUNTANT"),
  async (req, res, next) => {
    try {
      const { from, to } = z
        .object({ from: z.string(), to: z.string() })
        .parse(req.query);
      const buf = await exportRevenueExcel(from, to);
      const filename = `revenue_${from}_${to}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(buf);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/inventory/export",
  authorize("ADMIN", "MANAGER", "ACCOUNTANT"),
  async (req, res, next) => {
    try {
      const buf = await exportInventoryExcel();
      const filename = `inventory_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(buf);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:type(sales|orders|inventory|customers|hr|profit)", async (req, res, next) => {
  try {
    const { type } = req.params;
    const { from, to, format } = z
      .object({
        from: z.string(),
        to: z.string(),
        format: z.enum(["xlsx", "csv", "pdf"]).default("xlsx"),
      })
      .parse(req.query);

    const exportFormat = format === "pdf" ? "xlsx" : format;
    const out = await reportService.exportReport(type, from, to, exportFormat);
    const ext = exportFormat;
    res.setHeader("Content-Type", out.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${type}_${from}_${to}.${ext}"`,
    );
    res.send(out.buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
