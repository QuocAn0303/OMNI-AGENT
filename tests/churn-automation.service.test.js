/**
 * tests/churn-automation.service.test.js — Test Churn Alert → Voucher (Mục 4)
 *
 * Trọng tâm:
 * - Ngưỡng 0.70 đúng biên (0.699 → không tạo; 0.70 → tạo)
 * - Không tạo trùng alert khi còn PENDING/TRIGGERED
 * - Dedupe mã voucher (không trùng code)
 * - Đóng vòng lặp RETAINED / LOST
 */
const mockClient = {
  churnAlert: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  promotion: { findFirst: jest.fn().mockResolvedValue(null) },
  user: { findFirst: jest.fn().mockResolvedValue({ id: "staff-1" }) },
  customerTask: { create: jest.fn() },
  order: { findFirst: jest.fn().mockResolvedValue(null) },
  tenant: { findMany: jest.fn().mockResolvedValue([]) },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/modules/notifications/notification.service", () => ({
  createOne: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/modules/promotions/promotion.service", () => ({
  create: jest.fn().mockResolvedValue({ id: "promo-1", code: "WINBACK-TEST" }),
}));
jest.mock("../src/config/tenantContext", () => ({
  runWithTenant: jest.fn((tenantId, fn) => fn()),
  getTenantId: jest.fn(() => "tenant-1"),
}));

const service = require("../src/modules/customers/churn-automation.service");
const promotionService = require("../src/modules/promotions/promotion.service");
const notificationService = require("../src/modules/notifications/notification.service");

