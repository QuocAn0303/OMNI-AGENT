/**
 * tests/crm-stage.test.js — Test cấu hình stage của CRM Sales Pipeline
 *
 * Trọng tâm:
 * - ensureDefaultStages là lazy-seed IDEMPOTENT (chạy lại không tạo trùng).
 * - `create` map 409 khi trùng nhãn trong cùng entityType (unique tenantId+entityType+label).
 * - `remove` chặn khi stage còn lead/deal tham chiếu.
 * - `update` đồng bộ kind/probability xuống deal đang ở stage đó.
 */
const mockClient = {
  crmPipelineStage: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  crmDeal: { updateMany: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/config/tenantContext", () => ({ getTenantId: () => "tenant-1" }));
jest.mock("../src/modules/audit/audit.service", () => ({ log: jest.fn() }));

const stagesService = require("../src/modules/crm/stages.service");

const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

describe("crm/stages.service", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("ensureDefaultStages — lazy-seed idempotent", () => {
    test("gọi createMany với skipDuplicates + đủ 8 stage mặc định", async () => {
      mockClient.crmPipelineStage.createMany.mockResolvedValue({ count: 8 });
      mockClient.crmPipelineStage.findMany.mockResolvedValue([]);

      await stagesService.ensureDefaultStages();

      const arg = mockClient.crmPipelineStage.createMany.mock.calls[0][0];
      expect(arg.skipDuplicates).toBe(true);
      // 3 stage LEAD + 6 stage DEAL (4 ONGOING + Thắng + Thua)
      expect(arg.data).toHaveLength(9);
      expect(arg.data.filter((s) => s.entityType === "LEAD")).toHaveLength(3);
      expect(arg.data.filter((s) => s.entityType === "DEAL")).toHaveLength(6);
      // kind WON/LOST phải tồn tại để kanban có cột Thắng/Thua
      expect(arg.data.filter((s) => s.kind === "WON")).toHaveLength(1);
      expect(arg.data.filter((s) => s.kind === "LOST")).toHaveLength(1);
    });

    test("thiếu tenantId → không query, trả mảng rỗng", async () => {
      expect(await stagesService.ensureDefaultStages(null)).toEqual([]);
      expect(mockClient.crmPipelineStage.createMany).not.toHaveBeenCalled();
    });

    test("P2002 (2 request cùng lúc seed) → nuốt lỗi, không crash", async () => {
      mockClient.crmPipelineStage.createMany.mockRejectedValue(p2002());
      mockClient.crmPipelineStage.findMany.mockResolvedValue([]);
      await expect(stagesService.ensureDefaultStages()).resolves.toBeDefined();
    });

    test("lỗi DB khác → ném ra (không giấu sự cố)", async () => {
      mockClient.crmPipelineStage.createMany.mockRejectedValue(new Error("DB down"));
      mockClient.crmPipelineStage.findMany.mockResolvedValue([]);
      await expect(stagesService.ensureDefaultStages()).rejects.toThrow("DB down");
    });
  });

  describe("create", () => {
    test("tạo stage với default color/kind/probability", async () => {
      mockClient.crmPipelineStage.create.mockResolvedValue({ id: "s1", label: "Đàm phán" });

      const res = await stagesService.create({ entityType: "DEAL", label: "  Đàm phán  " }, "u1");

      const arg = mockClient.crmPipelineStage.create.mock.calls[0][0];
      expect(arg.data.label).toBe("Đàm phán");
      expect(arg.data.color).toBe("#0f766e");
      expect(arg.data.kind).toBe("ONGOING");
      expect(res.id).toBe("s1");
    });

    test("trùng nhãn → 409 với message rõ ràng", async () => {
      mockClient.crmPipelineStage.create.mockRejectedValue(p2002());
      await expect(
        stagesService.create({ entityType: "DEAL", label: "Mới" }, "u1"),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("remove", () => {
    test("còn deal ở stage → 409, không xóa", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "s1", label: "Mới", entityType: "DEAL", _count: { leads: 0, deals: 3 },
      });
      await expect(stagesService.remove("s1", "u1")).rejects.toMatchObject({ status: 409 });
      expect(mockClient.crmPipelineStage.delete).not.toHaveBeenCalled();
    });

    test("còn lead ở stage → 409", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "s2", label: "Mới", entityType: "LEAD", _count: { leads: 5, deals: 0 },
      });
      await expect(stagesService.remove("s2", "u1")).rejects.toMatchObject({ status: 409 });
    });

    test("không còn tham chiếu → xóa thật", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "s3", label: "Cũ", entityType: "DEAL", _count: { leads: 0, deals: 0 },
      });
      mockClient.crmPipelineStage.delete.mockResolvedValue({});

      const res = await stagesService.remove("s3", "u1");
      expect(res).toEqual({ id: "s3" });
      expect(mockClient.crmPipelineStage.delete).toHaveBeenCalledWith({ where: { id: "s3" } });
    });

    test("stage không tồn tại → 404", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue(null);
      await expect(stagesService.remove("nope", "u1")).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("update — đồng bộ deal", () => {
    test("đổi probability → chỉ cập nhật deal ONGOING", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "s1", label: "Mới", entityType: "DEAL", kind: "ONGOING", probability: 10,
      });
      mockClient.crmPipelineStage.update.mockResolvedValue({ id: "s1", probability: 40 });
      mockClient.crmDeal.updateMany.mockResolvedValue({ count: 2 });

      await stagesService.update("s1", { probability: 40 }, "u1");

      const arg = mockClient.crmDeal.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ stageId: "s1", kind: "ONGOING" });
      expect(arg.data).toEqual({ probability: 40 });
    });

    test("đổi kind → áp cho MỌI deal ở stage đó (kể cả đã đóng)", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "s1", label: "Thắng", entityType: "DEAL", kind: "ONGOING", probability: 10,
      });
      mockClient.crmPipelineStage.update.mockResolvedValue({ id: "s1", kind: "WON" });
      mockClient.crmDeal.updateMany.mockResolvedValue({ count: 4 });

      await stagesService.update("s1", { kind: "WON" }, "u1");

      const arg = mockClient.crmDeal.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ stageId: "s1" });
      expect(arg.data).toEqual({ kind: "WON" });
    });

    test("đổi label của stage LEAD → không đụng deal", async () => {
      mockClient.crmPipelineStage.findUnique.mockResolvedValue({
        id: "s2", label: "Mới", entityType: "LEAD", kind: "ONGOING", probability: 10,
      });
      mockClient.crmPipelineStage.update.mockResolvedValue({ id: "s2", label: "Lead mới" });

      await stagesService.update("s2", { label: "Lead mới" }, "u1");
      expect(mockClient.crmDeal.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("firstOngoingStage", () => {
    test("lấy stage ONGOING đầu tiên theo sortOrder", async () => {
      mockClient.crmPipelineStage.findMany.mockResolvedValue([{ id: "s1", label: "Mới" }]);
      const res = await stagesService.firstOngoingStage("DEAL");
      expect(res.id).toBe("s1");
      const arg = mockClient.crmPipelineStage.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ entityType: "DEAL", kind: "ONGOING", isActive: true });
      expect(arg.orderBy).toEqual([{ sortOrder: "asc" }, { createdAt: "asc" }]);
      expect(arg.take).toBe(1);
    });

    test("tenant chưa có stage nào → null", async () => {
      mockClient.crmPipelineStage.findMany.mockResolvedValue([]);
      expect(await stagesService.firstOngoingStage("LEAD")).toBeNull();
    });
  });
});
