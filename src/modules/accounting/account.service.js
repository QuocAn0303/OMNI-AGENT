/**
 * modules/accounting/account.service.js — Service quản lý Hệ thống tài khoản kế toán
 *
 * Tổng quan:
 * - Cung cấp các thao tác CRUD cho danh mục tài khoản kế toán (Account)
 * - Hỗ trợ xem dạng cây (tree) phân cấp cha-con
 * - Lọc danh sách theo type, search (code, name, nameVi)
 * - Lấy số dư tài khoản thông qua journalService
 *
 * Hàm:
 * - list({ type, search }): Liệt kê tài khoản active, hỗ trợ lọc type và tìm kiếm code/name/nameVi
 * - tree(): Trả về cây tài khoản phân cấp dựa trên parentId
 * - getById(id): Lấy chi tiết tài khoản kèm parent và children
 * - getBalance(id, opts): Proxy sang journalService.getAccountBalance để lấy số dư
 */
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
