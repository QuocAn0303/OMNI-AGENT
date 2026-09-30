/**
 * modules/crm/deals.routes.js — Định tuyến deal CRM
 *
 * Tổng quan:
 * - REST endpoints cho CrmDeal + dòng sản phẩm CrmDealItem.
 * - Record-level permission: CASHIER chỉ thấy deal mình phụ trách.
 * - `GET /board` trả dữ liệu kanban (cột theo stage) — tự lazy-seed stage mặc định.
 * - `GET /forecast` trả weighted forecast + win rate + won/lost theo tháng.
 * - `PATCH /:id/stage` là endpoint cho drag-drop; `POST /:id/convert-to-order` chỉ
 *   chạy được khi deal ở giai đoạn Thắng.
 *
 * Hàm:
 * - GET    /                      Danh sách deal (kind/stageId/dealOwnerId/organizationId/search)
 * - GET    /board                 Dữ liệu kanban
 * - GET    /forecast              Weighted forecast + thống kê thắng/thua
 * - GET    /:id                   Chi tiết deal + items
 * - POST   /                      Tạo deal
 * - PATCH  /:id                   Sửa deal
 * - PATCH  /:id/stage             Đổi giai đoạn (kanban drag-drop)
 * - PUT    /:id/items             Thay danh sách dòng sản phẩm
 * - GET    /:id/timeline          Timeline deal
 * - POST   /:id/timeline          Ghi entry vào timeline deal
 * - POST   /:id/convert-to-order  Tạo đơn hàng từ deal thắng
 * - DELETE /:id                   Xóa deal (chặn nếu đã tạo đơn)
 */
const router = require("express").Router();
const { z } = require("zod");
const dealsService = require("./deals.service");
const communicationService = require("./communication.service");
const {
  dealCreateSchema,
  dealUpdateSchema,
  dealStageSchema,
  dealConvertOrderSchema,
  dealItemSchema,
  communicationCreateSchema,
} = require("./crm.pipeline.validation");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created, paginated } = require("../../utils/response");

