/**
 * modules/crm/webhook-lead.routes.js — Routes webhook lead + quản lý API key (Mục 2)
 *
 * Routes:
 * - POST /api/webhook/crm-lead        : PUBLIC — nhận lead đa kênh (header X-Tenant-Key)
 *                                        + Idempotency-Key tùy chọn (chống ghi trùng webhook)
 * - POST /api/webhook/crm-lead-key    : ADMIN+ — sinh/rotate API key của tenant
 * - GET  /api/webhook/crm-lead-key    : ADMIN+ — xem key (đã mask)
 *
 * CRM audit M1: 2 route quản lý API key trước đây thiếu `requireModule` ⇒ gói không
 * mua CRM vẫn tạo được API key webhook. Và chỉ cho `ADMIN` ⇒ không role nào cao hơn
 * ADMIN xoay được key khi ADMIN đi nghỉ/vô hiệu hoá. Nay dùng `CRM_ADMIN_ROLES`.
 */
const router = require("express").Router();
const { z } = require("zod");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { success, created, error } = require("../../utils/response");
const { getTenantId } = require("../../config/tenantContext");
const service = require("./lead-capture.service");
const { requireModule } = require("../../middleware/plan.middleware");
const { CRM_ADMIN_ROLES } = require("./roles");

// Payload chuẩn theo đặc tả Mục 2.1
const leadSchema = z.object({
  source: z.string().min(1),
  fullName: z.string().min(1),
  phone: z.string().min(8).max(15),
  email: z.string().email().optional().nullable(),
  productInterest: z.string().optional(),
  campaignId: z.string().optional(),
});

/**
 * @swagger
 * /api/webhook/crm-lead:
 *   post:
 *     summary: Webhook thu thập lead đa kênh (public — xác thực X-Tenant-Key)
 *     tags: [CRM]
 *     parameters:
 *       - in: header
 *         name: X-Tenant-Key
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         description: "Webhook retry an toàn — cùng key trong 24h trả về kết quả đã ghi nhận (không tạo trùng)"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source, fullName, phone]
 *             properties:
 *               source: { type: string, example: "Affiliate_Partner_01" }
 *               fullName: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               productInterest: { type: string }
 *               campaignId: { type: string }
 *     responses:
 *       201: { description: Lead đã ghi nhận — trả customerId }
 *       200: { description: Idempotency-Key trùng — trả về kết quả đã ghi nhận trước đó }
 *       400: { description: Payload sai schema }
 *       401: { description: X-Tenant-Key không hợp lệ }
 */
router.post("/crm-lead", async (req, res, next) => {
  try {
    const tenantId = await service.resolveTenant(req.headers["x-tenant-key"]);
    if (!tenantId) return error(res, "X-Tenant-Key không hợp lệ", 401);
    const payload = leadSchema.parse(req.body);
    const idempotencyKey = req.headers["idempotency-key"] || null;
    const result = await service.captureLead(tenantId, payload, idempotencyKey);
    // Retry với cùng Idempotency-Key trong TTL → trả 200 (không tạo thêm record)
    if (result.duplicate) return success(res, result, "Lead đã được ghi nhận trước đó (idempotent)");
    return created(res, result, "Lead đã được ghi nhận");
  } catch (e) {
    return next(e); // ZodError → error.middleware tự trả 400
  }
});

/**
 * @swagger
 * /api/webhook/crm-lead-key:
 *   post:
 *     summary: Sinh/rotate API key webhook lead của tenant (ADMIN)
 *     tags: [CRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: API key mới (chỉ hiển thị 1 lần) }
 */
router.post(
  "/crm-lead-key",
  authenticate,
  authorize(...CRM_ADMIN_ROLES),
  requireModule("crm"),
  async (req, res, next) => {
    try {
      success(res, await service.generateApiKey(getTenantId(), req.user.id), "Đã phát hành API key mới");
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/crm-lead-key",
  authenticate,
  authorize(...CRM_ADMIN_ROLES),
  requireModule("crm"),
  async (req, res, next) => {
    try {
      success(res, await service.listApiKey(getTenantId()));
    } catch (e) {
      next(e);
    }
  },
);

module.exports = router;
