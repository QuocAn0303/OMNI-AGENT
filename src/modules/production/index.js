/**
 * modules/production/index.js — Điểm vào module Production
 *
 * Tổng quan:
 * - Mount tất cả sub-routers cho module sản xuất
 * - Cung cấp endpoint /overview để thống kê dashboard
 * - Yêu cầu authenticate + requireModule("production")
 *
 * Hàm:
 * - GET /overview → workOrderService.overview: Thống kê tổng WO, đang chạy, hoàn thành trong tháng, BOM active
 * - /boms → bom.routes: Mount router quản lý BOM
 * - /work-orders → work-order.routes: Mount router lệnh sản xuất
 * - /work-centers → work-center.routes: Mount router trung tâm làm việc
 * - /routings → routing.routes: Mount router quy trình sản xuất
 * - /lots → lot.routes: Mount router quản lý lô hàng
 */
// src/modules/production/index.js
const router = require("express").Router();
const workOrderService = require("./work-order.service");
const { authenticate } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");

// GET /api/production/overview — stats
router.get("/overview", authenticate, async (req, res, next) => {
  try {
    success(res, await workOrderService.overview());
  } catch (err) {
    next(err);
  }
});

router.use("/boms", require("./bom.routes"));
router.use("/work-orders", require("./work-order.routes"));
router.use("/work-centers", require("./work-center.routes"));
router.use("/routings", require("./routing.routes"));
router.use("/lots", require("./lot.routes"));
router.use("/quality", require("./quality.routes"));

module.exports = router;
