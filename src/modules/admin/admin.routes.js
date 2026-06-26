/**
 * modules/admin/admin.routes.js — Routes quản trị hệ thống (SUPER_OMEGA_ULTRA_ADMIN)
 * 
 * Tổng quan:
 * - REST API cho admin module, yêu cầu authenticate + requireSuperOmega
 * - Support session: tạo/ thu hồi phiên hỗ trợ tenant
 * - Quản lý tenant: danh sách, chi tiết, cập nhật trạng thái
 * - Quản lý yêu cầu nâng cấp gói
 * - Quản lý chiến dịch email/SMS
 * - Thống kê tenant
 * 
 * Routes:
 * - POST /support-session: Tạo phiên hỗ trợ (SUPER_OMEGA_ULTRA_ADMIN)
 * - POST /support-session/:id/revoke: Thu hồi phiên hỗ trợ
 * - GET /tenants: Danh sách tenant (phân trang)
 * - GET /tenants/:id: Chi tiết tenant
 * - PUT /tenants/:id: Cập nhật tenant (isActive)
 * - GET /stats: Thống kê tenant
 * - GET /upgrade-requests: Yêu cầu nâng gói
 * - POST /upgrade-requests/:id/approve: Duyệt nâng gói
 * - POST /upgrade-requests/:id/reject: Từ chối nâng gói
 * - GET /campaigns: Danh sách chiến dịch
 * - GET /campaigns/:id: Chi tiết chiến dịch
 * - GET /campaigns/:id/recipients: Danh sách người nhận
 * - POST /campaigns: Tạo chiến dịch
 * - PUT /campaigns/:id: Cập nhật chiến dịch
 * - DELETE /campaigns/:id: Xoá chiến dịch
 * - POST /campaigns/:id/send: Gửi chiến dịch
 */
const router = require("express").Router();
const prisma = require("../../config/prisma");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const {
  authenticate,
  requireSuperOmega,
} = require("../../middleware/auth.middleware");
const { success, paginated } = require("../../utils/response");
const campaignController = require("./admin-campaign.controller");

// API bắt buộc phải qua 2 lớp check: Đã đăng nhập + Phải có role tối cao
router.post(
  "/support-session",
  authenticate,
  requireSuperOmega,
  async (req, res, next) => {
    try {
      const { tenantId, reason, durationHours = 2 } = req.body;

      if (!tenantId || !reason) {
        return next({
          status: 400,
          message: "Thiếu thông tin tenantId hoặc lý do hỗ trợ",
        });
      }

      // 1. Kiểm tra xem tenant cần hỗ trợ có tồn tại không
      const targetTenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      if (!targetTenant) {
        return next({
          status: 404,
          message: "Không tìm thấy doanh nghiệp cần hỗ trợ",
        });
      }

      // Tính thời gian hết hạn
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + durationHours);

      // 2. Tạo phiên hỗ trợ trong Database theo schema tối ưu
      const session = await prisma.supportAccessSession.create({
        data: {
          adminId: req.user.id,
          tenantId,
          reason,
          expiresAt,
          status: "ACTIVE",
        },
      });

      // 3. Sinh JWT Token đặc biệt (Giả lập quyền ADMIN của chính shop đó)
      // Token này giữ nguyên ID của bạn để ghi log, nhưng hoán đổi role và tenantId để hệ thống nhận diện
      const supportToken = jwt.sign(
        {
          id: req.user.id,
          email: req.user.email,
          fullName: req.user.fullName,
          role: "ADMIN", // Đóng vai trò ADMIN của shop để xử lý cấu hình
          tenantId: tenantId, // Gắn ID của shop cần hỗ trợ vào context
          supportSessionId: session.id, // Giữ ID phiên để đối chiếu khi cần
        },
        process.env.JWT_SECRET,
        { algorithm: "HS256", expiresIn: `${durationHours}h` },
      );

      success(res, {
        message:
          "Khởi tạo phiên hỗ trợ thành công. Mã truy cập có hiệu lực trong " +
          durationHours +
          " giờ.",
        supportToken,
        session,
      });
    } catch (err) {
      next(err);
    }
  },
);

