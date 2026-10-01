/**
 * modules/crm/hierarchy.routes.js — API cây báo cáo (CRM Phase 4)
 *
 * Routes:
 * - GET  /                     Cây báo cáo (user lồng nhau + số lead/deal)
 * - GET  /assignable           Danh sách user có thể gán làm owner
 * - PUT  /:id/reports-to       Gán / bỏ quản lý trực tiếp (chỉ MANAGER/ADMIN)
 *
 * Ghi chú phân quyền: `authenticate` + `authorize("SUPER_ADMIN","ADMIN","MANAGER")`
 * cho toàn bộ router. Cây báo cáo là cấu hình quản trị, không phải dữ liệu giao dịch —
 * CASHIER không cần xem cây, chỉ cần danh sách owner hợp lệ (đã ở endpoint leads/deals).
 *
 * CRM audit H1: kế hoạch (mục 6b) nói "sửa cấu hình = ADMIN/MANAGER" nhưng đó là
 * đường leo thang quyền — MANAGER gán `reportsToId` của người khác cho mình là
 * thu được phạm vi của chi nhánh khác. Comment trong `hierarchy.service.js` cũng
 * ghi rõ "chỉ được sửa bởi ADMIN". Sửa cây nay CHỈ ADMIN+; xem cây vẫn MANAGER+.
 */
const router = require("express").Router();
const { z } = require("zod");
const hierarchyService = require("./hierarchy.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success } = require("../../utils/response");
const { CRM_MANAGER_ROLES, CRM_ADMIN_ROLES } = require("./roles");

// Router cho phép XEM cây (`GET /`, `GET /assignable`): ADMIN + MANAGER + SUPER_*.
// XEM cây là thao tác read-only, MANAGER cần để hiểu ai dưới quyền mình.
router.use(authenticate, authorize(...CRM_MANAGER_ROLES), requireModule("crm"));

// SỬA cây (`PUT /:id/reports-to`) là đường leo thang quyền: đặt `reportsToId` của
// một user khác là thay đổi "ai thấy pipeline của ai". Chỉ ADMIN trở lên được làm.
// Route này bắt buộc khai báo `authorize` riêng thay vì dùng `router.use` — xem
// `hierarchy.service.assertCanManage` (guard thứ 2, không phụ thuộc route).

const setReportsToSchema = z.object({
  reportsToId: z.string().uuid().nullable(),
});

/**
 * @swagger
 * /api/crm/hierarchy:
 *   get:
 *     summary: Cây báo cáo nhân viên kèm số lead/deal đang phụ trách
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Cây lồng nhau { roots, totals } }
 */
router.get("/", async (req, res, next) => {
  try {
    success(res, await hierarchyService.getTree(req.user));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/hierarchy/assignable:
 *   get:
 *     summary: Danh sách user có thể gán làm owner lead/deal
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Danh sách user }
 */
router.get("/assignable", async (req, res, next) => {
  try {
    success(res, await hierarchyService.listAssignable(req.user));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/hierarchy/{id}/reports-to:
 *   put:
 *     summary: Gán quản lý trực tiếp (null = bỏ, trở thành trưởng cao nhất)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reportsToId]
 *             properties:
 *               reportsToId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       200: { description: Đã cập nhật }
 *       400: { description: Tự báo cáo / tạo vòng lặp / khác tenant }
 *       403: { description: Không đủ quyền }
 *       404: { description: Không tìm thấy user }
 */
router.put("/:id/reports-to", authorize(...CRM_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { reportsToId } = setReportsToSchema.parse(req.body);
    const updated = await hierarchyService.setReportsTo(req.params.id, reportsToId, req.user);
    success(res, updated, "Đã cập nhật cây báo cáo");
  } catch (err) {
    next(err);
  }
});

module.exports = router;