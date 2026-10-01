/**
 * modules/crm/leads.routes.js — Định tuyến lead CRM
 *
 * Tổng quan:
 * - REST endpoints cho CrmLead.
 * - Record-level permission: CASHIER tự động chỉ thấy lead mình phụ trách
 *   (service `ownerScope`), ADMIN/MANAGER thấy tất cả.
 * - `PATCH /:id/stage` là endpoint cho drag-drop trên kanban lead.
 * - `POST /:id/convert` chốt lead → deal.
 * - `GET /:id/timeline` + `POST /:id/timeline` cho unified timeline.
 *
 * Hàm:
 * - GET    /                 Danh sách lead (status/stageId/leadOwnerId/source/search/overdue)
 * - GET    /fields           Metadata form/filter (status, stage, source, owner)
 * - GET    /:id              Chi tiết lead + deal đã convert
 * - POST   /                 Tạo lead
 * - PATCH  /:id              Sửa lead
 * - PATCH  /:id/stage        Đổi stage/status (kanban drag-drop)
 * - POST   /:id/convert      Chuyển thành Deal
 * - GET    /:id/timeline     Timeline lead
 * - POST   /:id/timeline     Ghi thêm entry vào timeline
 * - POST   /import           Nhập nhiều lead 1 lần
 * - DELETE /:id              Xóa lead (chặn nếu đã convert)
 */
const router = require("express").Router();
const leadsService = require("./leads.service");
const communicationService = require("./communication.service");
const {
  leadCreateSchema,
  leadUpdateSchema,
  leadStageSchema,
  leadConvertSchema,
  leadImportSchema,
  communicationCreateSchema,
  leadListQuerySchema,
} = require("./crm.pipeline.validation");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");
const { CRM_PIPELINE_ROLES } = require("./roles");

router.use(authenticate, authorize(...CRM_PIPELINE_ROLES), requireModule("crm"));

/**
 * @swagger
 * /api/crm/leads:
 *   get:
 *     summary: Danh sách lead (CASHIER chỉ thấy lead của mình)
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
 *         name: status
 *         schema: { type: string, enum: [NEW, CONTACTED, QUALIFIED, CONVERTED, DEAD] }
 *       - in: query
 *         name: stageId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: leadOwnerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: source
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: overdue
 *         description: "1 = lead chưa liên hệ quá 7 ngày"
 *         schema: { type: string, example: "1" }
 *     responses:
 *       200: { description: Danh sách lead + pagination }
 */
