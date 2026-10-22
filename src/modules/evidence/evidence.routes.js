/**
 * modules/evidence/evidence.routes.js — BẰNG CHỨNG THỰC NGHIỆM (read-only)
 *
 * Trả về kết quả backtest đã lưu để hiển thị trên giao diện, kèm nguồn dữ liệu
 * và danh sách giới hạn. KHÔNG tính toán mới ở đây — chỉ đọc file kết quả đã có,
 * nên số trả về luôn khớp với báo cáo đã nộp.
 */
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success } = require("../../utils/response");
const service = require("./backtest-evidence.service");

router.use(authenticate);

/**
 * @swagger
 * /api/evidence/backtest:
 *   get:
 *     summary: Kết quả backtest so sánh chính sách tồn kho (chỉ đọc)
 *     tags: [Evidence]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: leadTime
 *         schema: { type: integer, example: 7 }
 *       - in: query
 *         name: branch
 *         schema: { type: string, enum: [A, B] }
 *       - in: query
 *         name: positionMode
 *         schema: { type: string, enum: [withOnOrder, atpOnly] }
 *     responses:
 *       200: { description: Kết quả + nguồn + giới hạn }
 */
router.get("/backtest", authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const data = await service.getSummary({
      leadTimeDays: req.query.leadTime,
      branch: req.query.branch,
      positionMode: req.query.positionMode,
    });
    success(res, data);
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/evidence/live-snapshot:
 *   get:
 *     summary: Số đo tồn kho THẬT của tenant (không mô phỏng)
 *     tags: [Evidence]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Số SKU dưới ngưỡng, hết hàng, PO đang mở }
 */
router.get("/live-snapshot", authorize("ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"), async (req, res, next) => {
  try {
    success(res, await service.getLiveSnapshot(req.tenantId));
  } catch (e) {
    next(e);
  }
});

module.exports = router;