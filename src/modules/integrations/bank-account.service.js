const prisma = require("../../config/prisma");

const list = async () => {
  return prisma.bankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { bankName: "asc" }],
  });
};

const create = async (data) => {
  const existing = await prisma.bankAccount.findUnique({ where: { accountNumber: data.accountNumber } });
  if (existing) throw { status: 400, message: "Số tài khoản đã tồn tại" };

  return prisma.bankAccount.create({
    data: {
      accountNumber: data.accountNumber,
      bankName: data.bankName,
      accountName: data.accountName,
      accountId: data.accountId,
      openingBalance: data.openingBalance || 0,
      currentBalance: data.openingBalance || 0,
      isDefault: data.isDefault || false,
      note: data.note,
    },
  });
};

const update = async (id, data) => {
  const account = await prisma.bankAccount.findUnique({ where: { id } });
  if (!account) throw { status: 404, message: "Không tìm thấy tài khoản ngân hàng" };

  if (data.accountNumber && data.accountNumber !== account.accountNumber) {
    const dup = await prisma.bankAccount.findUnique({ where: { accountNumber: data.accountNumber } });
    if (dup) throw { status: 400, message: "Số tài khoản đã tồn tại" };
  }

  return prisma.bankAccount.update({
    where: { id },
    data: {
      ...(data.accountNumber && { accountNumber: data.accountNumber }),
      ...(data.bankName && { bankName: data.bankName }),
      ...(data.accountName && { accountName: data.accountName }),
      ...(data.accountId && { accountId: data.accountId }),
      ...(data.openingBalance !== undefined && { openingBalance: data.openingBalance }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      ...(data.note !== undefined && { note: data.note }),
    },
  });
};

const remove = async (id) => {
  const account = await prisma.bankAccount.findUnique({ where: { id } });
  if (!account) throw { status: 404, message: "Không tìm thấy tài khoản ngân hàng" };
  return prisma.bankAccount.update({ where: { id }, data: { isActive: false } });
};

module.exports = { list, create, update, remove };
