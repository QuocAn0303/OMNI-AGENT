// src/modules/accounting/vendor.service.js
const prisma = require("../../config/prisma");
const { withCodeRetry } = require("./journal.service");

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

const create = async (data) => {
  if (data.code) return prisma.vendor.create({ data });
  return withCodeRetry(generateCode, (code) =>
    prisma.vendor.create({ data: { ...data, code } }),
  );
};

const update = async (id, data) => {
  const exists = await prisma.vendor.findUnique({ where: { id } });
  if (!exists) throw { status: 404, message: "Không tìm thấy nhà cung cấp" };
  return prisma.vendor.update({ where: { id }, data });
};

const remove = async (id) => {
  return prisma.vendor.update({ where: { id }, data: { isActive: false } });
};

module.exports = { list, getById, create, update, remove };
