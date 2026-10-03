/**
 * modules/audit/audit.service.js — Ghi và truy vấn audit log
 * 
 * Tổng quan:
 * - Ghi lại mọi hành động quan trọng (CRUD order, product, user, inventory...)
 * - Truy vấn audit log phân trang, lọc theo action/userId/tenant
 * - Tự động lọc tenant dựa trên role user
 * 
 * Hàm:
 * - log({userId, action, entity, entityId, before, after, meta}): Ghi một bản ghi audit, không throw lỗi
 * - getAll({page, limit, action, userId, user}): Lấy danh sách audit log, phân trang, lọc tenant theo role
 */
// src/modules/audit/audit.service.js
// Chức năng: ghi và truy vấn audit log (activity trail)
// Ghi chú (tiếng Việt) có trong hàm để người khác dễ hiểu
const prisma = require("../../config/prisma");
const logger = require('../../utils/logger');
const { getTenantId } = require('../../config/tenantContext');
const { maskPII } = require('../../utils/piiMask');

/**
 * Ghi một bản ghi audit
 * @param {Object} params
 * @param {string} params.userId - id người thực hiện (có thể null nếu hệ thống)
 * @param {string} params.action - hành động, ví dụ 'CREATE_ORDER'
 * @param {string} params.entity - tên entity, ví dụ 'Order'
 * @param {string} params.entityId - id của entity liên quan
 * @param {Object} params.before - trạng thái trước (sẽ lưu dưới dạng JSON)
 * @param {Object} params.after - trạng thái sau (sẽ lưu dưới dạng JSON)
 * @param {Object} params.meta - metadata bổ sung (ip, note...)
 * @param {string} [params.tenantId] - ghi đè tenant của dòng log.
 *
 *   CẦN khi luồng **không chạy trong tenant context** (`getTenantId()` = null)
 *   nhưng vẫn biết tenant: đăng ký tài khoản (`REGISTER`), xác minh email
 *   (`VERIFY_EMAIL`). Trước đây hai đường này ghi `tenantId = NULL` dù tenant
 *   đã có trong tay — 52 dòng trong `audit_logs` trên DB phát triển thuộc loại
 *   này (đo 2026-10-03, xem `scripts/lib/tenant-null-exceptions.js`).
 *   Truyền `null` tường minh = "cố ý không thuộc tenant nào" (ví dụ
 *   `CREATE_ADMIN_CAMPAIGN` trên bảng nền tảng `AdminCampaign`).
 */
const log = async ({
  userId = null,
  action,
  entity,
  entityId = null,
  before = null,
  after = null,
  meta = null,
  tenantId,
}) => {
  try {
    // Mask PII trước khi lưu (role null → luôn mask, không bao giờ lưu PII raw)
    await prisma.auditLog.create({
      data: {
        // `tenantId` truyền vào được ưu tiên; extension Prisma cũng không ghi đè
        // giá trị đã có (`if (!args.data.tenantId)`), nên hai đường không đụng nhau.
        tenantId: tenantId === undefined ? getTenantId() : tenantId,
        userId,
        action,
        entity,
        entityId,
        beforeJson: maskPII(before, null),
        afterJson: maskPII(after, null),
        meta,
      },
    });
  } catch (err) {
    logger.error("Audit log error:", err);
  }
};

// Lấy danh sách audit log (phân trang, admin)
const getAll = async ({ page = 1, limit = 50, action, userId, user: currentUser } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Math.min(200, Number(limit) || 50));
  const skip = (p - 1) * l;

  const where = {};
  if (action) where.action = action;
  if (userId) where.userId = userId;

  // Tenant filtering:
  // - SUPER_OMEGA_ULTRA_ADMIN: xem tất cả audit log (không filter)
  // - ADMIN / SUPER_ADMIN: chỉ xem audit log của tenant mình
  if (currentUser && currentUser.role !== "SUPER_OMEGA_ULTRA_ADMIN") {
    const userTenantId = currentUser.tenantId;
    if (userTenantId) {
      where.user = { tenantId: userTenantId };
    }
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: l,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, email: true, fullName: true, role: true, tenantId: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  // DTO phẳng cho FE: vẫn trả được khi user đã bị xóa (userId → null) hoặc meta mô tả thay thế
  const logs = rows.map((log) => {
    const meta = log.meta && typeof log.meta === "object" ? log.meta : {};
    const note = typeof meta.note === "string" ? meta.note : null;
    return {
      id: log.id,
      userId: log.userId,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      beforeJson: log.beforeJson,
      afterJson: log.afterJson,
      meta: log.meta,
      createdAt: log.createdAt,
      userName: log.user?.fullName ?? (log.userId ? "—" : "System"),
      userEmail: log.user?.email ?? null,
      userRole: log.user?.role ?? null,
      userTenantId: log.user?.tenantId ?? null,
      description: meta.description ?? note,
      ipAddress: meta.ipAddress ?? meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      changes: log.afterJson != null ? log.afterJson : log.beforeJson,
    };
  });

  return {
    logs,
    pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
  };
};

module.exports = { log, getAll };
