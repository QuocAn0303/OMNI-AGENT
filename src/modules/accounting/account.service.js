// src/modules/accounting/account.service.js
const prisma = require("../../config/prisma");
const journalService = require("./journal.service");

const list = async ({ type, search } = {}) => {
  const where = { isActive: true };
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { nameVi: { contains: search, mode: "insensitive" } },
    ];
  }
  return prisma.account.findMany({
    where,
    orderBy: { code: "asc" },
    include: { _count: { select: { lines: true } } },
  });
};

const tree = async () => {
  const all = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });
  const byId = new Map(all.map((a) => [a.id, { ...a, children: [] }]));
  const roots = [];
  for (const a of byId.values()) {
    if (a.parentId && byId.has(a.parentId)) {
      byId.get(a.parentId).children.push(a);
    } else {
      roots.push(a);
    }
  }
  return roots;
};

const getById = async (id) => {
  const acc = await prisma.account.findUnique({
    where: { id },
    include: { parent: true, children: true },
  });
  if (!acc) throw { status: 404, message: "Không tìm thấy tài khoản" };
  return acc;
};

const getBalance = (id, opts) => journalService.getAccountBalance(id, opts);

module.exports = { list, tree, getById, getBalance };
