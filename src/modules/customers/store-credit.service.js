const prisma = require('../../config/prisma');
const auditService = require('../audit/audit.service');

const listByCustomer = async (customerId, { page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.storeCreditTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.storeCreditTransaction.count({ where: { customerId } }),
  ]);
  return {
    transactions: rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

const getBalance = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { storeCredit: true },
  });
  if (!customer) {
    const err = new Error('Khách hàng không tồn tại');
    err.status = 404;
    throw err;
  }
  return customer.storeCredit;
};

const create = async ({ customerId, amount, type, note, referenceId }, userId) => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    const err = new Error('Khách hàng không tồn tại');
    err.status = 404;
    throw err;
  }

  const result = await prisma.$transaction(async (tx) => {
    let increment;
    if (type === 'EARN' || type === 'REFUND') {
      increment = amount;
    } else if (type === 'SPEND' || type === 'ADJUST') {
      increment = -amount;
    } else {
      increment = 0;
    }

    if (increment < 0) {
      // updateMany có điều kiện → chống race: hai giao dịch SPEND chạy đồng thời
      // chỉ một cái được trừ, cái còn lại bị chặn bởi điều kiện storeCredit >= amount.
      const { count } = await tx.customer.updateMany({
        where: { id: customerId, storeCredit: { gte: -increment } },
        data: { storeCredit: { increment } },
      });
      if (count === 0) {
        const err = new Error('Số dư tín dụng không đủ để thực hiện giao dịch');
        err.status = 400;
        throw err;
      }
    } else {
      await tx.customer.update({
        where: { id: customerId },
        data: { storeCredit: { increment } },
      });
    }

    const txRecord = await tx.storeCreditTransaction.create({
      data: {
        customerId,
        amount,
        type,
        note,
        referenceId,
        createdById: userId,
      },
    });

    return txRecord;
  });

  auditService.log({ userId, action: 'CREATE_STORE_CREDIT', entity: 'StoreCreditTransaction', entityId: result.id, after: { customerId, amount, type, note } });
  return result;
};

module.exports = { listByCustomer, getBalance, create };
