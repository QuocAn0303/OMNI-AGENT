/**
 * modules/crm/stages.routes.js — Định tuyến cấu hình stage pipeline
 *
 * Tổng quan:
 * - REST endpoints cho CrmPipelineStage (bảng cấu hình, admin tự CRUD).
 * - GET / tự lazy-seed stage mặc định nếu tenant chưa có (lần gọi đầu tiên).
 * - Xem stage: mọi role trong pipeline. Sửa/xóa/đổi thứ tự: ADMIN/MANAGER.
 *
 * Hàm:
 * - GET    /                      Danh sách stage (?entityType=LEAD|DEAL&includeInactive=1)
 * - POST   /                      Tạo stage
 * - PATCH  /:id                   Sửa stage (kể cả isActive để ẩn)
 * - DELETE /:id                   Xóa stage (chặn nếu còn lead/deal)
 * - POST   /reorder               Gán lại sortOrder hàng loạt
 */
const router = require("express").Router();
const stagesService = require("./stages.service");
const {
  stageCreateSchema,
  stageUpdateSchema,
  stageReorderSchema,
} = require("./crm.pipeline.validation");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");
const { CRM_PIPELINE_ROLES, CRM_MANAGER_ROLES } = require("./roles");

router.use(authenticate, authorize(...CRM_PIPELINE_ROLES), requireModule("crm"));

// CASHIER chỉ xem được stage; cấu hình pipeline dành cho ADMIN/MANAGER
const requireManager = authorize(...CRM_MANAGER_ROLES);

/**
 * @swagger
 * /api/crm/stages:
 *   get:
 *     summary: Danh sách giai đoạn của pipeline (tự tạo stage mặc định nếu tenant chưa có)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: entityType
 *         schema: { type: string, enum: [LEAD, DEAL] }
 *       - in: query
 *         name: includeInactive
 *         schema: { type: string, example: "1" }
 *     responses:
 *       200: { description: Danh sách stage }
 */
router.get("/", async (req, res, next) => {
  try {
    await stagesService.ensureDefaultStages();
    const entityType = req.query.entityType === "LEAD" ? "LEAD" : "DEAL";
    const includeInactive = ["1", "true", "yes"].includes(
      String(req.query.includeInactive || "").toLowerCase(),
    );
    const stages = await stagesService.list(entityType, { includeInactive });
    success(res, { entityType, stages });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/stages:
 *   post:
 *     summary: Tạo giai đoạn mới cho pipeline
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, label]
 *             properties:
 *               entityType: { type: string, enum: [LEAD, DEAL] }
 *               label: { type: string, example: "Đàm phán" }
 *               color: { type: string, example: "#7c3aed" }
 *               sortOrder: { type: integer }
 *               kind: { type: string, enum: [ONGOING, WON, LOST] }
 *               probability: { type: integer, minimum: 0, maximum: 100 }
 *     responses:
 *       201: { description: Stage đã tạo }
 *       409: { description: Trùng nhãn trong cùng entityType }
 */
router.post("/", requireManager, async (req, res, next) => {
  try {
    const data = stageCreateSchema.parse(req.body);
    created(res, await stagesService.create(data, req.user.id), "Đã tạo giai đoạn");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/stages/reorder:
 *   post:
 *     summary: Gán lại thứ tự hiển thị của các stage
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stages]
 *             properties:
 *               stages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     sortOrder: { type: integer }
 *     responses:
 *       200: { description: Đã cập nhật thứ tự }
 */
router.post("/reorder", requireManager, async (req, res, next) => {
  try {
    const { stages } = stageReorderSchema.parse(req.body);
    success(res, await stagesService.reorder(stages, req.user.id), "Đã cập nhật thứ tự");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/stages/{id}:
 *   patch:
 *     summary: Cập nhật giai đoạn (đổi màu, thứ tự, kind, probability, isActive)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Stage đã cập nhật }
 *       404: { description: Không tìm thấy }
 */
router.patch("/:id", requireManager, async (req, res, next) => {
  try {
    const data = stageUpdateSchema.parse(req.body);
    success(res, await stagesService.update(req.params.id, data, req.user.id), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/stages/{id}:
 *   delete:
 *     summary: Xóa giai đoạn (bị chặn nếu còn lead/deal tham chiếu)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã xóa }
 *       409: { description: Còn lead/deal đang ở giai đoạn này }
 */
router.delete("/:id", requireManager, async (req, res, next) => {
  try {
    success(res, await stagesService.remove(req.params.id, req.user.id), "Đã xóa giai đoạn");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
