// src/modules/production/work-center.service.js
const prisma = require("../../config/prisma");

const list = () =>
  prisma.workCenter.findMany({ orderBy: { code: "asc" }, include: { account: { select: { code: true, name: true } } } });

const create = async ({ code, name, description, capacity = 8, accountId }) => {
  if (!code || !name) throw { status: 400, message: "Cần code và name" };
  return prisma.workCenter.create({ data: { code, name, description, capacity: Number(capacity), accountId: accountId || null } });
};

const update = async (id, data) => {
  await prisma.workCenter.findUniqueOrThrow({ where: { id } });
  return prisma.workCenter.update({ where: { id }, data });
};

const remove = async (id) => {
  const ops = await prisma.routingOperation.count({ where: { workCenterId: id } });
  if (ops > 0) throw { status: 400, message: "Work center đang được dùng trong routing" };
  return prisma.workCenter.delete({ where: { id } });
};

module.exports = { list, create, update, remove };
