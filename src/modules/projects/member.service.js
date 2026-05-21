// src/modules/projects/member.service.js
const prisma = require("../../config/prisma");
const auditService = require("../audit/audit.service");

const MEMBER_SELECT = {
  id: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, fullName: true, email: true, role: true } },
};

const ensureProject = async (projectId) => {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!p) {
    const err = new Error("Dự án không tồn tại");
    err.status = 404;
    throw err;
  }
};

const list = async (projectId) => {
  await ensureProject(projectId);
  return prisma.projectMember.findMany({
    where: { projectId },
    select: MEMBER_SELECT,
    orderBy: { createdAt: "asc" },
  });
};

const add = async (projectId, { userId, role }, actorId) => {
  await ensureProject(projectId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true, fullName: true },
  });
  if (!user || !user.isActive) {
    const err = new Error("Người dùng không hợp lệ");
    err.status = 400;
    throw err;
  }

  const existed = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  });
  if (existed) {
    const err = new Error("Thành viên đã có trong dự án");
    err.status = 409;
    throw err;
  }

  const member = await prisma.projectMember.create({
    data: { projectId, userId, role: role || "MEMBER" },
    select: MEMBER_SELECT,
  });

  auditService.log({
    userId: actorId,
    action: "ADD_PROJECT_MEMBER",
    entity: "ProjectMember",
    entityId: member.id,
    after: { projectId, userId, role: member.role },
  });

  return member;
};

const updateRole = async (projectId, userId, role, actorId) => {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, role: true },
  });
  if (!member) {
    const err = new Error("Thành viên không tồn tại");
    err.status = 404;
    throw err;
  }

  const updated = await prisma.projectMember.update({
    where: { id: member.id },
    data: { role },
    select: MEMBER_SELECT,
  });

  auditService.log({
    userId: actorId,
    action: "UPDATE_PROJECT_MEMBER",
    entity: "ProjectMember",
    entityId: member.id,
    before: { role: member.role },
    after: { role: updated.role },
  });

  return updated;
};

const remove = async (projectId, userId, actorId) => {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, role: true },
  });
  if (!member) {
    const err = new Error("Thành viên không tồn tại");
    err.status = 404;
    throw err;
  }

  if (member.role === "OWNER") {
    const ownerCount = await prisma.projectMember.count({
      where: { projectId, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      const err = new Error("Không thể xóa OWNER cuối cùng của dự án");
      err.status = 400;
      throw err;
    }
  }

  await prisma.projectMember.delete({ where: { id: member.id } });

  auditService.log({
    userId: actorId,
    action: "REMOVE_PROJECT_MEMBER",
    entity: "ProjectMember",
    entityId: member.id,
    before: { projectId, userId, role: member.role },
  });

  return { id: member.id };
};

const assignableUsers = async () => {
  return prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: { fullName: "asc" },
  });
};

module.exports = { list, add, updateRole, remove, assignableUsers };
