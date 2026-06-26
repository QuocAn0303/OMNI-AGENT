const prisma = require("../../config/prisma");
const workflowService = require("../workflow/workflow.service");
const notifService = require("../notifications/notification.service");

const LOG = "[leave]";

const create = async (employeeId, userId, data) => {
  const { startDate, endDate, type = "PAID", reason = "" } = data;

  if (!startDate || !endDate) {
    throw { status: 400, message: "Vui lòng nhap ngày bắt đầu va ngày kết thúc" };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: { select: { id: true, fullName: true } } },
  });
  if (!employee) throw { status: 404, message: "Không tìm thấy nhân viên" };
  if (!employee.isActive) throw { status: 400, message: "Nhân viên da nghi viec" };

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) throw { status: 400, message: "Ngay ket thuc phai sau ngày bắt đầu" };

  const days = Math.ceil((end - start) / (86400000)) + 1;

  const leaveData = {
    employeeId: employee.id,
    employeeName: employee.user.fullName,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    days,
    type,
    reason,
    requestedById: userId,
  };

  // Trigger LEAVE_REQUEST workflow
  const runs = await workflowService.trigger("LEAVE_REQUEST", {
    entityType: "Leave",
    entityId: employeeId,
    data: leaveData,
  });

  if (!runs.length) {
    // No workflow configured — notify manager directly
    await notifService.notifyRoles(["MANAGER", "ADMIN"], {
      type: "LEAVE_REQUEST",
      severity: "INFO",
      title: `Yeu cau nghi phep: ${employee.user.fullName}`,
      message: `${employee.user.fullName} xin nghi ${days} ngay (${start.toLocaleDateString("vi-VN")} - ${end.toLocaleDateString("vi-VN")}). Ly do: ${reason || "Không co"}`,
      link: "/hr",
      meta: { employeeId, leaveData },
    });
  }

  return {
    success: true,
    data: {
      employeeName: employee.user.fullName,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      days,
      type,
      reason,
      runs: runs.map((r) => ({ id: r.id, status: r.status })),
    },
  };
};

const list = async (employeeId) => {
  const where = employeeId ? { entityId: employeeId, entity: "Leave" } : { entity: "Leave" };
  return prisma.workflowRun.findMany({
    where,
    include: {
      workflow: { select: { name: true } },
      approvals: { include: { approver: { select: { fullName: true } } } },
    },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
};

const approveLeave = async (runId, userId) => {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    include: { data: true },
  });
  if (!run || run.entity !== "Leave") throw { status: 404, message: "Không tìm thấy yeu cau nghi phep" };

  const leaveData = run.data;
  try {
    // Auto-create shifts for leave days (mark as absent)
    const employee = await prisma.employee.findUnique({ where: { id: run.entityId } });
    if (employee) {
      const start = new Date(leaveData.startDate);
      const end = new Date(leaveData.endDate);
      const current = new Date(start);
      while (current <= end) {
        await prisma.shift.create({
          data: {
            employeeId: employee.id,
            date: new Date(current),
            type: "MORNING",
            status: "ABSENT",
            note: `Nghi phep (${leaveData.type})`,
          },
        }).catch(() => {});
        current.setDate(current.getDate() + 1);
      }
    }
  } catch (e) {
    console.error(`${LOG} shift update error:`, e.message);
  }

  console.log(`${LOG} approved: ${leaveData.employeeName}, ${leaveData.days} days`);
  return { success: true, message: "Da phê duyệt nghi phep" };
};

module.exports = { create, list, approveLeave };