// API thu hồi phiên hỗ trợ thủ công (Revoke)
router.post(
  "/support-session/:id/revoke",
  authenticate,
  requireSuperOmega,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const session = await prisma.supportAccessSession.findUnique({
        where: { id },
      });
      if (!session)
        return next({ status: 404, message: "Không tìm thấy phiên hỗ trợ" });
      if (session.status !== "ACTIVE")
        return next({
          status: 400,
          message: "Phiên này đã kết thúc hoặc đã bị thu hồi trước đó",
        });

      const updatedSession = await prisma.supportAccessSession.update({
        where: { id },
        data: {
          status: "REVOKED",
          revokedById: req.user.id, // Lưu vết người thực hiện thu hồi phiên
        },
      });

      success(res, {
        message: "Đã thu hồi quyền truy cập phiên hỗ trợ thành công",
        session: updatedSession,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==================== Tenant management ====================
router.get("/tenants", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.tenant.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { users: true } },
          subscriptions: {
            where: { status: { in: ["ACTIVE", "TRIAL"] } },
            include: { plan: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      prisma.tenant.count(),
    ]);

    const enriched = data.map((t) => ({
      ...t,
      subscription: t.subscriptions?.[0] || null,
      planId: t.subscriptions?.[0]?.planId || null,
      planName: t.subscriptions?.[0]?.plan?.name || "No plan",
    }));

    paginated(res, enriched, { page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

router.put("/tenants/:id", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const tenant = await prisma.tenant.update({
      where: { id: req.params.id },
      data: { isActive },
    });
    success(res, tenant, "Cập nhật tenant thành công");
  } catch (err) { next(err); }
});

router.get("/stats", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const [total, activeTenants, free, pro, enterprise] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.tenantSubscription.count({ where: { plan: { key: "free" }, status: { in: ["ACTIVE", "TRIAL"] } } }),
      prisma.tenantSubscription.count({ where: { plan: { key: "pro" }, status: { in: ["ACTIVE", "TRIAL"] } } }),
      prisma.tenantSubscription.count({ where: { plan: { key: "enterprise" }, status: { in: ["ACTIVE", "TRIAL"] } } }),
    ]);

    success(res, { total, active: activeTenants, free, pro, enterprise });
  } catch (err) { next(err); }
});

// ==================== Upgrade Requests ====================
router.get("/upgrade-requests", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { invoiceCode: { startsWith: "UPG-" } },
      include: { tenant: true },
      orderBy: { createdAt: "desc" },
    });
    success(res, invoices);
  } catch (err) { next(err); }
});

router.post("/upgrade-requests/:id/approve", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return next({ status: 404, message: "Không tìm thấy yêu cầu" });

    const plan = await prisma.subscriptionPlan.findFirst({ where: { price: invoice.amount } });
    if (!plan) return next({ status: 400, message: "Không tìm thấy gói tương ứng" });

    await prisma.tenantSubscription.updateMany({
      where: { tenantId: invoice.tenantId, status: { in: ["ACTIVE", "TRIAL"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    const sub = await prisma.tenantSubscription.create({
      data: { tenantId: invoice.tenantId, planId: plan.id, status: "ACTIVE", startDate: new Date(), endDate, createdById: req.user.id },
    });

    await prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt: new Date(), paidById: req.user.id, subscriptionId: sub.id },
    });

    success(res, { invoice, subscription: sub }, "Yêu cầu nâng gói đã được duyệt");
  } catch (err) { next(err); }
});

router.post("/upgrade-requests/:id/reject", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const invoice = await prisma.subscriptionInvoice.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED" },
    });
    success(res, invoice, "Yêu cầu nâng gói đã bị từ chối");
  } catch (err) { next(err); }
});

// ==================== Admin Campaigns ====================
const adminCampaignCreateSchema = z.object({
  name: z.string().min(1).max(150),
  channel: z.enum(["EMAIL", "SMS"]),
  targetPlans: z.array(z.string()).min(1),
  subject: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
});

router.get("/campaigns", authenticate, requireSuperOmega, campaignController.list);
router.get("/campaigns/:id", authenticate, requireSuperOmega, campaignController.getById);
router.get("/campaigns/:id/recipients", authenticate, requireSuperOmega, campaignController.listRecipients);
router.post("/campaigns", authenticate, requireSuperOmega, (req, res, next) => {
  try {
    req.body = adminCampaignCreateSchema.parse(req.body);
    next();
  } catch (err) { next(err); }
}, campaignController.create);
router.put("/campaigns/:id", authenticate, requireSuperOmega, campaignController.update);
router.delete("/campaigns/:id", authenticate, requireSuperOmega, campaignController.remove);
router.post("/campaigns/:id/send", authenticate, requireSuperOmega, campaignController.send);

// ==================== Tenant Detail ====================
router.get("/tenants/:id", authenticate, requireSuperOmega, async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { users: true } },
        users: { select: { id: true, email: true, fullName: true, role: true, isActive: true } },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: "desc" } },
        invoices: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!tenant) return next({ status: 404, message: "Không tìm thấy tenant" });
    success(res, tenant);
  } catch (err) { next(err); }
});

module.exports = router;