router.use(authenticate, authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"), requireModule("crm"));

const itemsSchema = z.object({ items: z.array(dealItemSchema).max(200, "tối đa 200 dòng") });

/**
 * @swagger
 * /api/crm/deals:
 *   get:
 *     summary: Danh sách deal (CASHIER chỉ thấy deal của mình)
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
 *         name: kind
 *         schema: { type: string, enum: [ONGOING, WON, LOST] }
 *       - in: query
 *         name: stageId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: dealOwnerId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: organizationId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Danh sách deal + pagination }
 */
router.get("/", async (req, res, next) => {
  try {
    const { deals, pagination } = await dealsService.list(req.query, req.user);
    paginated(res, deals, pagination);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/board:
 *   get:
 *     summary: Dữ liệu kanban deal (cột theo giai đoạn, count + tổng giá trị)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: includeClosed
 *         description: "1 = kèm cả deal Thắng/Thua"
 *         schema: { type: string, example: "1" }
 *     responses:
 *       200: { description: columns[] + summary }
 */
router.get("/board", async (req, res, next) => {
  try {
    const includeClosed = ["1", "true", "yes"].includes(String(req.query.includeClosed || "").toLowerCase());
    success(res, await dealsService.getBoard(req.user, { includeClosed }));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/forecast:
 *   get:
 *     summary: Weighted forecast + win rate + deal thắng/thua theo tháng
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: months
 *         schema: { type: integer, default: 6 }
 *     responses:
 *       200: { description: summary, byStage, byMonth, lostReasons }
 */
router.get("/forecast", async (req, res, next) => {
  try {
    success(res, await dealsService.getForecast(req.user, { months: req.query.months }));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals:
 *   post:
 *     summary: Tạo deal mới
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dealName]
 *             properties:
 *               dealName: { type: string }
 *               organizationId: { type: string, format: uuid }
 *               contactId: { type: string, format: uuid }
 *               stageId: { type: string, format: uuid }
 *               value: { type: number }
 *               probability: { type: integer, minimum: 0, maximum: 100 }
 *               expectedCloseDate: { type: string, format: date-time }
 *               nextStep: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [quantity, unitPrice]
 *                   properties:
 *                     productId: { type: string, format: uuid }
 *                     description: { type: string }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number }
 *                     discount: { type: number }
 *     responses:
 *       201: { description: Đã tạo deal }
 */
router.post("/", async (req, res, next) => {
  try {
    const data = dealCreateSchema.parse(req.body);
    created(res, await dealsService.create(data, req.user.id, req.user), "Đã tạo deal");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}:
 *   get:
 *     summary: Chi tiết deal kèm danh sách sản phẩm
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Chi tiết deal }
 *       403: { description: Không có quyền xem deal này }
 */
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await dealsService.getById(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}/stage:
 *   patch:
 *     summary: Đổi giai đoạn deal (kanban drag-drop) — tự cập nhật kind/probability/closedAt
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
 *               lostReason: { type: string }
 *     responses:
 *       200: { description: Deal đã đổi giai đoạn }
 *       400: { description: Chuyển sang Thua mà thiếu lý do thua }
 *       409: { description: Deal đã tạo đơn hàng }
 */
router.patch("/:id/stage", async (req, res, next) => {
  try {
    const data = dealStageSchema.parse(req.body);
    success(res, await dealsService.changeStage(req.params.id, data, req.user.id, req.user), "Đã chuyển giai đoạn");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}/items:
 *   put:
 *     summary: Thay toàn bộ danh sách sản phẩm của deal
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
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [quantity, unitPrice]
 *                   properties:
 *                     productId: { type: string, format: uuid }
 *                     description: { type: string }
 *                     quantity: { type: number }
 *                     unitPrice: { type: number }
 *                     discount: { type: number }
 *     responses:
 *       200: { description: Đã cập nhật danh sách sản phẩm }
 */
router.put("/:id/items", async (req, res, next) => {
  try {
    const { items } = itemsSchema.parse(req.body);
    success(res, await dealsService.upsertItems(req.params.id, items, req.user.id, req.user), "Đã cập nhật sản phẩm");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}/timeline:
 *   get:
 *     summary: Timeline hợp nhất của deal
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Danh sách timeline + pagination }
 */
router.get("/:id/timeline", async (req, res, next) => {
  try {
    await dealsService.getById(req.params.id, req.user);
    const { timeline, pagination } = await communicationService.listTimeline({
      dealId: req.params.id,
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
 * /api/crm/deals/{id}/timeline:
 *   post:
 *     summary: Ghi thêm ghi chú/cuộc gọi/email vào timeline deal
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Đã ghi }
 */
router.post("/:id/timeline", async (req, res, next) => {
  try {
    await dealsService.getById(req.params.id, req.user);
    const data = communicationCreateSchema.parse({ ...req.body, dealId: req.params.id });
    created(res, await communicationService.create(data, req.user.id), "Đã ghi vào timeline");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}/convert-to-order:
 *   post:
 *     summary: Tạo đơn hàng từ deal đã thắng (delegate orderService — sinh mã ORD, trừ kho, bút toán)
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
 *               customerId: { type: string, format: uuid }
 *               createCustomer: { type: boolean, default: true }
 *               warehouseId: { type: string, format: uuid }
 *               orderStatus: { type: string, enum: [PENDING, CONFIRMED, COMPLETED] }
 *               paymentMethod: { type: string, enum: [CASH, BANK_TRANSFER, CARD] }
 *               note: { type: string }
 *     responses:
 *       200: { description: { deal, order } }
 *       400: { description: Deal chưa thắng hoặc chưa có sản phẩm }
 *       409: { description: Deal đã có đơn hàng }
 */
router.post("/:id/convert-to-order", async (req, res, next) => {
  try {
    const payload = dealConvertOrderSchema.parse(req.body || {});
    success(res, await dealsService.convertToOrder(req.params.id, payload, req.user.id, req.user), "Đã tạo đơn hàng");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}:
 *   patch:
 *     summary: Cập nhật deal
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
    const data = dealUpdateSchema.parse(req.body);
    success(res, await dealsService.update(req.params.id, data, req.user.id, req.user), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/crm/deals/{id}:
 *   delete:
 *     summary: Xóa deal (bị chặn nếu đã tạo đơn hàng)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Đã xóa }
 *       409: { description: Deal đã tạo đơn hàng }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    success(res, await dealsService.remove(req.params.id, req.user.id, req.user), "Đã xóa deal");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
