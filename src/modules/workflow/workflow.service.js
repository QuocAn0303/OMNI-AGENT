/**
 * modules/workflow/workflow.service.js — Quản lý luồng phê duyệt tự động
 * 
 * Tổng quan:
 - Hỗ trợ tạo luồng phê duyệt (workflow) với trigger và steps
 - Tự động kick hoạt workflow khi sự kiện xảy ra (EXPENSE_ABOVE, PO_ABOVE, LEAVE_REQUEST, CUSTOM)
 * 
 * Hàm:
 * - listWorkflows(): Lấy tất cả workflow đang active kèm steps
 * - createWorkflow(userId, {name, trigger, config, steps}): Tạo workflow mới với các steps
 * - updateWorkflow(id, data): Cập nhật workflow
 * - trigger(triggerType, {entityType, entityId, data}): Kích hoạt workflow theo trigger, tạo run + approval tasks
 * - evaluateCondition(workflow, data): Kiểm tra điều kiện threshold trước khi chạy
 * - getRun(id): Lấy thông tin run + approvals
 * - decide(approvalId, userId, {status, comment}): Phê duyệt/từ chối approval, tự động cập nhật run status
 */
// src/modules/workflow/workflow.service.js
const prisma = require("../../config/prisma");
const notifService = require("../notifications/notification.service");
const logger = require('../../utils/logger');

const TRIGGERS = ["EXPENSE_ABOVE", "PO_ABOVE", "LEAVE_REQUEST", "CUSTOM", "PAYMENT_APPROVAL", "DISCOUNT_APPROVAL", "RETURN_APPROVAL", "CONTRACT_APPROVAL", "ADVANCE_APPROVAL"];

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
        const notifTypeMap = {
          EXPENSE_ABOVE: "EXPENSE_PENDING_APPROVAL",
          PO_ABOVE: "PO_PENDING_APPROVAL",
          LEAVE_REQUEST: "LEAVE_REQUEST",
          PAYMENT_APPROVAL: "PAYMENT_APPROVAL",
          DISCOUNT_APPROVAL: "DISCOUNT_APPROVAL",
          RETURN_APPROVAL: "RETURN_APPROVAL",
          CONTRACT_APPROVAL: "CONTRACT_APPROVAL",
          ADVANCE_APPROVAL: "ADVANCE_APPROVAL",
          CUSTOM: "SYSTEM",
        };
        await notifService.createOne({
          userId: step.config.approverId,
          type: notifTypeMap[triggerType] || "PO_PENDING_APPROVAL",
          severity: "WARNING",
          title: `Cần duyệt: ${wf.name}`,
          message: `${entityType} #${entityId} cần được phê duyệt`,
          link: "/workflows",
          meta: { workflowId: wf.id, runId: run.id, triggerType, entityType, entityId },
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
    // Mục 7: hỗ trợ dải hạn mức (minAmount/maxAmount) cho PO đa cấp:
    // < 5tr → không workflow nào kích hoạt (auto-approve);
    // 5tr–50tr → workflow MANAGER; > 50tr → workflow ADMIN (xem po-template.seed.js).
    const amount = Number(data.totalAmount || 0);
    const passesMin = cfg.minAmount == null || amount >= Number(cfg.minAmount);
    const passesMax = cfg.maxAmount == null || amount <= Number(cfg.maxAmount);
    return amount > Number(cfg.threshold || 0) && passesMin && passesMax;
  }
  if (workflow.trigger === "PAYMENT_APPROVAL") {
    return Number(data.amount || 0) > Number(cfg.threshold || 0);
  }
  if (workflow.trigger === "DISCOUNT_APPROVAL") {
    return Number(data.discountAmount || data.discountPercent || 0) > Number(cfg.threshold || 0);
  }
  if (workflow.trigger === "RETURN_APPROVAL") {
    return Number(data.refundAmount || 0) > Number(cfg.threshold || 0);
  }
  if (workflow.trigger === "CONTRACT_APPROVAL") {
    return Number(data.value || 0) > Number(cfg.threshold || 0);
  }
  if (workflow.trigger === "ADVANCE_APPROVAL") {
    return Number(data.amount || 0) > Number(cfg.threshold || 0);
  }
  return true; // LEAVE_REQUEST / CUSTOM — always trigger
};

