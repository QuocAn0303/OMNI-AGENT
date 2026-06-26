/**
 * modules/crm/campaigns.routes.js — Định tuyến chiến dịch marketing
 * 
 * Tổng quan:
 * - REST endpoints cho Campaign (chiến dịch marketing: EMAIL, ZALO).
 * - Hỗ trợ cả campaign thường (customerCampaign) và campaign admin (adminCampaign)
 *   dựa trên role SUPER_OMEGA_ULTRA_ADMIN.
 * - Tích hợp Zod validation, authenticate + authorize + requireModule middleware.
 * 
 * Hàm:
 * - GET /: Danh sách campaign theo user role (campaignsService.list hoặc adminCampaignService)
 * - GET /:id: Chi tiết campaign (campaignsService.getById)
 * - GET /:id/recipients: Danh sách người nhận (campaignsService.listRecipients hoặc adminCampaignService.listRecipients)
 * - POST /: Tạo campaign mới (campaignsService.create hoặc adminCampaignService.createCampaign)
 * - PUT /:id: Cập nhật campaign (campaignsService.update hoặc adminCampaignService.updateCampaign)
 * - DELETE /:id: Xóa campaign (campaignsService.remove hoặc adminCampaignService.deleteCampaign)
 * - POST /:id/send-now: Gửi campaign ngay lập tức (campaignsService.sendNow hoặc adminCampaignService.sendCampaign)
 */
// src/modules/crm/campaigns.routes.js
const router = require("express").Router();
const { z } = require("zod");
const campaignsService = require("./campaigns.service");
const adminCampaignService = require("../admin/admin-campaign.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { paginated, created, success } = require("../../utils/response");

router.use(authenticate, authorize("ADMIN", "MANAGER", "SUPER_OMEGA_ULTRA_ADMIN"), requireModule("marketing"));

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

const adminCampaignCreateSchema = z.object({
  name: z.string().min(1).max(150),
  channel: z.enum(["EMAIL", "SMS"]),
  targetPlans: z.array(z.string()).min(1),
  subject: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
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

const isSystemAdmin = (req) => req.user.role === "SUPER_OMEGA_ULTRA_ADMIN";

// GET /api/crm/campaigns
router.get("/", async (req, res, next) => {
  try {
    success(res, await campaignsService.list(req.query, req.user));
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/campaigns/:id
router.get("/:id", async (req, res, next) => {
  try {
    success(res, await campaignsService.getById(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/campaigns/:id/recipients
router.get("/:id/recipients", async (req, res, next) => {
  try {
    if (isSystemAdmin(req)) {
      const { recipients, pagination } = await adminCampaignService.listRecipients(
        req.params.id, req.query,
      );
      paginated(res, recipients, pagination);
    } else {
      const { recipients, pagination } = await campaignsService.listRecipients(
        req.params.id, req.query,
      );
      paginated(res, recipients, pagination);
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/campaigns
router.post("/", async (req, res, next) => {
  try {
    if (isSystemAdmin(req)) {
      const data = adminCampaignCreateSchema.parse(req.body);
      created(res, await adminCampaignService.createCampaign(data, req.user.id), "Đã tạo chiến dịch");
    } else {
      const data = createSchema.parse(req.body);
      created(res, await campaignsService.create(data, req.user.id), "Đã tạo chiến dịch");
    }
  } catch (err) {
    next(err);
  }
});

// PUT /api/crm/campaigns/:id
router.put("/:id", async (req, res, next) => {
  try {
    if (isSystemAdmin(req)) {
      success(res, await adminCampaignService.updateCampaign(req.params.id, req.body, req.user.id), "Đã cập nhật");
    } else {
      const data = updateSchema.parse(req.body);
      success(res, await campaignsService.update(req.params.id, data, req.user.id), "Đã cập nhật");
    }
  } catch (err) {
    next(err);
  }
});

// DELETE /api/crm/campaigns/:id
router.delete("/:id", async (req, res, next) => {
  try {
    if (isSystemAdmin(req)) {
      await adminCampaignService.deleteCampaign(req.params.id, req.user.id);
      success(res, null, "Đã xóa");
    } else {
      success(res, await campaignsService.remove(req.params.id, req.user.id), "Đã xóa");
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/campaigns/:id/send-now
router.post("/:id/send-now", async (req, res, next) => {
  try {
    if (isSystemAdmin(req)) {
      const stats = await adminCampaignService.sendCampaign(req.params.id, req.user.id);
      success(res, stats, "Đã gửi xong");
    } else {
      const stats = await campaignsService.sendNow(req.params.id, req.user.id);
      success(res, stats, "Đã gửi xong");
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