describe("churn-automation.service — ChurnAlert → Voucher Win-Back (Mục 4)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("riskLevelOf", () => {
    test("0.70–0.85 → HIGH", () => {
      expect(service.riskLevelOf(0.7)).toBe("HIGH");
      expect(service.riskLevelOf(0.85)).toBe("HIGH");
    });

    test("> 0.85 → CRITICAL", () => {
      expect(service.riskLevelOf(0.86)).toBe("CRITICAL");
      expect(service.riskLevelOf(0.99)).toBe("CRITICAL");
    });

    test("ngưỡng mặc định đúng đặc tả 0.70 / 0.85", () => {
      expect(service.CHURN_THRESHOLD).toBe(0.7);
      expect(service.CHURN_CRITICAL_THRESHOLD).toBe(0.85);
    });
  });

  describe("processCustomer — ngưỡng 0.70 đúng biên", () => {
    const customer = (p) => ({ id: "cus-1", name: "Nguyễn Văn A", phone: "0901234567", churnProbability: p });

    test("churnProbability VỪA DƯỚI ngưỡng (0.699) → KHÔNG tạo alert", async () => {
      const res = await service.processCustomer(customer(0.699));
      expect(res).toBeNull();
      expect(mockClient.churnAlert.findFirst).not.toHaveBeenCalled();
      expect(mockClient.churnAlert.create).not.toHaveBeenCalled();
    });

    test("churnProbability ĐÚNG biên 0.70 → tạo alert (>= ngưỡng)", async () => {
      mockClient.churnAlert.findFirst.mockResolvedValue(null);
      mockClient.churnAlert.create.mockResolvedValue({ id: "alert-1", riskLevel: "HIGH" });

      const res = await service.processCustomer(customer(0.7));

      expect(res.created).toBe(true);
      expect(mockClient.churnAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ customerId: "cus-1", riskLevel: "HIGH", churnScore: 0.7, status: "TRIGGERED" }),
      });
    });

    test("churnProbability = null (thiếu dữ liệu) → KHÔNG suy đoán, không tạo alert", async () => {
      const res = await service.processCustomer(customer(null));
      expect(res).toBeNull();
      expect(mockClient.churnAlert.create).not.toHaveBeenCalled();
    });

    test("0.90 (> 0.85) → riskLevel CRITICAL + notification CRITICAL", async () => {
      mockClient.churnAlert.findFirst.mockResolvedValue(null);
      mockClient.churnAlert.create.mockResolvedValue({ id: "alert-2", riskLevel: "CRITICAL" });

      await service.processCustomer(customer(0.9));

      expect(mockClient.churnAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ riskLevel: "CRITICAL" }),
      });
      expect(notificationService.createOne).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "CRITICAL" }),
      );
    });

    test("đã có alert PENDING/TRIGGERED → KHÔNG tạo trùng", async () => {
      const existing = { id: "alert-old", status: "TRIGGERED" };
      mockClient.churnAlert.findFirst.mockResolvedValue(existing);

      const res = await service.processCustomer(customer(0.8));

      expect(res).toEqual({ alert: existing, created: false });
      expect(mockClient.churnAlert.create).not.toHaveBeenCalled();
      expect(promotionService.create).not.toHaveBeenCalled();
    });

    test("tạo đủ bộ: Promotion unique-code + CustomerTask + Notification", async () => {
      mockClient.churnAlert.findFirst.mockResolvedValue(null);
      mockClient.churnAlert.create.mockResolvedValue({ id: "alert-3", riskLevel: "HIGH" });

      await service.processCustomer(customer(0.75), "user-9");

      // TÁI DÙNG Promotion Engine (không tạo hệ thống voucher song song)
      expect(promotionService.create).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "VOUCHER_CODE", type: "PERCENTAGE", usageLimit: 1, perUserLimit: 1 }),
        "user-9",
      );
      // TÁI DÙNG CustomerTask, hạn xử lý 24h
      expect(mockClient.customerTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ customerId: "cus-1", priority: "HIGH", assignedToId: "staff-1" }),
      });
      expect(notificationService.createOne).toHaveBeenCalled();
    });
  });

  describe("generateUniqueVoucherCode — dedupe mã voucher", () => {
    test("sinh mã dạng WINBACK-XXXX, không trùng thì trả luôn", async () => {
      mockClient.promotion.findFirst.mockResolvedValue(null);
      const code = await service.generateUniqueVoucherCode(mockClient);
      expect(code).toMatch(/^WINBACK-[0-9A-F]{8}$/);
      expect(mockClient.promotion.findFirst).toHaveBeenCalledTimes(1);
    });

    test("trùng mã → sinh lại (retry), trả mã không trùng", async () => {
      mockClient.promotion.findFirst
        .mockResolvedValueOnce({ id: "dup-1" })
        .mockResolvedValueOnce({ id: "dup-2" })
        .mockResolvedValueOnce(null);

      const code = await service.generateUniqueVoucherCode(mockClient);

      expect(mockClient.promotion.findFirst).toHaveBeenCalledTimes(3);
      expect(code).toMatch(/^WINBACK-[0-9A-F]{8}$/);
    });

    test("trùng liên tục 5 lần → ném lỗi 500, không tạo voucher trùng", async () => {
      mockClient.promotion.findFirst.mockResolvedValue({ id: "dup" });
      await expect(service.generateUniqueVoucherCode(mockClient)).rejects.toMatchObject({ status: 500 });
      expect(mockClient.promotion.findFirst).toHaveBeenCalledTimes(5);
    });
  });

  describe("checkRetainedForOrder — đóng vòng lặp RETAINED", () => {
    test("đơn dùng đúng voucherCode của alert → RETAINED + resolvedAt", async () => {
      mockClient.churnAlert.findFirst.mockResolvedValue({ id: "alert-9" });
      mockClient.churnAlert.update.mockResolvedValue({ id: "alert-9", status: "RETAINED" });

      const res = await service.checkRetainedForOrder({
        customerId: "cus-1",
        voucherCode: "WINBACK-ABCD1234",
      });

      expect(res.status).toBe("RETAINED");
      const updateArg = mockClient.churnAlert.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: "alert-9" });
      expect(updateArg.data.status).toBe("RETAINED");
      expect(updateArg.data.resolvedAt).toBeInstanceOf(Date);
    });

    test("đơn không có voucherCode → bỏ qua, không truy vấn DB", async () => {
      const res = await service.checkRetainedForOrder({ customerId: "cus-1" });
      expect(res).toBeNull();
      expect(mockClient.churnAlert.findFirst).not.toHaveBeenCalled();
    });

    test("không tìm thấy alert khớp voucher → trả null (không lỗi)", async () => {
      mockClient.churnAlert.findFirst.mockResolvedValue(null);
      const res = await service.checkRetainedForOrder({ customerId: "cus-1", voucherCode: "WINBACK-XXX" });
      expect(res).toBeNull();
      expect(mockClient.churnAlert.update).not.toHaveBeenCalled();
    });

    test("lỗi DB không ném ra luồng order (hook an toàn)", async () => {
      mockClient.churnAlert.findFirst.mockRejectedValue(new Error("db down"));
      await expect(service.checkRetainedForOrder({ customerId: "c", voucherCode: "v" })).resolves.toBeNull();
    });
  });

  describe("closeLoopForTenant — LOST khi quá hạn", () => {
    test("alert quá expiresAt không có đơn mới → LOST", async () => {
      mockClient.churnAlert.findMany.mockResolvedValue([
        {
          id: "alert-lost",
          customerId: "cus-1",
          voucherCode: "WINBACK-OLD",
          expiresAt: new Date(Date.now() - 86_400_000),
          createdAt: new Date(Date.now() - 8 * 86_400_000),
        },
      ]);
      mockClient.order.findFirst.mockResolvedValue(null);
      mockClient.churnAlert.update.mockResolvedValue({});

      const res = await service.closeLoopForTenant(mockClient);

      expect(res.lost).toBe(1);
      expect(res.retained).toBe(0);
      expect(mockClient.churnAlert.update).toHaveBeenCalledWith({
        where: { id: "alert-lost" },
        data: expect.objectContaining({ status: "LOST" }),
      });
    });

    test("alert còn hạn, chưa có đơn → giữ nguyên (không LOST)", async () => {
      mockClient.churnAlert.findMany.mockResolvedValue([
        {
          id: "alert-open",
          customerId: "cus-2",
          voucherCode: "WINBACK-NEW",
          expiresAt: new Date(Date.now() + 5 * 86_400_000),
          createdAt: new Date(),
        },
      ]);
      mockClient.order.findFirst.mockResolvedValue(null);

      const res = await service.closeLoopForTenant(mockClient);

      expect(res.lost).toBe(0);
      expect(res.retained).toBe(0);
      expect(mockClient.churnAlert.update).not.toHaveBeenCalled();
    });
  });
});
