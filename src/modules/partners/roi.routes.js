'use strict';

/**
 * modules/partners/roi.routes.js — Báo cáo hiệu quả đối tác (PRM)
 *
 * Routes:
 *   GET /api/partner-roi          bảng xếp hạng đối tác + tổng hệ thống
 *   GET /api/partner-roi/:id      chi tiết một đối tác kèm danh sách khách đã chuyển đổi
 *
 * Đọc kỹ phần đầu `roi.service.js` trước khi dùng: `predictedValue` là giá trị
 * DỰ ĐOÁN, không phải doanh thu đã thu, và luôn đi kèm `coverage`.
 */
const router = require("express").Router();
const service = require("./roi.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");
const { PRM_READ_ROLES } = require("./roles");

router.use(authenticate, authorize(...PRM_READ_ROLES), requireModule("crm"));

const METRICS = ["predicted", "actual"];
const SORTS = ["profit", "revenue", "conversion", "referrals"];

/**
 * @swagger
 * /api/partner-roi:
 *   get:
 *     summary: Bảng xếp hạng đối tác theo lợi nhuận ròng
 *     description: >
 *       Công thức: lợi nhuận ròng = giá trị khách × số khách chuyển đổi − hoa hồng.
 *       Với metric=predicted (mặc định) dùng `Customer.clvPredicted`; đó là giá trị
 *       DỰ ĐOÁN nên phải đọc cùng `coverage` (phần khách chuyển đổi đã đủ dữ liệu để
 *       dự báo). Với metric=actual dùng `Customer.totalSpent` là tiền đã thu.
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: metric
 *         schema: { type: string, enum: [predicted, actual], default: predicted }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [profit, revenue, conversion, referrals], default: profit }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: activeOnly
 *         schema: { type: boolean, default: true }
 *     responses:
 *       200: { description: "{ metric, partners[], total, totals }" }
 */
router.get("/", async (req, res, next) => {
  try {
    const metric = METRICS.includes(req.query.metric) ? req.query.metric : "predicted";
    const sortBy = SORTS.includes(req.query.sortBy) ? req.query.sortBy : "profit";
    const data = await service.ranking({
      metric,
      sortBy,
      limit: Math.min(Number(req.query.limit) || 20, 200),
      offset: Number(req.query.offset) || 0,
      activeOnly: String(req.query.activeOnly ?? "true") !== "false",
    });
    success(res, data, "Bảng xếp hạng đối tác theo lợi nhuận ròng");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/partner-roi/{id}:
 *   get:
 *     summary: Chi tiết hiệu quả một đối tác
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Số liệu đối tác + danh sách khách đã chuyển đổi, xếp theo giá trị giảm dần" }
 *       404: { description: Không tìm thấy đối tác }
 */
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await service.detail(req.params.id), "Chi tiết hiệu quả đối tác");
  } catch (e) {
    next(e);
  }
});

module.exports = router;