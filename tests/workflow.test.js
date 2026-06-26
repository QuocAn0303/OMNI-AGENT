/**
 * tests/workflow.test.js
 * Phase D: Workflow Engine tests (triggers, approval chains, auto-approve)
 */
jest.mock("../src/config/prisma", () => {
  const m = {};
  m.workflow = {
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };
  m.workflowRun = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  m.workflowApproval = {
    create: jest.fn().mockResolvedValue({}),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  m.workflowStep = { findMany: jest.fn() };
  m.user = { findFirst: jest.fn() };
  m.expense = { findUnique: jest.fn() };
  m.purchaseOrder = { findUnique: jest.fn() };
  m.employee = { findUnique: jest.fn() };
  m.shift = { create: jest.fn().mockResolvedValue({}) };
  m.$transaction = jest.fn(async (fn) => fn(m));
  return m;
});
jest.mock("../src/modules/notifications/notification.service", () => ({
  createOne: jest.fn().mockResolvedValue({}),
  notifyRoles: jest.fn(),
}));
jest.mock("../src/modules/accounting/expense.service", () => ({
  approve: jest.fn().mockResolvedValue({ id: "exp1" }),
}));
jest.mock("../src/modules/accounting/purchase.service", () => ({
  approve: jest.fn().mockResolvedValue({ id: "po1" }),
}));
jest.mock("../src/modules/hr/leave.service", () => ({
  approveLeave: jest.fn().mockResolvedValue({ success: true }),
}));

const prisma = require("../src/config/prisma");
const {
  createWorkflow,
  trigger,
  decide,
  evaluateCondition,
  getPendingApprovals,
} = require("../src/modules/workflow/workflow.service");
const notifService = require("../src/modules/notifications/notification.service");

describe("workflow — engine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ════════════════ WORKFLOW CREATION ════════════════
  describe("createWorkflow", () => {
    test("should create workflow with multiple approval steps", async () => {
      prisma.workflow.create.mockResolvedValue({
        id: "wf1", name: "Test", trigger: "EXPENSE_ABOVE",
        steps: [{ sequence: 1, type: "APPROVAL" }, { sequence: 2, type: "APPROVAL" }],
      });

      const wf = await createWorkflow("user1", {
        name: "Duyet 2 cap",
        trigger: "EXPENSE_ABOVE",
        config: { threshold: 10000000 },
        steps: [
          { sequence: 1, type: "APPROVAL", config: { approverId: "mgr1" } },
          { sequence: 2, type: "APPROVAL", config: { approverId: "dir1" } },
        ],
      });

      expect(prisma.workflow.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            steps: { create: expect.arrayContaining([
              expect.objectContaining({ sequence: 1 }),
              expect.objectContaining({ sequence: 2 }),
            ])},
          }),
        })
      );
    });

    test("should reject invalid trigger type", async () => {
      await expect(createWorkflow("user1", {
        name: "Bad", trigger: "INVALID", config: {}, steps: [],
      })).rejects.toEqual(expect.objectContaining({ status: 400 }));
    });
  });

  // ════════════════ CONDITION EVALUATION ════════════════
  describe("evaluateCondition", () => {
    test("EXPENSE_ABOVE: should trigger when amount > threshold", () => {
      const wf = { trigger: "EXPENSE_ABOVE", config: { threshold: 5000000 } };
      expect(evaluateCondition(wf, { amount: 6000000 })).toBe(true);
      expect(evaluateCondition(wf, { amount: 4000000 })).toBe(false);
    });

    test("EXPENSE_ABOVE: should not trigger when exactly at threshold", () => {
      const wf = { trigger: "EXPENSE_ABOVE", config: { threshold: 5000000 } };
      expect(evaluateCondition(wf, { amount: 5000000 })).toBe(false);
    });

    test("PO_ABOVE: should trigger based on totalAmount", () => {
      const wf = { trigger: "PO_ABOVE", config: { threshold: 10000000 } };
      expect(evaluateCondition(wf, { totalAmount: 15000000 })).toBe(true);
      expect(evaluateCondition(wf, { totalAmount: 5000000 })).toBe(false);
    });

    test("LEAVE_REQUEST: should always trigger", () => {
      const wf = { trigger: "LEAVE_REQUEST", config: {} };
      expect(evaluateCondition(wf, {})).toBe(true);
    });

    test("CUSTOM: should always trigger", () => {
      const wf = { trigger: "CUSTOM", config: {} };
      expect(evaluateCondition(wf, { amount: 0 })).toBe(true);
    });
  });

  // ════════════════ TRIGGER EXECUTION ════════════════
  describe("trigger", () => {
    test("should create run and approvals for matching workflow", async () => {
      prisma.workflow.findMany.mockResolvedValue([{
        id: "wf1", name: "Duyet CP", trigger: "EXPENSE_ABOVE",
        config: { threshold: 5000000 },
        steps: [
          { sequence: 1, type: "APPROVAL", config: { approverId: "user2" } },
          { sequence: 2, type: "APPROVAL", config: { approverId: "user3" } },
        ],
      }]);
      prisma.workflowRun.create.mockResolvedValue({ id: "run1" });

      const runs = await trigger("EXPENSE_ABOVE", {
        entityType: "Expense", entityId: "exp1", data: { amount: 7000000 },
      });

      expect(runs).toHaveLength(1);
      expect(prisma.workflowRun.create).toHaveBeenCalledTimes(1);
      expect(prisma.workflowApproval.create).toHaveBeenCalledTimes(2);
      expect(notifService.createOne).toHaveBeenCalledTimes(2);
    });

    test("should skip workflow if condition not met", async () => {
      prisma.workflow.findMany.mockResolvedValue([{
        id: "wf1", name: "Duyet", trigger: "EXPENSE_ABOVE",
        config: { threshold: 10000000 },
        steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: "u1" } }],
      }]);

      const runs = await trigger("EXPENSE_ABOVE", {
        entityType: "Expense", entityId: "exp2", data: { amount: 3000000 },
      });

      expect(runs).toHaveLength(0);
      expect(prisma.workflowRun.create).not.toHaveBeenCalled();
    });

    test("should handle multiple matching workflows", async () => {
      prisma.workflow.findMany.mockResolvedValue([
        { id: "wf1", name: "Basic", trigger: "LEAVE_REQUEST", config: {},
          steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: "u1" } }] },
        { id: "wf2", name: "Extended", trigger: "LEAVE_REQUEST", config: {},
          steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: "u2" } }] },
      ]);
      prisma.workflowRun.create.mockResolvedValue({ id: "run1" });

      const runs = await trigger("LEAVE_REQUEST", {
        entityType: "Leave", entityId: "emp1", data: { days: 5 },
      });

      expect(runs).toHaveLength(2);
      expect(prisma.workflowRun.create).toHaveBeenCalledTimes(2);
    });

    test("should not create approvals for non-APPROVAL step types", async () => {
      prisma.workflow.findMany.mockResolvedValue([{
        id: "wf1", name: "Notify only", trigger: "CUSTOM",
        config: {},
        steps: [
          { sequence: 1, type: "NOTIFICATION", config: {} },
          { sequence: 2, type: "APPROVAL", config: { approverId: "u1" } },
        ],
      }]);
      prisma.workflowRun.create.mockResolvedValue({ id: "run1" });

      await trigger("CUSTOM", {
        entityType: "Custom", entityId: "c1", data: {},
      });

      expect(prisma.workflowApproval.create).toHaveBeenCalledTimes(1);
    });

    test("should handle missing approverId gracefully", async () => {
      prisma.workflow.findMany.mockResolvedValue([{
        id: "wf1", name: "Broken", trigger: "CUSTOM",
        config: {},
        steps: [
          { sequence: 1, type: "APPROVAL", config: {} },
        ],
      }]);
      prisma.workflowRun.create.mockResolvedValue({ id: "run1" });

      const runs = await trigger("CUSTOM", {
        entityType: "Custom", entityId: "c1", data: {},
      });

      expect(runs).toHaveLength(1);
      expect(prisma.workflowApproval.create).not.toHaveBeenCalled();
    });
  });

  // ════════════════ DECIDE (APPROVE/REJECT) ════════════════
  describe("decide", () => {
    test("should approve a pending approval", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app1", runId: "run1", approverId: "user1", status: "PENDING",
      });
      prisma.workflowApproval.update.mockResolvedValue({});
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run1", workflowId: "wf1",
        approvals: [{ id: "app1", status: "APPROVED" }],
      });
      prisma.workflow.findUnique.mockResolvedValue({
        id: "wf1", trigger: "EXPENSE_ABOVE",
      });

      await decide("app1", "user1", { status: "APPROVED", comment: "OK" });

      expect(prisma.workflowApproval.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "APPROVED", comment: "OK" }),
        })
      );
    });

    test("should reject if user is not the approver", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app1", runId: "run1", approverId: "user2", status: "PENDING",
      });

      await expect(
        decide("app1", "user1", { status: "APPROVED" })
      ).rejects.toEqual(expect.objectContaining({ status: 403 }));
    });

    test("should reject if approval already processed", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app1", runId: "run1", approverId: "user1", status: "APPROVED",
      });

      await expect(
        decide("app1", "user1", { status: "APPROVED" })
      ).rejects.toEqual(expect.objectContaining({ status: 400 }));
    });

    test("should mark run APPROVED when all approvals done", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app2", runId: "run1", approverId: "user1", status: "PENDING",
        stepId: "step2",
      });
      prisma.workflowApproval.update.mockResolvedValue({});
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run1", workflowId: "wf1",
        entity: "Expense", entityId: "exp1",
        approvals: [
          { id: "app1", status: "APPROVED" },
          { id: "app2", status: "APPROVED" },
        ],
      });
      prisma.workflowRun.update.mockResolvedValue({});

      const expenseService = require("../src/modules/accounting/expense.service");
      prisma.workflow.findUnique.mockResolvedValue({
        id: "wf1", trigger: "EXPENSE_ABOVE",
      });

      await decide("app2", "user1", { status: "APPROVED" });

      expect(prisma.workflowRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "APPROVED" }),
        })
      );
      expect(expenseService.approve).toHaveBeenCalled();
    });

    test("should mark run REJECTED if any approval rejected", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app1", runId: "run1", approverId: "user1", status: "PENDING",
      });
      prisma.workflowApproval.update.mockResolvedValue({});
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run1", workflowId: "wf1",
        approvals: [
          { id: "app1", status: "REJECTED" },
        ],
      });
      prisma.workflowRun.update.mockResolvedValue({});
      prisma.workflow.findUnique.mockResolvedValue({
        id: "wf1", trigger: "EXPENSE_ABOVE",
      });

      await decide("app1", "user1", { status: "REJECTED", comment: "Too much" });

      expect(prisma.workflowRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "REJECTED" }),
        })
      );
      // Should NOT auto-approve entity when rejected
      const expenseService = require("../src/modules/accounting/expense.service");
      expect(expenseService.approve).not.toHaveBeenCalled();
    });

    test("should auto-approve PO when workflow completes", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app1", runId: "run1", approverId: "user1", status: "PENDING",
      });
      prisma.workflowApproval.update.mockResolvedValue({});
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run1", workflowId: "wf1",
        entity: "PurchaseOrder", entityId: "po1",
        approvals: [{ id: "app1", status: "APPROVED" }],
      });
      prisma.workflowRun.update.mockResolvedValue({});
      prisma.workflow.findUnique.mockResolvedValue({
        id: "wf1", trigger: "PO_ABOVE",
      });

      const purchaseService = require("../src/modules/accounting/purchase.service");

      await decide("app1", "user1", { status: "APPROVED" });

      expect(purchaseService.approve).toHaveBeenCalledWith("po1", "ADMIN", "user1");
    });

    test("should auto-approve leave when workflow completes", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({
        id: "app1", runId: "run1", approverId: "user1", status: "PENDING",
      });
      prisma.workflowApproval.update.mockResolvedValue({});
      prisma.workflowRun.findUnique.mockResolvedValue({
        id: "run1", workflowId: "wf1",
        entity: "Leave", entityId: "emp1",
        approvals: [{ id: "app1", status: "APPROVED" }],
      });
      prisma.workflowRun.update.mockResolvedValue({});
      prisma.workflow.findUnique.mockResolvedValue({
        id: "wf1", trigger: "LEAVE_REQUEST",
      });

      const leaveService = require("../src/modules/hr/leave.service");

      await decide("app1", "user1", { status: "APPROVED" });

      expect(leaveService.approveLeave).toHaveBeenCalledWith("run1", "user1");
    });
  });

  // ════════════════ PENDING APPROVALS ════════════════
  describe("getPendingApprovals", () => {
    test("should return pending approvals for a user", async () => {
      prisma.workflowApproval.findMany.mockResolvedValue([
        { id: "a1", status: "PENDING",
          run: { workflow: { name: "Duyet CP", trigger: "EXPENSE_ABOVE" } },
          step: { sequence: 1, type: "APPROVAL" } },
        { id: "a2", status: "PENDING",
          run: { workflow: { name: "Duyet PO", trigger: "PO_ABOVE" } },
          step: { sequence: 2, type: "APPROVAL" } },
      ]);

      const approvals = await getPendingApprovals("user5");

      expect(approvals).toHaveLength(2);
    });

    test("should return empty array when no pending approvals", async () => {
      prisma.workflowApproval.findMany.mockResolvedValue([]);

      const approvals = await getPendingApprovals("user5");

      expect(approvals).toHaveLength(0);
    });
  });
});
