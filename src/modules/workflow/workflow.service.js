// src/modules/workflow/workflow.service.js
const prisma = require("../../config/prisma");
const notifService = require("../notifications/notification.service");

const TRIGGERS = ["EXPENSE_ABOVE", "PO_ABOVE", "LEAVE_REQUEST", "CUSTOM"];

const listWorkflows = () =>
  prisma.workflow.findMany({
    where: { isActive: true },
    include: { steps: { orderBy: { sequence: "asc" } }, createdBy: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
  });

const createWorkflow = async (userId, { name, trigger, config = {}, steps = [] }) => {
  if (!TRIGGERS.includes(trigger)) throw { status: 400, message: `Trigger không hợp lệ. Chọn: ${TRIGGERS.join(", ")}` };
  return prisma.workflow.create({
    data: {
      name, trigger, config, createdById: userId,
      steps: {
        create: steps.map((s, i) => ({
          sequence: s.sequence ?? i + 1,
          type: s.type,
          config: s.config || {},
        })),
      },
    },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
};

const updateWorkflow = async (id, data) => {
  await prisma.workflow.findUniqueOrThrow({ where: { id } });
  return prisma.workflow.update({ where: { id }, data });
};

// Check if any workflow should fire for a given entity+event, and create a run
const trigger = async (triggerType, { entityType, entityId, data = {} }) => {
  const workflows = await prisma.workflow.findMany({
    where: { trigger: triggerType, isActive: true },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });

  const runs = [];
  for (const wf of workflows) {
    // Evaluate condition (e.g. EXPENSE_ABOVE threshold)
    if (!evaluateCondition(wf, data)) continue;

    const run = await prisma.workflowRun.create({
      data: { workflowId: wf.id, entity: entityType, entityId, data, status: "PENDING" },
    });

    // Create approval tasks for APPROVAL steps
    for (const step of wf.steps) {
      if (step.type === "APPROVAL" && step.config?.approverId) {
        await prisma.workflowApproval.create({
          data: { runId: run.id, stepId: step.id, approverId: step.config.approverId },
        });
        // Notify approver
        await notifService.createNotification({
          userId: step.config.approverId,
          type: "WORKFLOW_APPROVAL",
          title: `Cần duyệt: ${wf.name}`,
          message: `${entityType} #${entityId} cần được phê duyệt`,
          entityType,
          entityId,
        }).catch(() => {});
      }
    }
    runs.push(run);
  }
  return runs;
};

const evaluateCondition = (workflow, data) => {
  const cfg = workflow.config || {};
  if (workflow.trigger === "EXPENSE_ABOVE") {
    return Number(data.amount || 0) > Number(cfg.threshold || 0);
  }
  if (workflow.trigger === "PO_ABOVE") {
    return Number(data.totalAmount || 0) > Number(cfg.threshold || 0);
  }
  return true; // CUSTOM / LEAVE_REQUEST — always trigger
};

const getRun = (id) =>
  prisma.workflowRun.findUniqueOrThrow({
    where: { id },
    include: {
      workflow: true,
      approvals: { include: { step: true, approver: { select: { fullName: true } } } },
    },
  });

const decide = async (approvalId, userId, { status, comment }) => {
  if (!["APPROVED", "REJECTED"].includes(status)) throw { status: 400, message: "status phải APPROVED hoặc REJECTED" };

  const approval = await prisma.workflowApproval.findUniqueOrThrow({ where: { id: approvalId } });
  if (approval.approverId !== userId) throw { status: 403, message: "Bạn không phải người duyệt" };
  if (approval.status !== "PENDING") throw { status: 400, message: "Đã xử lý rồi" };

  await prisma.workflowApproval.update({
    where: { id: approvalId },
    data: { status, comment, decidedAt: new Date() },
  });

  // Check if all approvals in this run are done
  const run = await prisma.workflowRun.findUnique({
    where: { id: approval.runId },
    include: { approvals: true },
  });
  const allDone = run.approvals.every((a) => a.status !== "PENDING");
  const anyRejected = run.approvals.some((a) => a.status === "REJECTED");

  if (allDone) {
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: anyRejected ? "REJECTED" : "APPROVED", endedAt: new Date() },
    });
  }
  return approval;
};

module.exports = { listWorkflows, createWorkflow, updateWorkflow, trigger, getRun, decide };
