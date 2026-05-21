// src/modules/crm/campaigns.routes.js
const router = require("express").Router();
const { z } = require("zod");
const campaignsService = require("./campaigns.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate, authorize("ADMIN", "MANAGER"));

const CHANNELS = ["EMAIL", "ZALO"];
const STATUS = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED"];

const createSchema = z.object({
  name: z.string().min(1).max(150),
  channel: z.enum(CHANNELS),
  segmentId: z.string().uuid(),
  subject: z.string().max(200).optional(),
  bodyTemplate: z.string().min(1).max(10000),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  channel: z.enum(CHANNELS).optional(),
  segmentId: z.string().uuid().optional(),
  subject: z.string().max(200).optional().nullable(),
  bodyTemplate: z.string().min(1).max(10000).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// GET /api/crm/campaigns
router.get("/", async (req, res, next) => {
  try {
    success(res, await campaignsService.list(req.query));
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/campaigns/:id
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await campaignsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/campaigns/:id/recipients
router.get("/:id/recipients", async (req, res, next) => {
  try {
    const { recipients, pagination } = await campaignsService.listRecipients(
      req.params.id,
      req.query,
    );
    paginated(res, recipients, pagination);
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/campaigns
router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    created(res, await campaignsService.create(data, req.user.id), "Đã tạo chiến dịch");
  } catch (err) {
    next(err);
  }
});

// PUT /api/crm/campaigns/:id
router.put("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    success(res, await campaignsService.update(req.params.id, data, req.user.id), "Đã cập nhật");
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/campaigns/:id
router.delete("/:id", async (req, res, next) => {
  try {
    success(res, await campaignsService.remove(req.params.id, req.user.id), "Đã xóa");
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/campaigns/:id/send-now
router.post("/:id/send-now", async (req, res, next) => {
  try {
    const stats = await campaignsService.sendNow(req.params.id, req.user.id);
    success(res, stats, "Đã gửi xong");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
