/**
 * modules/crm/organizations.routes.js — Định tuyến tổ chức (công ty) CRM
 *
 * Tổng quan:
 * - REST endpoints cho CrmOrganization.
 * - Xem: ADMIN/MANAGER/CASHIER. Sửa/xóa: ADMIN/MANAGER (dữ liệu pháp lý, ảnh hưởng
 *   báo cáo doanh thu nên không để CASHIER sửa).
 *
 * Hàm:
 * - GET    /              Danh sách tổ chức (phân trang, search, industry, includeInactive)
 * - GET    /:id           Chi tiết + contact/deal gắn với
 * - POST   /              Tạo tổ chức
 * - PATCH  /:id           Sửa tổ chức
 * - DELETE /:id           Ẩn tổ chức (chặn nếu còn lead/deal/contact)
 */
const router = require("express").Router();
const organizationsService = require("./organizations.service");
const {
  organizationCreateSchema,
  organizationUpdateSchema,
} = require("./crm.pipeline.validation");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");

router.use(authenticate, authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"), requireModule("crm"));

const requireManager = authorize("SUPER_ADMIN", "ADMIN", "MANAGER");

/**
 * @swagger
 * /api/crm/organizations:
 *   get:
 *     summary: Danh sách tổ chức trong CRM
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: industry
 *         schema: { type: string }
 *       - in: query
 *         name: includeInactive
 *         schema: { type: string, example: "1" }
 *     responses:
 *       200: { description: Danh sách + pagination }
 */
router.get("/", async (req, res, next) => {
  try {
    const { organizations, pagination } = await organizationsService.list(req.query);
    paginated(res, organizations, pagination);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/organizations/{id}:
 *   get:
 *     summary: Chi tiết tổ chức kèm contact và deal
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Chi tiết tổ chức }
 *       404: { description: Không tìm thấy }
 */
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await organizationsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/organizations:
 *   post:
 *     summary: Tạo tổ chức mới
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Công ty CP Công nghệ Aduu" }
 *               website: { type: string }
 *               industry: { type: string, example: "Phần mềm" }
 *               annualRevenue: { type: number }
 *               taxCode: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *     responses:
 *       201: { description: Đã tạo }
 *       409: { description: Tên tổ chức đã tồn tại }
 */
router.post("/", requireManager, async (req, res, next) => {
  try {
    const data = organizationCreateSchema.parse(req.body);
    created(res, await organizationsService.create(data, req.user.id), "Đã tạo tổ chức");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/organizations/{id}:
 *   patch:
 *     summary: Cập nhật tổ chức
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã cập nhật }
 */
router.patch("/:id", requireManager, async (req, res, next) => {
  try {
    const data = organizationUpdateSchema.parse(req.body);
    success(res, await organizationsService.update(req.params.id, data, req.user.id), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/organizations/{id}:
 *   delete:
 *     summary: Ẩn tổ chức (soft delete — bị chặn nếu còn lead/deal/contact)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã ẩn }
 *       409: { description: Còn bản ghi liên kết }
 */
router.delete("/:id", requireManager, async (req, res, next) => {
  try {
    success(res, await organizationsService.remove(req.params.id, req.user.id), "Đã ẩn tổ chức");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