router.get("/", async (req, res, next) => {
  try {
    // CRM audit M9: parse query để chặn `search` quá dài và `status` ngoài enum
    // (trước đây 2 trường này đẩy thẳng xuống Prisma ⇒ 500 / seq scan toàn bảng).
    const query = leadListQuerySchema.parse(req.query);
    const { leads, pagination } = await leadsService.list(query, req.user);
    paginated(res, leads, pagination);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/fields:
 *   get:
 *     summary: Metadata cho form tạo/sửa và bộ lọc lead
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: statuses, stages, sources, owners }
 */
router.get("/fields", async (req, res, next) => {
  try {
    success(res, await leadsService.listFields(req.user));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/import:
 *   post:
 *     summary: Nhập nhiều lead 1 lần (bỏ qua lead trùng SĐT/email)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [leads]
 *             properties:
 *               leads:
 *                 type: array
 *                 maxItems: 1000
 *                 items:
 *                   type: object
 *                   required: [leadName]
 *                   properties:
 *                     leadName: { type: string }
 *                     email: { type: string }
 *                     mobileNo: { type: string }
 *                     jobTitle: { type: string }
 *                     source: { type: string }
 *                     expectedValue: { type: number }
 *     responses:
 *       200: { description: Kết quả nhập (createdCount, skipped) }
 */
router.post("/import", async (req, res, next) => {
  try {
    const { leads } = leadImportSchema.parse(req.body);
    success(res, await leadsService.importList(leads, req.user.id), "Đã nhập danh sách lead");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}:
 *   get:
 *     summary: Chi tiết lead kèm deal đã convert
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Chi tiết lead }
 *       403: { description: Không có quyền xem lead này }
 *       404: { description: Không tìm thấy }
 */
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await leadsService.getById(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads:
 *   post:
 *     summary: Tạo lead mới
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [leadName]
 *             properties:
 *               leadName: { type: string }
 *               email: { type: string }
 *               mobileNo: { type: string }
 *               jobTitle: { type: string }
 *               source: { type: string, example: "Facebook" }
 *               stageId: { type: string, format: uuid }
 *               leadOwnerId: { type: string, format: uuid }
 *               organizationId: { type: string, format: uuid }
 *               expectedValue: { type: number }
 *     responses:
 *       201: { description: Đã tạo lead }
 */
router.post("/", async (req, res, next) => {
  try {
    const data = leadCreateSchema.parse(req.body);
    created(res, await leadsService.create(data, req.user.id, req.user), "Đã tạo lead");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}/stage:
 *   patch:
 *     summary: Đổi giai đoạn/trạng thái lead (kanban drag-drop)
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
 *             properties:
 *               stageId: { type: string, format: uuid, nullable: true }
 *               status: { type: string, enum: [NEW, CONTACTED, QUALIFIED, CONVERTED, DEAD] }
 *               lastContactedAt: { type: string, format: date-time }
 *     responses:
 *       200: { description: Lead đã đổi giai đoạn }
 *       409: { description: Lead đã convert sang Deal }
 */
router.patch("/:id/stage", async (req, res, next) => {
  try {
    const data = leadStageSchema.parse(req.body);
    success(res, await leadsService.changeStage(req.params.id, data, req.user.id, req.user), "Đã chuyển giai đoạn");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}/convert:
 *   post:
 *     summary: Chuyển lead thành Deal (tự tạo/liên kết Contact)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dealName: { type: string }
 *               organizationId: { type: string, format: uuid }
 *               contactId: { type: string, format: uuid }
 *               stageId: { type: string, format: uuid }
 *               expectedValue: { type: number }
 *               expectedCloseDate: { type: string, format: date-time }
 *               dealOwnerId: { type: string, format: uuid }
 *               nextStep: { type: string }
 *               createContact: { type: boolean, default: true }
 *               note: { type: string }
 *     responses:
 *       200: { description: { deal, lead } }
 *       409: { description: Lead đã convert trước đó }
 */
router.post("/:id/convert", async (req, res, next) => {
  try {
    const payload = leadConvertSchema.parse(req.body || {});
    success(res, await leadsService.convertToDeal(req.params.id, payload, req.user.id, req.user), "Đã chuyển thành Deal");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}/timeline:
 *   get:
 *     summary: Timeline hợp nhất của lead (ghi chú + sự kiện hệ thống)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [NOTE, CALL, EMAIL, MEETING, ZALO, WHATSAPP, SYSTEM] }
 *     responses:
 *       200: { description: Danh sách timeline + pagination }
 */
router.get("/:id/timeline", async (req, res, next) => {
  try {
    // Chặn xem timeline của lead người khác
    await leadsService.getById(req.params.id, req.user);
    const { timeline, pagination } = await communicationService.listTimeline({
      leadId: req.params.id,
      type: req.query.type,
      page: req.query.page,
      limit: req.query.limit,
    });
    paginated(res, timeline, pagination);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}/timeline:
 *   post:
 *     summary: Ghi thêm ghi chú/cuộc gọi/email vào timeline lead
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
 *             required: [type, content]
 *             properties:
 *               type: { type: string, enum: [NOTE, CALL, EMAIL, MEETING, ZALO, WHATSAPP] }
 *               direction: { type: string, enum: [INBOUND, OUTBOUND] }
 *               subject: { type: string }
 *               content: { type: string }
 *               durationSec: { type: integer }
 *     responses:
 *       201: { description: Đã ghi }
 */
router.post("/:id/timeline", async (req, res, next) => {
  try {
    await leadsService.getById(req.params.id, req.user);
    const data = communicationCreateSchema.parse({ ...req.body, leadId: req.params.id });
    created(res, await communicationService.create(data, req.user.id), "Đã ghi vào timeline");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}:
 *   patch:
 *     summary: Cập nhật lead
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
router.patch("/:id", async (req, res, next) => {
  try {
    const data = leadUpdateSchema.parse(req.body);
    success(res, await leadsService.update(req.params.id, data, req.user.id, req.user), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/leads/{id}:
 *   delete:
 *     summary: Xóa lead (bị chặn nếu đã chuyển thành Deal)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã xóa }
 *       409: { description: Lead đã convert sang Deal }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    success(res, await leadsService.remove(req.params.id, req.user.id, req.user), "Đã xóa lead");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
