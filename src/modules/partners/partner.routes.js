'use strict';

/**
 * modules/partners/partner.routes.js — Giao diện quản trị đối tác (PRM)
 *
 * Routes:
 *   GET    /api/partners                      danh sách đối tác (lọc + phân trang)
 *   GET    /api/partners/stats                thống kê theo loại
 *   GET    /api/partners/:id                  chi tiết một đối tác
 *   POST   /api/partners                      tạo đối tác
 *   PUT    /api/partners/:id                  sửa đối tác
 *   DELETE /api/partners/:id                  NGỪNG HOẠT ĐỘNG (xoá mềm, giữ lịch sử)
 *   PATCH  /api/partners/:id/restore          khoá lại đối tác
 *
 * Về `requireModule("crm")`: PRM là phần mở rộng của phân hệ khách hàng, dùng
 * CHUNG khóa gói với `crm` thay vì tạo khóa mới. Lý do là khóa gói mới sẽ khoá
 * module với các tenant cũ đã mua gói `crm` mà không có `partners` trong danh sách
 * — và phải backfill cho toàn bộ tenant cũ. Xem `docs/PLAN_PRM_partner_module.md` §5.2.
 */
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../../config/prisma");
const service = require("./partner.service");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const { requireModule } = require("../../middleware/plan.middleware");
const { success, created, error } = require("../../utils/response");
const { PRM_READ_ROLES, PRM_MANAGE_ROLES, PRM_ADMIN_ROLES } = require("./roles");

router.use(authenticate, requireModule("crm"));

const PARTNER_TYPES = ["AFFILIATE", "MARKETING_CHANNEL", "REFERRER", "SALES_AGENT"];
const COMMISSION_TYPES = ["PERCENT_OF_CLV", "FIXED_PER_CUSTOMER"];

// `commissionPercent` ở đầu vào là PHẦN TRĂM (10 = 10%). Service chia 100 khi lưu.
// Chặn vượt 100 vì tỷ lệ trên 100% là nhập nhầm, và sẽ ra lợi nhuận ròng âm.
const percentSchema = z
  .number()
  .min(0, "Tỷ lệ hoa hồng không được âm")
  .max(100, "Tỷ lệ hoa hồng không vượt quá 100%")
  .optional();

const createSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1, "Tên đối tác không được để trống").max(150),
  type: z.enum(PARTNER_TYPES).optional(),
  commissionType: z.enum(COMMISSION_TYPES).optional(),
  commissionPercent: percentSchema,
  fixedCommission: z.number().min(0).optional(),
  contactName: z.string().max(150).optional(),
  phone: z.string().min(8).max(15).optional(),
  email: z.string().email().optional().nullable(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = createSchema.partial();

/**
 * @swagger
 * /api/partners:
 *   get:
 *     summary: Danh sách đối tác marketing / phân phối
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [AFFILIATE, MARKETING_CHANNEL, REFERRER, SALES_AGENT] }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ partners[], pagination } — commissionPercent là phần trăm" }
 */
router.get("/", authorize(...PRM_READ_ROLES), async (req, res, next) => {
  try {
    success(res, await service.list(req.query), "Danh sách đối tác");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/partners/stats:
 *   get:
 *     summary: Thống kê số đối tác theo loại
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ byType: { AFFILIATE: n, ... }, active: n, total: n }" }
 */
router.get("/stats", authorize(...PRM_READ_ROLES), async (req, res, next) => {
  try {
    const [byType, active, total] = await Promise.all([
      service.countByType(),
      service.countActive(),
      prisma.partner.count(),
    ]);
    success(res, { byType, active, total }, "Thống kê đối tác");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/partners/{id}:
 *   get:
 *     summary: Chi tiết một đối tác
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Thông tin đối tác kèm số lượt giới thiệu" }
 *       404: { description: Không tìm thấy đối tác }
 */
router.get("/:id", authorize(...PRM_READ_ROLES), async (req, res, next) => {
  try {
    success(res, await service.getById(req.params.id), "Chi tiết đối tác");
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/partners:
 *   post:
 *     summary: Tạo đối tác mới
 *     tags: [PRM]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Đối tác giới thiệu A" }
 *               type: { type: string, enum: [AFFILIATE, MARKETING_CHANNEL, REFERRER, SALES_AGENT] }
 *               commissionType: { type: string, enum: [PERCENT_OF_CLV, FIXED_PER_CUSTOMER] }
 *               commissionPercent: { type: number, description: "PHẦN TRĂM, ví dụ 10 là 10%", example: 10 }
 *               fixedCommission: { type: number, example: 50000 }
 *     responses:
 *       201: { description: "Đối tác đã tạo (mã ĐT-YYYYMM-XXXX nếu không truyền code)" }
 *       400: { description: Dữ liệu sai schema }
 */
router.post("/", authorize(...PRM_MANAGE_ROLES), async (req, res, next) => {
  try {
    created(res, await service.create(createSchema.parse(req.body)), "Đã tạo đối tác");
  } catch (e) {
    next(e);
  }
});

router.put("/:id", authorize(...PRM_MANAGE_ROLES), async (req, res, next) => {
  try {
    success(res, await service.update(req.params.id, updateSchema.parse(req.body)), "Đã cập nhật đối tác");
  } catch (e) {
    next(e);
  }
});

/**
 * Xoá mềm: đặt isActive = false, KHÔNG xoá dòng.
 *
 * Lý do: `partner_referrals.partnerId` là khoá ngoại CASCADE, xoá hẳn đối tác sẽ
 * mất toàn bộ lịch sử giới thiệu — tức mất chứng cứ để tính hoa hồng và kiểm toán.
 */
router.delete("/:id", authorize(...PRM_ADMIN_ROLES), async (req, res, next) => {
  try {
    success(res, await service.deactivate(req.params.id), "Đã ngừng hoạt động đối tác (giữ lịch sử)");
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/restore", authorize(...PRM_ADMIN_ROLES), async (req, res, next) => {
  try {
    success(res, await service.restore(req.params.id), "Đã khoá lại đối tác");
  } catch (e) {
    next(e);
  }
});

module.exports = router;