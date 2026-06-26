/**
 * modules/production/quality.service.js — Service kiểm tra chất lượng sản xuất
 *
 * Tổng quan:
 * - Cung cấp logic tạo và hoàn tất phiếu kiểm tra chất lượng (QualityCheck)
 * - Mỗi phiếu gồm nhiều hạng mục (QualityCheckItem) với kết quả PASS/FAIL
 * - Chỉ kiểm tra được khi WO ở trạng thái IN_PROGRESS hoặc COMPLETED
 *
 * Hàm:
 * - getForWorkOrder(workOrderId): Lấy phiếu kiểm tra chất lượng theo mã lệnh sản xuất
 * - createCheck(workOrderId, { items, notes }): Tạo phiếu kiểm tra mới với danh sách hạng mục, kiểm tra trạng thái WO
 * - submitCheck(checkId, { items, status, notes, userId }): Hoàn tất phiếu — cập nhật kết quả từng item, set status (PASSED/FAILED/PARTIAL)
 */
// src/modules/production/quality.service.js
const prisma = require("../../config/prisma");

const list = async ({ page = 1, limit = 50 } = {}) => {
  page = Number(page);
  limit = Number(limit);
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.qualityCheck.findMany({
      skip: offset,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        checkedBy: { select: { fullName: true } },
        workOrder: { select: { id: true, code: true, product: { select: { name: true } } } },
      },
    }),
    prisma.qualityCheck.count(),
  ]);
  return { checks: rows, total, page, limit };
};

const getForWorkOrder = (workOrderId) =>
  prisma.qualityCheck.findMany({
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

module.exports = { list, getForWorkOrder, createCheck, submitCheck };
