'use strict';

/**
 * modules/partners/referral.routes.js — Giao diện lượt giới thiệu của đối tác (PRM)
 *
 * Routes:
 *   GET    /api/partner-referrals            danh sách lượt giới thiệu
 *   GET    /api/partner-referrals/funnel     phễu chuyển đổi theo từng đối tác
 *   GET    /api/partner-referrals/:id        chi tiết một lượt
 *   POST   /api/partner-referrals            nhập tay một lượt giới thiệu
 */
const router = require("express").Router();
const { z } = require("zod");
const service = require("./referral.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created } = require("../../utils/response");
const { PRM_READ_ROLES, PRM_MANAGE_ROLES } = require("./roles");

router.use(authenticate, requireModule("crm"));

const createSchema = z.object({
  partnerId: z.string().min(1, "Thiếu đối tác"),
  referredName: z.string().min(1, "Thiếu tên người được giới thiệu").max(150),
  referredPhone: z.string().min(8).max(15).optional(),
  referredEmail: z.string().email().optional().nullable(),
  leadId: z.string().optional(),
  customerId: z.string().optional(),
  referralDate: z.string().datetime().or(z.string().date()).optional(),
  converted: z.boolean().optional(),
});

/**
 * @swagger
 * /api/partner-referrals:
 *   get:
 *     summary: Danh sách lượt giới thiệu
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: partnerId
 *         schema: { type: string }
 *       - in: query
 *         name: converted
 *         schema: { type: boolean }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: "{ referrals[], pagination }" }
 */
router.get("/", authorize(...PRM_READ_ROLES), async (req, res, next) => {
  try {
    success(res, await service.list(req.query), "Danh sách lượt giới thiệu");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/partner-referrals/funnel:
 *   get:
 *     summary: Phễu chuyển đổi lượt giới thiệu theo đối tác
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: partnerId
 *         schema: { type: string, description: bỏ trống để xem tất cả đối tác }
 *     responses:
 *       200:
 *         description: "Mảng theo đối tác, mỗi phần tử có funnel[] NEW→CONTACTED→QUALIFIED→CONVERTED, dead, conversionRate"
 */
router.get("/funnel", authorize(...PRM_READ_ROLES), async (req, res, next) => {
  try {
    success(res, await service.funnel(req.query), "Phễu chuyển đổi lượt giới thiệu");
  } catch (e) {
    next(e);
  }
});

router.get("/:id", authorize(...PRM_READ_ROLES), async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id), "Chi tiết lượt giới thiệu");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/partner-referrals:
 *   post:
 *     summary: Nhập tay một lượt giới thiệu
 *     description: >
 *       Dùng khi đối tác báo khách qua điện thoại/Zalo chứ không qua webhook. Trả về
 *       referralCode để đối tác đối chiếu. Nếu số điện thoại đã được chính đối tác
 *       đó giới thiệu trước đó thì trả 409 chứ không tạo bản ghi trùng.
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [partnerId, referredName]
 *             properties:
 *               partnerId: { type: string }
 *               referredName: { type: string }
 *               referredPhone: { type: string }
 *               referredEmail: { type: string }
 *     responses:
 *       201: { description: "Lượt giới thiệu đã ghi nhận, kèm referralCode" }
 *       404: { description: Không tìm thấy đối tác }
 *       409: { description: "Số điện thoại đã được đối tác giới thiệu trước đó" }
 */
router.post("/", authorize(...PRM_MANAGE_ROLES), async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body);
    const result = await service.create(parsed, req.user?.id);
    created(res, result, `Đã ghi nhận lượt giới thiệu (mã ${result.referralCode})`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;