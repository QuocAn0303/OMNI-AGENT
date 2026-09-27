/**
 * modules/accounting/vendor.service.js — Service quản lý nhà cung cấp
 * 
 * Tổng quan:
 * - CRUD nhà cung cấp (Vendor) với soft delete (isActive).
 * - Tự động sinh mã NCC nếu không được cung cấp.
 * - Hỗ trợ tìm kiếm theo tên, mã, số điện thoại, mã số thuế.
 * 
 * Hàm:
 * - generateCode(): Sinh mã vendor dạng NCC-XXXX.
 * - list({page, limit, search}): Danh sách vendor có phân trang và tìm kiếm (isActive=true).
 * - getById(id): Chi tiết vendor kèm 10 expense và 10 purchase order gần nhất.
 * - create(data): Tạo vendor; dùng withCodeRetry nếu không có code.
 * - update(id, data): Cập nhật thông tin vendor.
 * - remove(id): Vô hiệu hóa vendor (soft delete).
 */
// src/modules/accounting/vendor.service.js
const prisma = require("../../config/prisma");
const { withCodeRetry } = require("./journal.service");
const auditService = require("../audit/audit.service");

const generateCode = async () => {
  const count = await prisma.vendor.count();
  return `NCC-${String(count + 1).padStart(4, "0")}`;
};

const list = async ({ page = 1, limit = 20, search = "" } = {}) => {
  const skip = (Number(page) - 1) * Number(limit);
  const where = { isActive: true };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { taxCode: { contains: search } },
    ];
  }
  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: "desc" } }),
    prisma.vendor.count({ where }),
  ]);
  return {
    vendors,
    pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
  };
};

const getById = async (id) => {
  const v = await prisma.vendor.findUnique({
    where: { id },
    include: {
      expenses: { take: 10, orderBy: { createdAt: "desc" } },
      purchaseOrders: { take: 10, orderBy: { createdAt: "desc" } },
    },
  });
  if (!v) throw { status: 404, message: "Không tìm thấy nhà cung cấp" };
  return v;
};

const create = async (data, userId = null) => {
  const vendor = data.code
    ? await prisma.vendor.create({ data })
    : await withCodeRetry(generateCode, (code) =>
        prisma.vendor.create({ data: { ...data, code } }),
      );
  auditService.log({ userId, action: "CREATE_VENDOR", entity: "Vendor", entityId: vendor.id, after: { name: vendor.name, code: vendor.code } });
  return vendor;
};

const update = async (id, data, userId = null) => {
  const exists = await prisma.vendor.findUnique({ where: { id } });
  if (!exists) throw { status: 404, message: "Không tìm thấy nhà cung cấp" };
  const updated = await prisma.vendor.update({ where: { id }, data });
  auditService.log({ userId, action: "UPDATE_VENDOR", entity: "Vendor", entityId: id, before: { name: exists.name, code: exists.code }, after: { name: updated.name, code: updated.code } });
  return updated;
};

const remove = async (id, userId = null) => {
  const exists = await prisma.vendor.findUnique({ where: { id } });
  if (!exists) throw { status: 404, message: "Không tìm thấy nhà cung cấp" };
  const result = await prisma.vendor.update({ where: { id }, data: { isActive: false } });
  auditService.log({ userId, action: "DELETE_VENDOR", entity: "Vendor", entityId: id, before: { name: exists.name, code: exists.code } });
  return result;
};

// ==================== SRM: KRALJIC MATRIX (Mục 5) ====================

// Ngưỡng "Cao" = >= 6 trên thang 1-10 (đặc tả Mục 5.2)
const KRALJIC_HIGH_THRESHOLD = 6;

// Suy loại Kraljic từ 2 điểm định tính: Cao/Cao=STRATEGIC, Cao/Thấp=LEVERAGE, Thấp/Cao=BOTTLENECK, Thấp/Thấp=ROUTINE
const deriveKraljic = (profitImpactScore, supplyRiskScore) => {
  const hi = (v) => v >= KRALJIC_HIGH_THRESHOLD;
  if (hi(profitImpactScore) && hi(supplyRiskScore)) return "STRATEGIC";
  if (hi(profitImpactScore)) return "LEVERAGE";
  if (hi(supplyRiskScore)) return "BOTTLENECK";
  return "ROUTINE";
};

/**
 * Cập nhật điểm đánh giá Kraljic — kraljicCategory được server tự suy ra
 * (đánh giá định kỳ do người mua hàng nhập tay, không tự động hoá — Mục 5.2)
 */
const updateKraljic = async (id, { profitImpactScore, supplyRiskScore }, userId = null) => {
  const p = Number(profitImpactScore);
  const s = Number(supplyRiskScore);
  if (!Number.isInteger(p) || p < 1 || p > 10 || !Number.isInteger(s) || s < 1 || s > 10) {
    throw { status: 400, message: "profitImpactScore/supplyRiskScore phải là số nguyên trong khoảng 1-10" };
  }
  const exists = await prisma.vendor.findUnique({ where: { id } });
  if (!exists) throw { status: 404, message: "Không tìm thấy nhà cung cấp" };
  const updated = await prisma.vendor.update({
    where: { id },
    data: {
      profitImpactScore: p,
      supplyRiskScore: s,
      kraljicCategory: deriveKraljic(p, s),
    },
  });
  auditService.log({
    userId,
    action: "UPDATE_VENDOR_KRALJIC",
    entity: "Vendor",
    entityId: id,
    before: { kraljicCategory: exists.kraljicCategory, profitImpactScore: exists.profitImpactScore, supplyRiskScore: exists.supplyRiskScore },
    after: { kraljicCategory: updated.kraljicCategory, profitImpactScore: p, supplyRiskScore: s },
  });
  return updated;
};

module.exports = { list, getById, create, update, remove, updateKraljic, deriveKraljic };
