/**
 * modules/accounting/fiscal-period.service.js — Quản lý kỳ kế toán
 * 
 * Tổng quan:
 * - Quản lý vòng đời kỳ kế toán (tháng): OPEN → CLOSED → LOCKED.
 * - Đảm bảo tính toàn vẹn báo cáo: chỉ ADMIN được phép mở lại kỳ đã đóng,
 *   khóa vĩnh viễn không thể mở lại.
 * - Ghi audit log cho mọi thao tác.
 * 
 * Hàm:
 * - list(): Danh sách tất cả kỳ kế toán, sắp xếp mới nhất trước.
 * - ensurePeriod(year, month): Tự động tạo kỳ nếu chưa tồn tại — dùng khi cần tham chiếu.
 * - close({year, month}, userId): Đóng kỳ (CLOSED). Chỉ kỳ OPEN mới được đóng.
 * - reopen({year, month}, userId, userRole): Mở lại kỳ đã đóng. Yêu cầu ADMIN/SUPER_ADMIN.
 * - lock({year, month}, userId, userRole): Khóa vĩnh viễn kỳ. Chỉ ADMIN/SUPER_ADMIN.
 */
// src/modules/accounting/fiscal-period.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const list = () =>
  prisma.fiscalPeriod.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { closedBy: { select: { id: true, fullName: true } } },
  });

const ensurePeriod = async (year, month) => {
  const existing = await prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) return existing;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return prisma.fiscalPeriod.create({
    data: { year, month, startDate: start, endDate: end, status: "OPEN" },
  });
};

const close = async ({ year, month }, userId) => {
  const period = await ensurePeriod(year, month);
  if (period.status !== "OPEN") throw { status: 400, message: "Kỳ này đã đóng/khóa" };
  const updated = await prisma.fiscalPeriod.update({
    where: { id: period.id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: userId },
  });
  auditService.log({
    userId,
    action: "CLOSE_FISCAL_PERIOD",
    entity: "FiscalPeriod",
    entityId: period.id,
    before: { status: period.status },
    after: { status: "CLOSED", year, month },
  });
  return updated;
};

const reopen = async ({ year, month }, userId, userRole) => {
  // Mở lại kỳ là hành động nhạy cảm — có thể làm hỏng tính toàn vẹn báo cáo
  // đã chốt với kiểm toán/cổ đông. Chỉ ADMIN được phép.
  if (userRole && !["SUPER_ADMIN", "ADMIN"].includes(userRole)) {
    throw { status: 403, message: "Chỉ ADMIN/SUPER_ADMIN mới có quyền mở lại kỳ đã đóng" };
  }
  const period = await prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month } } });
  if (!period) throw { status: 404, message: "Không tìm thấy kỳ" };
  if (period.status === "OPEN") throw { status: 400, message: "Kỳ này đang mở" };
  if (period.status === "LOCKED") throw { status: 400, message: "Kỳ đã bị khóa vĩnh viễn" };
  const updated = await prisma.fiscalPeriod.update({
    where: { id: period.id },
    data: { status: "OPEN", closedAt: null, closedById: null },
  });
  auditService.log({
    userId,
    action: "REOPEN_FISCAL_PERIOD",
    entity: "FiscalPeriod",
    entityId: period.id,
    before: { status: period.status },
    after: { status: "OPEN", year, month },
  });
  return updated;
};

const lock = async ({ year, month }, userId, userRole) => {
  // Khóa vĩnh viễn — không ai mở lại được. Cần ADMIN cấp cao nhất.
  if (userRole && !["SUPER_ADMIN", "ADMIN"].includes(userRole)) {
    throw { status: 403, message: "Chỉ ADMIN/SUPER_ADMIN mới có quyền khóa vĩnh viễn kỳ" };
  }
  const period = await prisma.fiscalPeriod.findUnique({ where: { year_month: { year, month } } });
  if (!period) throw { status: 404, message: "Không tìm thấy kỳ" };
  if (period.status === "LOCKED") throw { status: 400, message: "Kỳ đã bị khóa rồi" };
  const updated = await prisma.fiscalPeriod.update({
    where: { id: period.id },
    data: { status: "LOCKED" },
  });
  auditService.log({
    userId,
    action: "LOCK_FISCAL_PERIOD",
    entity: "FiscalPeriod",
    entityId: period.id,
    before: { status: period.status },
    after: { status: "LOCKED", year, month },
  });
  return updated;
};

module.exports = { list, ensurePeriod, close, reopen, lock };
