jest.mock("../src/config/prisma", () => {
  const m = {};
  m.workflow = { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), count: jest.fn() };
  m.workflowRun = { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) };
  m.workflowApproval = { create: jest.fn().mockResolvedValue({}), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) };
  m.customer = { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 3 }) };
  m.auditLog = { deleteMany: jest.fn().mockResolvedValue({ count: 100 }) };
  m.notification = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 50 }) };
  m.order = { aggregate: jest.fn(), count: jest.fn() };
  m.expense = { aggregate: jest.fn() };
  m.user = { findFirst: jest.fn().mockResolvedValue({ id: "sys" }) };
  m.employee = { findUnique: jest.fn() };
  m.overtimeRequest = { create: jest.fn(), findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) };
  return m;
});
jest.mock("../src/modules/notifications/notification.service", () => ({ notifyRoles: jest.fn(), createOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/accounting/expense.service", () => ({ approve: jest.fn() }));
jest.mock("../src/modules/accounting/purchase.service", () => ({ approve: jest.fn() }));
jest.mock("../src/modules/hr/leave.service", () => ({ approveLeave: jest.fn() }));
jest.mock("../src/modules/returns/return.service", () => ({ approve: jest.fn() }));
jest.mock("../src/modules/workflow/workflow.service", () => {
  const original = jest.requireActual("../src/modules/workflow/workflow.service");
  return original;
});

const prisma = require("../src/config/prisma");
const { evaluateCondition, trigger, decide, createWorkflow } = require("../src/modules/workflow/workflow.service");
const { autoCloseDormantCustomers, autoArchiveData, weeklyPnLEmail } = require("../src/modules/automation/automation.service");
const notif = require("../src/modules/notifications/notification.service");

describe("workflow — new triggers", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  describe("evaluateCondition", () => {
    test("PAYMENT_APPROVAL triggers when amount > threshold", () => {
      const wf = { trigger: "PAYMENT_APPROVAL", config: { threshold: 10000000 } };
      expect(evaluateCondition(wf, { amount: 15000000 })).toBe(true);
      expect(evaluateCondition(wf, { amount: 5000000 })).toBe(false);
    });

    test("DISCOUNT_APPROVAL triggers on percent > threshold", () => {
      const wf = { trigger: "DISCOUNT_APPROVAL", config: { threshold: 20 } };
      expect(evaluateCondition(wf, { discountPercent: 25 })).toBe(true);
    });

    test("DISCOUNT_APPROVAL triggers on amount > threshold", () => {
      const wf = { trigger: "DISCOUNT_APPROVAL", config: { threshold: 500000 } };
      expect(evaluateCondition(wf, { discountAmount: 1000000 })).toBe(true);
      expect(evaluateCondition(wf, { discountAmount: 100000 })).toBe(false);
    });

    test("RETURN_APPROVAL triggers on refundAmount", () => {
      const wf = { trigger: "RETURN_APPROVAL", config: { threshold: 5000000 } };
      expect(evaluateCondition(wf, { refundAmount: 8000000 })).toBe(true);
      expect(evaluateCondition(wf, { refundAmount: 2000000 })).toBe(false);
    });

    test("CONTRACT_APPROVAL triggers on value", () => {
      const wf = { trigger: "CONTRACT_APPROVAL", config: { threshold: 50000000 } };
      expect(evaluateCondition(wf, { value: 100000000 })).toBe(true);
    });

    test("ADVANCE_APPROVAL triggers on amount", () => {
      const wf = { trigger: "ADVANCE_APPROVAL", config: { threshold: 3000000 } };
      expect(evaluateCondition(wf, { amount: 5000000 })).toBe(true);
      expect(evaluateCondition(wf, { amount: 1000000 })).toBe(false);
    });

    test("LEAVE_REQUEST always triggers regardless of config", () => {
      const wf = { trigger: "LEAVE_REQUEST", config: { threshold: 999999 } };
      expect(evaluateCondition(wf, { amount: 0 })).toBe(true);
    });
  });

  describe("trigger — new types", () => {
    test("PAYMENT_APPROVAL creates run + approvals", async () => {
      prisma.workflow.findMany.mockResolvedValue([{ id: "wf1", name: "Duyet TT", trigger: "PAYMENT_APPROVAL", config: { threshold: 10000000 }, steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: "u1" } }] }]);
      prisma.workflowRun.create.mockResolvedValue({ id: "run1" });

      const runs = await trigger("PAYMENT_APPROVAL", { entityType: "Payment", entityId: "pay1", data: { amount: 15000000 } });
      expect(runs).toHaveLength(1);
      expect(prisma.workflowRun.create).toHaveBeenCalled();
      expect(prisma.workflowApproval.create).toHaveBeenCalled();
    });

    test("DISCOUNT_APPROVAL skips when below threshold", async () => {
      prisma.workflow.findMany.mockResolvedValue([{ id: "wf1", name: "Duyet GG", trigger: "DISCOUNT_APPROVAL", config: { threshold: 500000 }, steps: [{ sequence: 1, type: "APPROVAL", config: { approverId: "u1" } }] }]);

      const runs = await trigger("DISCOUNT_APPROVAL", { entityType: "Order", entityId: "o1", data: { discountAmount: 100000 } });
      expect(runs).toHaveLength(0);
    });

    test("should validate new triggers in createWorkflow", async () => {
      prisma.workflow.create.mockResolvedValue({ id: "wf1" });

      await expect(createWorkflow("u1", { name: "OK", trigger: "PAYMENT_APPROVAL", config: { threshold: 10000000 }, steps: [] })).resolves.toBeDefined();
      await expect(createWorkflow("u1", { name: "BAD", trigger: "INVALID", config: {}, steps: [] })).rejects.toEqual(expect.objectContaining({ status: 400 }));
    });
  });

  describe("decide — auto-approve for new triggers", () => {
    test("RETURN_APPROVAL auto-approves return when workflow completes", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({ id: "app1", runId: "run1", approverId: "u1", status: "PENDING" });
      prisma.workflowRun.findUnique.mockResolvedValue({ id: "run1", workflowId: "wf1", entity: "OrderReturn", entityId: "ret1", approvals: [{ id: "app1", status: "APPROVED" }] });
      prisma.workflow.findUnique.mockResolvedValue({ id: "wf1", trigger: "RETURN_APPROVAL" });
      const returnSvc = require("../src/modules/returns/return.service");

      await decide("app1", "u1", { status: "APPROVED" });
      expect(returnSvc.approve).toHaveBeenCalledWith("ret1", "u1", "ADMIN");
    });

    test("ADVANCE_APPROVAL logs on complete", async () => {
      prisma.workflowApproval.findUniqueOrThrow.mockResolvedValue({ id: "app1", runId: "run1", approverId: "u1", status: "PENDING" });
      prisma.workflowRun.findUnique.mockResolvedValue({ id: "run1", workflowId: "wf1", entity: "Advance", entityId: "adv1", approvals: [{ id: "app1", status: "APPROVED" }] });
      prisma.workflow.findUnique.mockResolvedValue({ id: "wf1", trigger: "ADVANCE_APPROVAL" });

      const result = await decide("app1", "u1", { status: "APPROVED" });
      expect(result).toBeDefined();
    });
  });
});

