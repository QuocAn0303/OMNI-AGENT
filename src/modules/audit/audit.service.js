// src/modules/audit/audit.service.js
// Chức năng: ghi và truy vấn audit log (activity trail)
// Ghi chú (tiếng Việt) có trong hàm để người khác dễ hiểu
const prisma = require("../../config/prisma");

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
 */
const log = async ({
  userId = null,
  action,
  entity,
  entityId = null,
  before = null,
  after = null,
  meta = null,
}) => {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        beforeJson: before,
        afterJson: after,
        meta,
      },
    });
  } catch (err) {
    // Không throw để tránh làm hỏng luồng chính; chỉ log ra console
    console.error("Audit log error:", err);
  }
};

// Lấy danh sách audit log (phân trang, admin)
const getAll = async ({ page = 1, limit = 50, action, userId } = {}) => {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Math.min(200, Number(limit) || 50));
  const skip = (p - 1) * l;

  const where = {};
  if (action) where.action = action;
  if (userId) where.userId = userId;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: l,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
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
