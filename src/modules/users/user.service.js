/**
 * modules/users/user.service.js — Business logic quản lý người dùng
 * 
 * Tổng quan:
 * - CRUD user với phân quyền tenant: ADMIN chỉ thấy user cùng tenant
 * - Password luôn hash bcrypt trước khi lưu
 * - Soft delete: isActive = false (không xóa vật lý)
 * - Audit log cho mọi thao tác (CREATE, UPDATE, DELETE)
 * 
 * Hàm:
 * - getAll({ page, limit, search, role }, actor): Danh sách user phân trang
 *     - Nếu actor có tenantId → filter theo tenant
 *     - SUPER_OMEGA_ULTRA_ADMIN thấy tất cả
 * - getById(id): Chi tiết user (select không password)
 * - create({ email, password, fullName, role }, actorId): Tạo user mới
 *     - Hash password → gán tenantId từ người tạo → audit log
 * - update(id, data, actorId): Cập nhật thông tin / role / password
 *     - Nếu có password → hash trước khi update
 *     - Audit log before/after
 * - remove(id, actorId): Soft delete (isActive = false) + audit log
 */

const bcrypt = require('bcrypt');
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

// ============ PHÂN QUYỀN TẠO/SỬA USER (chống leo quyền) ============
const TENANT_ROLES = ["ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER", "WAREHOUSE"];
const SUPER_ROLES = ["SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"];
const ROLE_RANK = {
  SUPER_OMEGA_ULTRA_ADMIN: 4,
  SUPER_ADMIN: 3,
  ADMIN: 2,
  MANAGER: 1,
  ACCOUNTANT: 1,
  CASHIER: 0,
  WAREHOUSE: 0,
};

const getActor = async (actorId) => {
  if (!actorId) throw { status: 401, message: 'Chưa xác thực tài khoản' };
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true, tenantId: true },
  });
  if (!actor) throw { status: 401, message: 'Chưa xác thực tài khoản' };
  return actor;
};

const getAll = async ({ page: rawPage = 1, limit: rawLimit = 10, search = '', role }, actor) => {
  const page = Math.max(1, Number(rawPage) || 1);
  const limit = Math.max(1, Number(rawLimit) || 10);
  const skip = (page - 1) * limit;

  const where = {};

  // SUPER_OMEGA_ULTRA_ADMIN thấy tất cả, còn ADMIN/SUPER_ADMIN chỉ thấy user cùng tenant
  if (actor?.tenantId) {
    where.tenantId = actor.tenantId;
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (role) {
    where.role = role;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: Number(limit),
      select: {
        id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true,
        tenantId: true,
        tenant: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / limit) } };
};

const getById = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true, tenantId: true },
  });
  if (!user) throw { status: 404, message: 'Không tìm thấy người dùng' };
  return user;
};

const create = async ({ email, password, fullName, role }, actorId = null) => {
  const hashed = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 12);

  // ---- Chống leo quyền: actor phải có quyền gán role này ----
  const actor = await getActor(actorId);
  const normalizedRole = role || 'CASHIER';
  let tenantId = null;

  if (SUPER_ROLES.includes(normalizedRole)) {
    // Chỉ SUPER_OMEGA_ULTRA_ADMIN mới tạo được tài khoản nền tảng (SUPER_ADMIN)
    if (actor.role !== 'SUPER_OMEGA_ULTRA_ADMIN') {
      throw { status: 403, message: 'Chỉ cấp điều hành tối cao được tạo tài khoản SUPER' };
    }
    tenantId = null; // user nền tảng, không thuộc tenant nào
  } else {
    // User thuộc tenant → actor phải có tenant context (ADMIN tenant, hoặc đang trong support session)
    if (!TENANT_ROLES.includes(normalizedRole)) {
      throw { status: 400, message: `Vai trò không hợp lệ: ${normalizedRole}` };
    }
    if (!actor.tenantId) {
      throw { status: 403, message: 'Không thể tạo tài khoản tenant khi thiếu tenant context' };
    }
    tenantId = actor.tenantId;
  }

  // L6: admin tạo tài khoản = admin chứng thực — không bắt user này verify email
  // (không có luồng gửi verify mail cho user tạo bởi admin)
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      fullName,
      role: normalizedRole,
      tenantId,
      emailVerified: true,
      registrationStatus: 'ACTIVE',
    },
    select: { id: true, email: true, fullName: true, role: true, createdAt: true, tenantId: true },
  });

  auditService.log({
    userId: actorId,
    action: 'CREATE_USER',
    entity: 'User',
    entityId: user.id,
    after: { email, fullName, role: normalizedRole, tenantId },
  });

  return user;
};

