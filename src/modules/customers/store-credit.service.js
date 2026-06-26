const prisma = require('../../config/prisma');

const listByCustomer = async (customerId, { page = 1, limit = 20 }) => {
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.storeCreditTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
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

    let increment;
    if (type === 'EARN' || type === 'REFUND') {
      increment = amount;
    } else if (type === 'SPEND' || type === 'ADJUST') {
      increment = -amount;
    } else {
      increment = 0;
    }

    await tx.customer.update({
      where: { id: customerId },
      data: { storeCredit: { increment } },
    });

    return txRecord;
  });

  return result;
};

module.exports = { listByCustomer, getBalance, create };
