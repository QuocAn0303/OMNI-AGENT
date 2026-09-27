/**
 * tests/lead-capture.service.test.js — Test Webhook Lead Capture (Mục 2)
 *
 * Trọng tâm:
 * - X-Tenant-Key → resolveTenant → tenantId.
 * - Round-robin chọn assignee và cập nhật cursor.
 * - Idempotent: KH mới → tạo Customer; KH cũ → tạo CustomerNote.
 * - Notification cho assignee.
 * - generateApiKey: rotate (xoá key cũ) + tạo key mới.
 */
const crypto = require("crypto");
const mockClient = {
  integrationConfig: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  customerNote: { create: jest.fn() },
  user: { findMany: jest.fn() },
  companySettings: { findFirst: jest.fn(), update: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../src/modules/notifications/notification.service", () => ({
  createOne: jest.fn().mockResolvedValue({}),
}));

const service = require("../src/modules/crm/lead-capture.service");

describe("lead-capture.service — Webhook Lead (Mục 2)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("maskKey", () => {
    test("mask đúng format ABCDEF••••1234", () => {
      const key = service.maskKey("abcdefgh1234567890");
      expect(key).toMatch(/^.{6}••••.{4}$/);
    });

        test("key rỗng/undefined → null", () => {
      expect(service.maskKey(null)).toBeNull();
      expect(service.maskKey(undefined)).toBeNull();
      expect(service.maskKey("")).toBeNull();
    });
  });

  describe("resolveTenant — X-Tenant-Key → tenantId", () => {
    test("key hợp lệ → trả tenantId", async () => {
      mockClient.integrationConfig.findUnique.mockResolvedValue({ tenantId: "tenant-1" });
      const result = await service.resolveTenant("validkey123");
      expect(result).toBe("tenant-1");
      expect(mockClient.integrationConfig.findUnique).toHaveBeenCalledWith({
        where: { key: `LEAD_WEBHOOK:validkey123` },
        select: { tenantId: true },
      });
    });

    test("key không hợp lệ → null", async () => {
      mockClient.integrationConfig.findUnique.mockResolvedValue(null);
      expect(await service.resolveTenant("badkey")).toBeNull();
    });

    test("api key rỗng → null (không query)", async () => {
      const result = await service.resolveTenant("");
      expect(result).toBeNull();
      expect(mockClient.integrationConfig.findUnique).not.toHaveBeenCalled();
    });

    test("api key undefined → null", async () => {
      expect(await service.resolveTenant(undefined)).toBeNull();
    });
  });

  describe("captureLead — idempotent theo (phone, tenantId)", () => {
    const payload = { source: "Facebook_form", fullName: "Nguyễn Văn A", phone: "0901234567" };

    test("KH chưa có → tạo Customer + note + notification", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
      mockClient.companySettings.findFirst.mockResolvedValue({ id: "cs-1", leadRoundRobinCursor: 0 });
      mockClient.companySettings.update.mockResolvedValue({});
      mockClient.customer.findFirst.mockResolvedValue(null);
      mockClient.customer.create.mockResolvedValue({ id: "cus-new" });
      mockClient.customerNote.create.mockResolvedValue({});

      const res = await service.captureLead("tenant-1", payload);

      expect(res.customerId).toBe("cus-new");
      expect(res.isNew).toBe(true);
      expect(res.assignedToId).toBe("staff-1");
      // KH mới: note được nhúng trong customer.create (nested notes.create)
      expect(mockClient.customer.create).toHaveBeenCalled();
      const createArg = mockClient.customer.create.mock.calls[0][0];
      expect(createArg.data.leadStatus).toBe("NEW");
      expect(createArg.data.referralSource).toBe("Facebook_form");
      expect(createArg.data.notes.create.type).toBe("NOTE");
      expect(mockClient.customerNote.create).not.toHaveBeenCalled();
    });

    test("KH đã có → KHÔNG tạo customer mới, chỉ tạo note ghi nguồn", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
      mockClient.companySettings.findFirst.mockResolvedValue({ id: "cs-1", leadRoundRobinCursor: 0 });
      mockClient.customer.findFirst.mockResolvedValue({ id: "cus-existing", name: "Nguyễn Văn A" });
      mockClient.customer.create.mockResolvedValue({ id: "cus-new" });

      const res = await service.captureLead("tenant-1", payload);

      expect(res.isNew).toBe(false);
      expect(res.customerId).toBe("cus-existing");
      expect(mockClient.customer.create).not.toHaveBeenCalled();
      expect(mockClient.customerNote.create).toHaveBeenCalled();
    });

    test("cursor round-robin tăng dần", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
      mockClient.companySettings.findFirst.mockResolvedValue({ id: "cs-1", leadRoundRobinCursor: 2 });
      mockClient.customer.findFirst.mockResolvedValue(null);
      mockClient.customer.create.mockResolvedValue({ id: "cus" });

      await service.captureLead("tenant-1", payload);

      const updateArg = mockClient.companySettings.update.mock.calls[0][0];
      expect(updateArg.data.leadRoundRobinCursor).toBe(0);
    });
  });

  describe("generateApiKey — rotate key", () => {
    test("xoá key cũ trước khi tạo mới", async () => {
      mockClient.integrationConfig.deleteMany.mockResolvedValue({ count: 1 });
      mockClient.integrationConfig.create.mockResolvedValue({ key: "LEAD_WEBHOOK:newkey" });

      const res = await service.generateApiKey("tenant-1", "admin-1");
      // apiKey trả về dạng raw hex (48 ký tự); tiền tố LEAD_WEBHOOK: chỉ lưu trong DB
      expect(res.apiKey).toMatch(/^([a-f0-9]{48})$/);
      expect(res.maskedKey).toMatch(/^.{6}••••.{4}$/);
      expect(mockClient.integrationConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            key: expect.stringMatching(/^LEAD_WEBHOOK:[a-f0-9]{48}$/),
          }),
        }),
      );
      expect(mockClient.integrationConfig.deleteMany).toHaveBeenCalledWith({
        where: { key: { startsWith: "LEAD_WEBHOOK:" }, tenantId: "tenant-1" },
      });
    });

    test("thiếu tenantId → lỗi 400", async () => {
      await expect(service.generateApiKey(null)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("listApiKey — trả key đã mask", () => {
    test("liệt kê key active của tenant", async () => {
      mockClient.integrationConfig.findMany.mockResolvedValue([
        { key: "LEAD_WEBHOOK:abcdef1234567890", updatedAt: new Date() },
      ]);
      const res = await service.listApiKey("tenant-1");
      expect(res).toHaveLength(1);
      expect(res[0].maskedKey).toMatch(/^.{6}••••.{4}$/);
    });

    test("không có key → mảng rỗng", async () => {
      mockClient.integrationConfig.findMany.mockResolvedValue([]);
      expect(await service.listApiKey("tenant-1")).toEqual([]);
    });
  });

  describe("captureLead — Idempotency-Key (webhook retry an toàn)", () => {
    const payload = { source: "Shopee", fullName: "Lê Văn C", phone: "0987654321" };
    const IDEM_KEY = "wh-evt-abc-12345";

    // resolveTenant cũng dùng integrationConfig.findUnique → mock theo prefix key
    const mockIdemStore = (leadRow) => {
      mockClient.integrationConfig.findUnique.mockImplementation(({ where }) => {
        if (where.key.startsWith("LEAD_IDEMP:")) return Promise.resolve(leadRow);
        return Promise.resolve(null);
      });
    };

    test("key mới → xử lý lead + upsert kết quả (category LEAD_IDEMPOTENCY)", async () => {
      mockIdemStore(null);
      mockClient.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
      mockClient.companySettings.findFirst.mockResolvedValue({ id: "cs-1", leadRoundRobinCursor: 0 });
      mockClient.customer.findFirst.mockResolvedValue(null);
      mockClient.customer.create.mockResolvedValue({ id: "cus-idem" });
      mockClient.integrationConfig.upsert.mockResolvedValue({});

      const res = await service.captureLead("tenant-1", payload, IDEM_KEY);

      expect(res.customerId).toBe("cus-idem");
      expect(res.duplicate).toBeUndefined();
      expect(mockClient.integrationConfig.upsert).toHaveBeenCalledTimes(1);
      const arg = mockClient.integrationConfig.upsert.mock.calls[0][0];
      expect(arg.where.key).toMatch(/^LEAD_IDEMP:[a-f0-9]{64}$/);
      expect(arg.create.category).toBe("LEAD_IDEMPOTENCY");
      expect(arg.create.tenantId).toBe("tenant-1");
      expect(JSON.parse(arg.create.valueEnc).customerId).toBe("cus-idem");
    });

    test("key trùng trong TTL (24h) → trả kết quả cũ, KHÔNG tạo customer", async () => {
      mockIdemStore({
        valueEnc: JSON.stringify({ customerId: "cus-old", isNew: true, assignedToId: "staff-1" }),
        createdAt: new Date(),
      });

      const res = await service.captureLead("tenant-1", payload, IDEM_KEY);

      expect(res.duplicate).toBe(true);
      expect(res.customerId).toBe("cus-old");
      expect(mockClient.customer.create).not.toHaveBeenCalled();
      expect(mockClient.integrationConfig.upsert).not.toHaveBeenCalled();
    });

    test("key quá TTL (25h) → xử lý lại + upsert reset TTL", async () => {
      mockIdemStore({
        valueEnc: JSON.stringify({ customerId: "cus-old" }),
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      mockClient.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
      mockClient.companySettings.findFirst.mockResolvedValue(null);
      mockClient.customer.findFirst.mockResolvedValue({ id: "cus-existing", name: "Lê Văn C" });
      mockClient.customerNote.create.mockResolvedValue({});
      mockClient.integrationConfig.upsert.mockResolvedValue({});

      const res = await service.captureLead("tenant-1", payload, IDEM_KEY);

      expect(res.duplicate).toBeUndefined();
      expect(mockClient.customerNote.create).toHaveBeenCalled();
      const arg = mockClient.integrationConfig.upsert.mock.calls[0][0];
      expect(arg.update.createdAt).toBeInstanceOf(Date);
    });

    test("key quá ngắn (<8 ký tự) → bỏ qua idempotency, xử lý bình thường", async () => {
      mockClient.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
      mockClient.companySettings.findFirst.mockResolvedValue(null);
      mockClient.customer.findFirst.mockResolvedValue(null);
      mockClient.customer.create.mockResolvedValue({ id: "cus-x" });

      const res = await service.captureLead("tenant-1", payload, "short");

      expect(res.customerId).toBe("cus-x");
      expect(mockClient.integrationConfig.upsert).not.toHaveBeenCalled();
      // không có lần findUnique nào cho LEAD_IDEMP:
      const idemCalls = mockClient.integrationConfig.findUnique.mock.calls
        .filter(([a]) => String(a?.where?.key).startsWith("LEAD_IDEMP:"));
      expect(idemCalls).toHaveLength(0);
    });

    test("lưu idempotency lỗi (DB) → response vẫn thành công", async () => {
      mockIdemStore(null);
      mockClient.user.findMany.mockResolvedValue([{ id: "staff-1" }]);
      mockClient.companySettings.findFirst.mockResolvedValue(null);
      mockClient.customer.findFirst.mockResolvedValue(null);
      mockClient.customer.create.mockResolvedValue({ id: "cus-ok" });
      mockClient.integrationConfig.upsert.mockRejectedValue(new Error("DB down"));

      const res = await service.captureLead("tenant-1", payload, IDEM_KEY);
      expect(res.customerId).toBe("cus-ok");
    });
  });
});