const update = async (id, data, actorId = null) => {
  const { password, ...rest } = data;
  const actor = await getActor(actorId);
  const before = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, fullName: true, role: true, isActive: true, tenantId: true } });
  if (!before) throw { status: 404, message: 'Không tìm thấy người dùng' };

  // ---- Chống leo quyền khi sửa ----
  if (actor.role !== 'SUPER_OMEGA_ULTRA_ADMIN') {
    // Không được đụng vào tài khoản SUPER
    if (SUPER_ROLES.includes(before.role) || (rest.role && SUPER_ROLES.includes(rest.role))) {
      throw { status: 403, message: 'Không được thay đổi tài khoản cấp SUPER' };
    }
    // SUPER_ADMIN (không có tenant) chỉ xem, không được ghi tài khoản tenant
    if (!actor.tenantId) {
      throw { status: 403, message: 'Không có quyền sửa tài khoản này' };
    }
    // Chỉ sửa được user cùng tenant
    if (before.tenantId !== actor.tenantId) {
      throw { status: 403, message: 'Tài khoản không thuộc tenant của bạn' };
    }
    // Không được gán role cao hơn role của mình
    if (rest.role && ROLE_RANK[rest.role] > ROLE_RANK[actor.role]) {
      throw { status: 403, message: 'Không thể gán vai trò cao hơn vai trò của bạn' };
    }
    // Không tự sửa role / tự khóa chính mình
    if (before.id === actor.id && (rest.role || rest.isActive === false)) {
      throw { status: 403, message: 'Không thể tự thay đổi vai trò hoặc khóa tài khoản của mình' };
    }
  }

  const updateData = { ...rest };
  if (password) {
    updateData.password = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 12);
    updateData.mustChangePassword = false;
  }
  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });

  auditService.log({
    userId: actorId,
    action: 'UPDATE_USER',
    entity: 'User',
    entityId: id,
    before,
    after: { email: updated.email, fullName: updated.fullName, role: updated.role, isActive: updated.isActive },
  });

  return updated;
};

const remove = async (id, actorId = null) => {
  const actor = await getActor(actorId);
  const user = await prisma.user.findUnique({ where: { id }, select: { email: true, fullName: true, role: true, tenantId: true } });
  if (!user) throw { status: 404, message: 'Không tìm thấy người dùng' };

  // ---- Chống leo quyền khi khóa ----
  if (actor.role !== 'SUPER_OMEGA_ULTRA_ADMIN') {
    if (SUPER_ROLES.includes(user.role)) {
      throw { status: 403, message: 'Không được khóa tài khoản cấp SUPER' };
    }
    if (!actor.tenantId || user.tenantId !== actor.tenantId) {
      throw { status: 403, message: 'Tài khoản không thuộc tenant của bạn' };
    }
    if (user.id === actor.id) {
      throw { status: 403, message: 'Không thể tự khóa tài khoản của mình' };
    }
  }

  const result = await prisma.user.update({ where: { id }, data: { isActive: false } });

  auditService.log({
    userId: actorId,
    action: 'DELETE_USER',
    entity: 'User',
    entityId: id,
    before: user,
  });

  return result;
};

module.exports = { getAll, getById, create, update, remove };
