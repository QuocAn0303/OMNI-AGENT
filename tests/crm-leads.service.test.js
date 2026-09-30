/**
 * tests/crm-leads.service.test.js — Test nghiệp vụ Lead của CRM Sales Pipeline
 *
 * Trọng tâm:
 * - Record-level permission: CASHIER chỉ thấy lead mình phụ trách; ADMIN/MANAGER
 *   thấy tất cả. Đây là khác biệt lớn nhất so với bảng `Customer` (CASHIER thấy
 *   toàn bộ khách hàng của tenant).
 * - `changeStage`: chặn lead đã convert, set lastContactedAt khi đổi trạng thái.
 * - `remove`: chặn lead đã convert, xóa luôn timeline.
 * - `importList`: dedupe theo SĐT/email (cả trong DB lẫn trong cùng lô).
 */
const mockClient = {
  crmLead: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    groupBy: jest.fn(),
  },
  crmContact: { findMany: jest.fn() },
  crmCommunication: { create: jest.fn(), deleteMany: jest.fn() },
  crmPipelineStage: { findMany: jest.fn(), findUnique: jest.fn() },
  user: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));
jest.mock("../src/modules/notifications/notification.service", () => ({ createOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/modules/crm/communication.service", () => ({
  logSystemEvent: jest.fn().mockResolvedValue({}),
  create: jest.fn(),
  remove: jest.fn(),
  listTimeline: jest.fn(),
}));
jest.mock("../src/modules/crm/stages.service", () => ({
  ensureDefaultStages: jest.fn().mockResolvedValue([]),
  firstOngoingStage: jest.fn(),
  list: jest.fn(),
}));

const leadsService = require("../src/modules/crm/leads.service");

const CASHIER = { id: "u-cashier", role: "CASHIER" };
const MANAGER = { id: "u-manager", role: "MANAGER" };

const baseLead = (over = {}) => ({
  id: "lead-1",
  leadName: "Nguyễn Văn A",
  email: "a@example.com",
  mobileNo: "0901234567",
  status: "NEW",
  stageId: "stage-1",
  leadOwnerId: "u-cashier",
  organizationId: null,
  contactId: null,
  expectedValue: 1000000,
  convertedAt: null,
  convertedDealId: null,
  lastContactedAt: null,
  stage: { id: "stage-1", label: "Mới" },
  ...over,
});