describe("automation — new functions", () => {
  beforeEach(() => { jest.clearAllMocks(); prisma.user.findFirst.mockResolvedValue({ id: "sys" }); });

  describe("autoCloseDormantCustomers", () => {
    test("should deactivate customers with no orders in 6 months", async () => {
      prisma.customer.findMany.mockResolvedValue([{ id: "c1", name: "Old KH" }, { id: "c2", name: "Inactive" }]);
      const result = await autoCloseDormantCustomers();
      expect(result.count).toBe(2);
      expect(prisma.customer.updateMany).toHaveBeenCalled();
    });

    test("should return 0 when no dormant customers", async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      const result = await autoCloseDormantCustomers();
      expect(result.count).toBe(0);
    });

    test("should handle errors gracefully", async () => {
      prisma.customer.findMany.mockRejectedValue(new Error("DB Error"));
      const result = await autoCloseDormantCustomers();
      expect(result.success).toBe(false);
    });
  });

  describe("autoArchiveData", () => {
    test("should delete old audit logs and notifications", async () => {
      const result = await autoArchiveData();
      expect(result.auditLogs).toBe(100);
      expect(result.notifications).toBe(50);
      expect(prisma.auditLog.deleteMany).toHaveBeenCalled();
      expect(prisma.notification.deleteMany).toHaveBeenCalled();
    });

    test("should handle errors gracefully", async () => {
      prisma.auditLog.deleteMany.mockRejectedValue(new Error("DB Error"));
      const result = await autoArchiveData();
      expect(result.success).toBe(false);
    });
  });

  describe("weeklyPnLEmail", () => {
    test("should send P&L report to ADMIN/MANAGER", async () => {
      prisma.order.aggregate.mockResolvedValueOnce({ _sum: { total: 50000000 } }).mockResolvedValueOnce({ _sum: { total: 150000000 } });
      prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: 20000000 } });
      prisma.order.count.mockResolvedValue(45);

      const result = await weeklyPnLEmail();
      expect(result.revenue).toBe(50000000);
      expect(result.profit).toBe(30000000);
      expect(notif.notifyRoles).toHaveBeenCalledWith(
        ["ADMIN", "MANAGER"],
        expect.objectContaining({ type: "SYSTEM" })
      );
    });
  });
});

describe("overtime — module", () => {
  let overtimeSvc;
  beforeAll(() => { overtimeSvc = require("../src/modules/hr/overtime.service"); });
  beforeEach(() => { jest.clearAllMocks(); });

  test("create should reject non-existent employee", async () => {
    prisma.employee.findUnique.mockResolvedValue(null);
    await expect(
      overtimeSvc.create("bad-id", "u1", { date: "2026-06-15", hours: 2 })
    ).rejects.toEqual(expect.objectContaining({ status: 404 }));
  });

  test("create should create OT for valid employee", async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: "e1", isActive: true, baseSalary: 5000000,
      user: { fullName: "Test NV" },
    });
    prisma.overtimeRequest.create.mockResolvedValue({ id: "ot1", status: "PENDING", employeeId: "e1" });

    const result = await overtimeSvc.create("e1", "u1", { date: "2026-06-15", hours: 2, reason: "Gap" });
    expect(result.status).toBe("PENDING");
    expect(prisma.overtimeRequest.create).toHaveBeenCalled();
  });

  test("list should filter by date range", async () => {
    prisma.overtimeRequest.findMany.mockResolvedValue([{ id: "ot1" }]);
    const result = await overtimeSvc.list("e1", 6, 2026);
    expect(result).toHaveLength(1);
  });

  test("approve should update status", async () => {
    prisma.overtimeRequest.update.mockResolvedValue({ id: "ot1", status: "APPROVED" });
    const result = await overtimeSvc.approve("ot1", "u1");
    expect(result.status).toBe("APPROVED");
  });
});
