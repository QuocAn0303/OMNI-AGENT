/**
 * modules/crm/contacts.routes.js — Định tuyến liên hệ CRM
 *
 * Tổng quan:
 * - REST endpoints cho CrmContact (đầu mối người trong tổ chức).
 * - Xem: ADMIN/MANAGER/CASHIER. Sửa/xóa/đặt primary: ADMIN/MANAGER.
 * - Hỗ trợ lọc theo tổ chức: `GET /api/crm/contacts?organizationId=...`
 *
 * Hàm:
 * - GET    /                Danh sách liên hệ (phân trang, search, organizationId)
 * - GET    /:id             Chi tiết + lead/deal liên quan
 * - POST   /                Tạo liên hệ
 * - PATCH  /:id             Sửa liên hệ
 * - POST   /:id/primary     Đặt làm liên hệ chính của tổ chức
 * - DELETE /:id             Ẩn liên hệ (chặn nếu còn lead/deal)
 */
const router = require("express").Router();
const contactsService = require("./contacts.service");
const { contactCreateSchema, contactUpdateSchema } = require("./crm.pipeline.validation");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");

router.use(authenticate, authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"), requireModule("crm"));

const requireManager = authorize("SUPER_ADMIN", "ADMIN", "MANAGER");

/**
 * @swagger
 * /api/crm/contacts:
 *   get:
 *     summary: Danh sách liên hệ CRM
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
 *         name: organizationId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: includeInactive
 *         schema: { type: string, example: "1" }
 *     responses:
 *       200: { description: Danh sách + pagination }
 */
router.get("/", async (req, res, next) => {
  try {
    const { contacts, pagination } = await contactsService.list(req.query);
    paginated(res, contacts, pagination);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/contacts/{id}:
 *   get:
 *     summary: Chi tiết liên hệ kèm lead/deal liên quan
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Chi tiết liên hệ }
 *       404: { description: Không tìm thấy }
 */
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await contactsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/contacts:
 *   post:
 *     summary: Tạo liên hệ mới
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               jobTitle: { type: string }
 *               isPrimary: { type: boolean }
 *               organizationId: { type: string, format: uuid }
 *               customerId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Đã tạo }
 */
router.post("/", requireManager, async (req, res, next) => {
  try {
    const data = contactCreateSchema.parse(req.body);
    created(res, await contactsService.create(data, req.user.id), "Đã tạo liên hệ");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/contacts/{id}/primary:
 *   post:
 *     summary: Đặt liên hệ làm đầu mối chính của tổ chức
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã đặt làm chính }
 */
router.post("/:id/primary", requireManager, async (req, res, next) => {
  try {
    success(res, await contactsService.setPrimary(req.params.id, req.user.id), "Đã đặt liên hệ chính");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/contacts/{id}:
 *   patch:
 *     summary: Cập nhật liên hệ
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
    const data = contactUpdateSchema.parse(req.body);
    success(res, await contactsService.update(req.params.id, data, req.user.id), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/contacts/{id}:
 *   delete:
 *     summary: Ẩn liên hệ (soft delete — bị chặn nếu còn lead/deal)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã ẩn }
 *       409: { description: Còn lead/deal liên kết }
 */
router.delete("/:id", requireManager, async (req, res, next) => {
  try {
    success(res, await contactsService.remove(req.params.id, req.user.id), "Đã ẩn liên hệ");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