describe("crm/leads.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.crmLead.findMany.mockResolvedValue([]);
    mockClient.crmLead.count = jest.fn().mockResolvedValue(0);
    mockClient.$transaction.mockImplementation(async (arg) => (typeof arg === "function" ? arg(mockClient) : arg));
  });

  describe("list — record-level permission theo owner", () => {
    test("CASHIER → ép where.leadOwnerId = user.id", async () => {
      await leadsService.list({ page: 1, limit: 10 }, CASHIER);
      const arg = mockClient.crmLead.findMany.mock.calls[0][0];
      expect(arg.where.leadOwnerId).toBe("u-cashier");
    });

    test("MANAGER → không giới hạn owner", async () => {
      await leadsService.list({}, MANAGER);
      const arg = mockClient.crmLead.findMany.mock.calls[0][0];
      expect(arg.where.leadOwnerId).toBeUndefined();
    });

    test("CASHIER truyền leadOwnerId của người khác → vẫn ép về chính mình", async () => {
      await leadsService.list({ leadOwnerId: "u-other" }, CASHIER);
      const arg = mockClient.crmLead.findMany.mock.calls[0][0];
      // ownerScope ghi đè sau → không rò lead của người khác
      expect(arg.where.leadOwnerId).toBe("u-cashier");
    });

    test("filter overdue → lastContactedAt cũ hơn 7 ngày + loại DEAD/CONVERTED", async () => {
      await leadsService.list({ overdue: "1" }, MANAGER);
      const arg = mockClient.crmLead.findMany.mock.calls[0][0];
      expect(arg.where.status).toEqual({ in: ["NEW", "CONTACTED", "QUALIFIED"] });
      const cutoff = arg.where.lastContactedAt.lt.getTime();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(cutoff - sevenDaysAgo)).toBeLessThan(2000);
    });

    test("search → OR trên leadName/email/mobileNo/jobTitle", async () => {
      await leadsService.list({ search: "abc" }, MANAGER);
      const arg = mockClient.crmLead.findMany.mock.calls[0][0];
      expect(arg.where.OR).toHaveLength(4);
    });
  });

  describe("getById", () => {
    test("CASHIER đọc lead của người khác → 403", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(baseLead({ leadOwnerId: "u-other" }));
      await expect(leadsService.getById("lead-1", CASHIER)).rejects.toMatchObject({ status: 403 });
    });

    test("CASHIER đọc lead của mình → OK", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(baseLead());
      const res = await leadsService.getById("lead-1", CASHIER);
      expect(res.id).toBe("lead-1");
    });

    test("lead không tồn tại → 404", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(null);
      await expect(leadsService.getById("nope", MANAGER)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("changeStage", () => {
    test("đổi stage ghi system event + audit", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(baseLead());
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "stage-2", entityType: "LEAD", label: "Đã liên hệ", kind: "ONGOING", probability: 25,
      });
      mockClient.crmLead.update.mockResolvedValue(baseLead({ stageId: "stage-2", stage: { label: "Đã liên hệ" } }));

      const res = await leadsService.changeStage("lead-1", { stageId: "stage-2" }, "u-cashier", CASHIER);

      expect(res.lead.stageId).toBe("stage-2");
      const commService = require("../src/modules/crm/communication.service");
      expect(commService.logSystemEvent).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: "lead-1", createdById: "u-cashier" }),
      );
    });

    test("dùng stage của Deal → 400", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(baseLead());
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "stage-x", entityType: "DEAL", label: "Đàm phán", kind: "ONGOING", probability: 75,
      });
      await expect(
        leadsService.changeStage("lead-1", { stageId: "stage-x" }, "u1", MANAGER),
      ).rejects.toMatchObject({ status: 400 });
    });

    test("lead đã CONVERTED → 409, không cho đổi stage", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(baseLead({ status: "CONVERTED", convertedDealId: "deal-1" }));
      await expect(
        leadsService.changeStage("lead-1", { stageId: "stage-2" }, "u1", MANAGER),
      ).rejects.toMatchObject({ status: 409 });
      expect(mockClient.crmLead.update).not.toHaveBeenCalled();
    });

    test("đổi status CONTACTED → tự set lastContactedAt = now", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue(baseLead());
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      mockClient.crmLead.update.mockResolvedValue(baseLead({ status: "CONTACTED" }));

      await leadsService.changeStage("lead-1", { stageId: null, status: "CONTACTED" }, "u1", MANAGER);

      const arg = mockClient.crmLead.update.mock.calls[0][0];
      expect(arg.data.lastContactedAt).toBeInstanceOf(Date);
    });
  });

  describe("remove", () => {
    test("lead đã convert → 409, giữ dữ liệu pipeline", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue({
        id: "lead-1", leadName: "A", status: "CONVERTED", convertedDealId: "deal-1", leadOwnerId: "u1",
        _count: { deals: 1 },
      });
      await expect(leadsService.remove("lead-1", "u1", MANAGER)).rejects.toMatchObject({ status: 409 });
      expect(mockClient.crmLead.delete).not.toHaveBeenCalled();
    });

    test("lead thường → xóa cả timeline trong transaction", async () => {
      mockClient.crmLead.findUnique.mockResolvedValue({
        id: "lead-1", leadName: "A", status: "NEW", convertedDealId: null, leadOwnerId: "u1",
        _count: { deals: 0 },
      });
      const res = await leadsService.remove("lead-1", "u1", MANAGER);
      expect(res).toEqual({ id: "lead-1" });
      expect(mockClient.crmCommunication.deleteMany).toHaveBeenCalledWith({ where: { leadId: "lead-1" } });
      expect(mockClient.crmLead.delete).toHaveBeenCalledWith({ where: { id: "lead-1" } });
    });
  });

  describe("create", () => {
    test("CASHIER tạo lead không chỉ định owner → tự gán cho mình", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      mockClient.crmLead.create.mockResolvedValue(baseLead());

      await leadsService.create({ leadName: "Nguyễn Văn A" }, "u-cashier", CASHIER);
      expect(mockClient.crmLead.create.mock.calls[0][0].data.leadOwnerId).toBe("u-cashier");
    });

    test("MANAGER tạo lead không chỉ định owner → để trống (giao sau)", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      mockClient.crmLead.create.mockResolvedValue(baseLead({ leadOwnerId: null }));

      await leadsService.create({ leadName: "A" }, "u-manager", MANAGER);
      expect(mockClient.crmLead.create.mock.calls[0][0].data.leadOwnerId).toBeNull();
    });
  });

  describe("importList", () => {
    test("bỏ qua lead trùng SĐT trong DB", async () => {
      mockClient.crmLead.findMany.mockResolvedValue([{ mobileNo: "0901234567", email: "x@y.com" }]);
      mockClient.crmContact.findMany.mockResolvedValue([]);
      mockClient.crmLead.createMany.mockResolvedValue({ count: 1 });

      const res = await leadsService.importList(
        [
          { leadName: "Trùng", mobileNo: "0901234567" },
          { leadName: "Mới", mobileNo: "0999888777" },
        ],
        "u1",
      );

      expect(res.createdCount).toBe(1);
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0].reason).toContain("0901234567");
      const created = mockClient.crmLead.createMany.mock.calls[0][0].data;
      expect(created).toHaveLength(1);
      expect(created[0].leadName).toBe("Mới");
    });

    test("bỏ qua trùng SĐT với Contact đã có (tránh tạo trùng người)", async () => {
      mockClient.crmLead.findMany.mockResolvedValue([]);
      mockClient.crmContact.findMany.mockResolvedValue([{ phone: "0901234567", email: null }]);
      mockClient.crmLead.createMany.mockResolvedValue({ count: 0 });

      const res = await leadsService.importList([{ leadName: "A", mobileNo: "0901234567" }], "u1");
      expect(res.createdCount).toBe(0);
      expect(res.skipped).toHaveLength(1);
    });

    test("bỏ qua trùng trong CHÍNH lô nhập (2 dòng cùng SĐT)", async () => {
      mockClient.crmLead.findMany.mockResolvedValue([]);
      mockClient.crmContact.findMany.mockResolvedValue([]);
      mockClient.crmLead.createMany.mockResolvedValue({ count: 1 });

      const res = await leadsService.importList(
        [{ leadName: "A", mobileNo: "0901234567" }, { leadName: "B", mobileNo: "0901234567" }],
        "u1",
      );
      expect(res.createdCount).toBe(1);
      expect(res.skipped).toHaveLength(1);
    });

    test("dòng thiếu cả SĐT lẫn email → bỏ qua với lý do rõ ràng", async () => {
      mockClient.crmLead.findMany.mockResolvedValue([]);
      mockClient.crmContact.findMany.mockResolvedValue([]);
      mockClient.crmLead.createMany.mockResolvedValue({ count: 0 });

      const res = await leadsService.importList([{ leadName: "A" }], "u1");
      expect(res.skipped[0].reason).toContain("SĐT");
    });

    test("danh sách rỗng → 400", async () => {
      await expect(leadsService.importList([], "u1")).rejects.toMatchObject({ status: 400 });
    });
  });
});
