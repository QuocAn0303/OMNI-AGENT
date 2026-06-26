const prisma = require("../../config/prisma");
const workflowService = require("../workflow/workflow.service");
const notifService = require("../notifications/notification.service");

const create = async (employeeId, userId, data) => {
  const { date, hours, reason = "", rate = 1.5 } = data;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { fullName: true } } },
  });
  if (!employee || !employee.isActive) throw { status: 404, message: "Khong tim thay nhan vien" };

  const otDate = new Date(date);
  const otAmount = Math.round((Number(employee.baseSalary || 5000000) / 26 / 8) * hours * rate);

  const overtime = await prisma.overtimeRequest.create({
    data: { employeeId, date: otDate, hours, reason, rate, amount: otAmount, status: "PENDING", requestedById: userId },
  });

  await workflowService.trigger("CUSTOM", {
    entityType: "Overtime", entityId: overtime.id,
    data: { employeeName: employee.user.fullName, date, hours, amount: otAmount, reason },
  });

  return overtime;
};

const list = async (employeeId, month, year) => {
  const from = new Date(year || new Date().getFullYear(), (month || new Date().getMonth() + 1) - 1, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59);
  return prisma.overtimeRequest.findMany({
    where: { employeeId: employeeId || undefined, date: { gte: from, lte: to } },
    include: { employee: { include: { user: { select: { fullName: true } } } } },
    orderBy: { date: "desc" },
  });
};

const approve = async (id, userId) => {
  const ot = await prisma.overtimeRequest.update({
    where: { id }, data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() },
  });
  return ot;
};

module.exports = { create, list, approve };