const getRun = (id) =>
  prisma.workflowRun.findUniqueOrThrow({
    where: { id },
    include: {
      workflow: true,
      approvals: { include: { step: true, approver: { select: { fullName: true } } } },
    },
  });

const getPendingApprovals = (userId) =>
  prisma.workflowApproval.findMany({
    where: { approverId: userId, status: "PENDING" },
    include: {
      run: { include: { workflow: { select: { name: true, trigger: true } } } },
      step: { select: { sequence: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
  });

const listRuns = ({ page = 1, limit = 20 }) => {
  const skip = (page - 1) * limit;
  return prisma.workflowRun.findMany({
    include: {
      workflow: { select: { name: true, trigger: true } },
      approvals: { include: { approver: { select: { fullName: true } } } },
    },
    orderBy: { startedAt: "desc" },
    skip,
    take: limit,
  });
};

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

    // Auto-approve underlying entity when all approvals pass
    if (!anyRejected) {
      try {
        const wf = await prisma.workflow.findUnique({ where: { id: run.workflowId } });
        if (wf?.trigger === "EXPENSE_ABOVE") {
          const expenseSvc = require("../accounting/expense.service");
          await expenseSvc.approve(run.entityId, userId, { role: "ADMIN" });
        } else if (wf?.trigger === "PO_ABOVE") {
          const po = await prisma.purchaseOrder.findUnique({ where: { id: run.entityId } });
          if (po?.status === "PENDING_APPROVAL") {
            await prisma.purchaseOrder.update({
              where: { id: run.entityId },
              data: { status: "APPROVED", approvedById: userId },
            });
            const auditService = require("../audit/audit.service");
            await auditService.log({
              userId,
              action: "PO_APPROVE",
              entity: "PurchaseOrder",
              entityId: run.entityId,
              before: { status: "PENDING_APPROVAL" },
              after: { status: "APPROVED", approvedById: userId },
              meta: { source: "workflow", workflowRunId: run.id },
            }).catch(() => {});
          } else {
            const purchaseSvc = require("../accounting/purchase.service");
            await purchaseSvc.approve(run.entityId, "ADMIN", userId);
          }
        } else if (wf?.trigger === "LEAVE_REQUEST") {
          const leaveSvc = require("../hr/leave.service");
          await leaveSvc.approveLeave(run.id, userId);
        } else if (wf?.trigger === "RETURN_APPROVAL") {
          const returnSvc = require("../returns/return.service");
          await returnSvc.approve(run.entityId, userId, "ADMIN");
        } else if (wf?.trigger === "DISCOUNT_APPROVAL") {
          logger.info(`[workflow] Discount ${run.entityId} approved`);
        } else if (wf?.trigger === "CONTRACT_APPROVAL") {
          logger.info(`[workflow] Contract ${run.entityId} approved`);
        } else if (wf?.trigger === "ADVANCE_APPROVAL") {
          logger.info(`[workflow] Advance ${run.entityId} approved`);
        } else if (wf?.trigger === "PAYMENT_APPROVAL") {
          logger.info(`[workflow] Payment ${run.entityId} approved`);
        }
      } catch (e) {
        logger.error(`[workflow] auto-approve entity ${run.entityId} failed:`, e.message);
      }
    } else {
      // Handle rejection — update entity status to REJECTED
      try {
        const wf = await prisma.workflow.findUnique({ where: { id: run.workflowId } });
        if (wf?.trigger === "PO_ABOVE") {
          const po = await prisma.purchaseOrder.findUnique({ where: { id: run.entityId } });
          if (po && ["PENDING", "PENDING_APPROVAL"].includes(po.status)) {
            await prisma.purchaseOrder.update({
              where: { id: run.entityId },
              data: { status: "REJECTED" },
            });
            const auditService = require("../audit/audit.service");
            await auditService.log({
              userId,
              action: "PO_REJECT",
              entity: "PurchaseOrder",
              entityId: run.entityId,
              before: { status: po.status },
              after: { status: "REJECTED" },
              meta: { source: "workflow", workflowRunId: run.id },
            }).catch(() => {});
          }
        }
      } catch (e) {
        logger.error(`[workflow] auto-reject entity ${run.entityId} failed:`, e.message);
      }
    }
  }
  return approval;
};

module.exports = { listWorkflows, createWorkflow, updateWorkflow, trigger, evaluateCondition, getRun, decide, getPendingApprovals, listRuns };
