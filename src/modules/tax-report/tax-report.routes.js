/**
 * modules/tax-report/tax-report.routes.js — Routes cho báo cáo thuế
 * 
 * Tổng quan:
 * - REST API cho tax-report module
 * - Yêu cầu module "tax" trong plan
 * 
 * Routes:
 * - GET /vat: Dữ liệu thuế GTGT + bảng kê bán ra + mua vào (ADMIN/MANAGER)
 * - GET /pit: Dữ liệu thuế TNCN (ADMIN/MANAGER)
 * - GET /vat/excel: Xuất Excel multi-sheet (ADMIN/MANAGER)
 * - GET /vat/xml: Xuất XML 01/GTGT HTKK (ADMIN/MANAGER)
 * - GET /bhxh/excel: Xuất Excel BHXH D02-LT (ADMIN/MANAGER)
 * 
 * Helper:
 * - parsePeriod(req): Parse year/month từ query, mặc định tháng hiện tại
 */
// src/modules/tax-report/tax-report.routes.js
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const svc = require("./tax-report.service");
const prisma = require("../../config/prisma");

const ok = (res, data) => res.json({ success: true, data });

router.use(authenticate, requireModule("tax"));

const parsePeriod = (req) => {
  const year  = parseInt(req.query.year  || new Date().getFullYear(), 10);
  const month = parseInt(req.query.month || new Date().getMonth() + 1, 10);
  if (!year || month < 1 || month > 12) throw { status: 400, message: "Kỳ báo cáo không hợp lệ" };
  return { year, month };
};

// GET /api/tax-reports/vat?year=2024&month=11
router.get("/vat", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { year, month } = parsePeriod(req);
    const [vat, sales, purchases] = await Promise.all([
      svc.generateVAT(year, month),
      svc.generateSalesList(year, month),
      svc.generatePurchaseList(year, month),
    ]);
    ok(res, { vat, sales, purchases });
  } catch (e) { next(e); }
});

// GET /api/tax-reports/pit?year=2024&month=11
router.get("/pit", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { year, month } = parsePeriod(req);
    ok(res, await svc.generatePIT(year, month));
  } catch (e) { next(e); }
});

// GET /api/tax-reports/vat/excel?year=2024&month=11
router.get("/vat/excel", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { year, month } = parsePeriod(req);
    const wb = await svc.exportExcel(year, month);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="bao-cao-thue-${year}-${String(month).padStart(2,"0")}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

// GET /api/tax-reports/vat/xml?year=2024&month=11
router.get("/vat/xml", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { year, month } = parsePeriod(req);
    const company = await prisma.companySettings.findFirst();
    const xml = await svc.exportXML(year, month, {
      name: company?.name,
      taxCode: company?.taxCode,
      address: company?.address,
      phone: company?.phone,
      email: company?.email,
    });
    res.setHeader("Content-Type", "application/xml; charset=UTF-8");
    res.setHeader("Content-Disposition", `attachment; filename="01-GTGT-${year}-${String(month).padStart(2,"0")}.xml"`);
    res.send(xml);
  } catch (e) { next(e); }
});

// GET /api/tax-reports/bhxh/excel?year=2024&month=11
router.get("/bhxh/excel", authenticate, authorize("ADMIN", "MANAGER", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const { year, month } = parsePeriod(req);
    const wb = await svc.exportBHXH(year, month);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="D02-LT-${year}-${String(month).padStart(2,"0")}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

module.exports = router;
