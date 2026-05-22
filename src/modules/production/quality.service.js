// src/modules/production/quality.service.js
const prisma = require("../../config/prisma");

const getForWorkOrder = (workOrderId) =>
  prisma.qualityCheck.findFirst({
    where: { workOrderId },
    include: { items: true, checkedBy: { select: { fullName: true } } },
  });

const createCheck = async (workOrderId, { items = [], notes } = {}) => {
  const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  if (wo.status !== "COMPLETED" && wo.status !== "IN_PROGRESS") {
    throw { status: 400, message: "Chỉ kiểm tra chất lượng khi WO đang chạy hoặc đã hoàn thành" };
  }
  return prisma.qualityCheck.create({
    data: {
      workOrderId, notes,
      items: {
        create: items.map((it) => ({ name: it.name, result: it.result || null, notes: it.notes })),
      },
    },
    include: { items: true },
  });
};

const submitCheck = async (checkId, { items = [], status, notes, userId }) => {
  if (!["PASSED", "FAILED", "PARTIAL"].includes(status)) {
    throw { status: 400, message: "status phải là PASSED/FAILED/PARTIAL" };
  }
  return prisma.$transaction(async (tx) => {
    for (const it of items) {
      await tx.qualityCheckItem.update({ where: { id: it.id }, data: { result: it.result, notes: it.notes } });
    }
    return tx.qualityCheck.update({
      where: { id: checkId },
      data: { status, notes, checkedById: userId, checkedAt: new Date() },
      include: { items: true },
    });
  });
};

module.exports = { getForWorkOrder, createCheck, submitCheck };
