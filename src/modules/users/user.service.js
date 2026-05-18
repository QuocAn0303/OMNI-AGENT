// src/modules/users/user.service.js
const bcrypt = require('bcrypt');
const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

const getAll = async ({ page: rawPage = 1, limit: rawLimit = 10, search = '' }) => {
  const page = Math.max(1, Number(rawPage) || 1);
  const limit = Math.max(1, Number(rawLimit) || 10);
  const skip = (page - 1) * limit;
  const where = search
    ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: Number(limit),
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / limit) } };
};

const getById = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
  });
  if (!user) throw { status: 404, message: 'Không tìm thấy người dùng' };
  return user;
};

const create = async ({ email, password, fullName, role }, actorId = null) => {
  const hashed = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10);
  const user = await prisma.user.create({
    data: { email, password: hashed, fullName, role },
    select: { id: true, email: true, fullName: true, role: true, createdAt: true },
  });

  auditService.log({
    userId: actorId,
    action: 'CREATE_USER',
    entity: 'User',
    entityId: user.id,
    after: { email, fullName, role },
  });

  return user;
};

const update = async (id, data, actorId = null) => {
  const { password, ...rest } = data;
  const updateData = { ...rest };
  if (password) {
    updateData.password = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 10);
  }
  const before = await prisma.user.findUnique({ where: { id }, select: { email: true, fullName: true, role: true, isActive: true } });
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
  const user = await prisma.user.findUnique({ where: { id }, select: { email: true, fullName: true } });
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
