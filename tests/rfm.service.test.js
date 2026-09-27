/**
 * tests/rfm.service.test.js — Test phân khúc RFM động (Mục 3.2 đặc tả CRM/SRM)
 *
 * Trọng tâm:
 * - Công thức R/F/M từ đơn COMPLETED 12 tháng (mock order.aggregate).
 * - Quintile theo rank (hoạt động cả khi tenant < 5 khách).
 * - deriveSegment trả đúng 5 nhãn: Champions / Loyal / Potential / At-Risk / Hibernating.
 * - Hook onOrderCompletedForCustomer KHÔNG ném lỗi ra luồng order.
 */
const mockClient = {
  order: { aggregate: jest.fn(), groupBy: jest.fn() },
  customer: { update: jest.fn(), findMany: jest.fn() },
  tenant: { findMany: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const rfm = require("../src/modules/customers/rfm.service");

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

describe("rfm.service — RFM động (Mục 3.2)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("quintileOf — xếp hạng theo rank", () => {
    const asc = [1, 2, 3, 4, 5]; // 5 phần tử

    test("giá trị nhỏ nhất → điểm 1", () => {
      expect(rfm.quintileOf(1, asc)).toBe(1);
    });

    test("giá trị lớn nhất → điểm 5", () => {
      expect(rfm.quintileOf(5, asc)).toBe(5);
    });

    test("điểm luôn nằm trong khoảng 1..5 với mọi giá trị", () => {
      for (const v of [0, 1, 2.5, 3, 4, 5, 100]) {
        const q = rfm.quintileOf(v, asc);
        expect(q).toBeGreaterThanOrEqual(1);
        expect(q).toBeLessThanOrEqual(5);
      }
    });

    test("tập rỗng → điểm trung tính 3 (không đủ dữ liệu so sánh)", () => {
      expect(rfm.quintileOf(10, [])).toBe(3);
    });

    test("tenant nhỏ (1 khách) vẫn trả điểm hợp lệ", () => {
      expect(rfm.quintileOf(7, [7])).toBe(5);
    });
  });

  describe("deriveSegment — 5 nhãn phân khúc", () => {
    test("R cao + F cao → Champions", () => {
      expect(rfm.deriveSegment(5, 5, 3)).toBe("Champions");
    });

    test("F cao nhưng R thấp → Loyal", () => {
      expect(rfm.deriveSegment(2, 5, 1)).toBe("Loyal");
    });

    test("M cao, F thấp → Potential", () => {
      expect(rfm.deriveSegment(2, 2, 5)).toBe("Potential");
    });

    test("R vừa + F vừa → Potential", () => {
      expect(rfm.deriveSegment(3, 3, 1)).toBe("Potential");
    });

    test("R thấp, không nổi bật F/M → At-Risk", () => {
      expect(rfm.deriveSegment(2, 2, 2)).toBe("At-Risk");
    });

    test("R trung bình, F thấp → Hibernating", () => {
      expect(rfm.deriveSegment(3, 1, 1)).toBe("Hibernating");
    });
  });

  describe("recalcMetricsForCustomer — công thức R/F/M", () => {
    test("tính đúng Frequency / Monetary / RecencyDays từ aggregate", async () => {
      mockClient.order.aggregate.mockResolvedValue({
        _count: { _all: 4 },
        _sum: { total: 4_000_000 },
        _max: { createdAt: daysAgo(3) },
      });
      mockClient.customer.update.mockResolvedValue({});

      const res = await rfm.recalcMetricsForCustomer("c1");

      expect(res.frequency).toBe(4);
      expect(res.monetary).toBe(4_000_000);
      expect(res.recencyDays).toBe(3);

      const data = mockClient.customer.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ rfmFrequency: 4, rfmMonetary: 4_000_000, rfmRecencyDays: 3 });
      expect(data.rfmScoredAt).toBeInstanceOf(Date);

      // chỉ tính đơn COMPLETED trong 12 tháng gần nhất
      const where = mockClient.order.aggregate.mock.calls[0][0].where;
      expect(where).toMatchObject({ customerId: "c1", status: "COMPLETED" });
      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });

    test("khách chưa có đơn COMPLETED → F=0, M=0, recencyDays=null (không suy đoán)", async () => {
      mockClient.order.aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { total: null },
        _max: { createdAt: null },
      });
      mockClient.customer.update.mockResolvedValue({});

      const res = await rfm.recalcMetricsForCustomer("c2");

      expect(res).toEqual({ frequency: 0, monetary: 0, recencyDays: null });
      expect(mockClient.customer.update.mock.calls[0][0].data.rfmRecencyDays).toBeNull();
    });

    test("customerId rỗng → trả null, không query DB", async () => {
      expect(await rfm.recalcMetricsForCustomer(null)).toBeNull();
      expect(mockClient.order.aggregate).not.toHaveBeenCalled();
    });

    test("truyền client (tx) → dùng đúng client được inject", async () => {
      const tx = {
        order: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 1 }, _sum: { total: 100 }, _max: { createdAt: daysAgo(1) } }) },
        customer: { update: jest.fn().mockResolvedValue({}) },
      };
      await rfm.recalcMetricsForCustomer("c3", tx);
      expect(tx.order.aggregate).toHaveBeenCalled();
      expect(mockClient.order.aggregate).not.toHaveBeenCalled();
    });
  });

  describe("scoreTenantSegments — xếp hạng theo ngũ phân vị trong tenant", () => {
    test("chấm segment cho toàn bộ customer có R/F/M", async () => {
      // Fixture 5 khách để quintile có đủ độ phân giải:
      // a tốt nhất mọi chiều (R/F/M cao nhất) → Champions;
      // e tệ nhất mọi chiều → At-Risk
      mockClient.customer.findMany.mockResolvedValue([
        { id: "a", rfmRecencyDays: 1, rfmFrequency: 20, rfmMonetary: 20_000_000 },
        { id: "b", rfmRecencyDays: 5, rfmFrequency: 15, rfmMonetary: 15_000_000 },
        { id: "c", rfmRecencyDays: 30, rfmFrequency: 8, rfmMonetary: 8_000_000 },
        { id: "d", rfmRecencyDays: 90, rfmFrequency: 3, rfmMonetary: 3_000_000 },
        { id: "e", rfmRecencyDays: 200, rfmFrequency: 1, rfmMonetary: 100_000 },
      ]);
      mockClient.customer.update.mockResolvedValue({});

      const res = await rfm.scoreTenantSegments();

      expect(res.scored).toBe(5);
      expect(mockClient.customer.update).toHaveBeenCalledTimes(5);
      // khách a mua gần đây + thường xuyên + giá trị cao → Champions
      expect(mockClient.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "a" }, data: { rfmSegment: "Champions" } }),
      );
      // khách e tệ nhất mọi chiều → At-Risk
      expect(mockClient.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "e" }, data: { rfmSegment: "At-Risk" } }),
      );
    });

    test("tenant không có customer nào → scored = 0", async () => {
      mockClient.customer.findMany.mockResolvedValue([]);
      expect(await rfm.scoreTenantSegments()).toEqual({ scored: 0 });
      expect(mockClient.customer.update).not.toHaveBeenCalled();
    });
  });

  describe("runForTenant — cron hàng đêm", () => {
    test("ghi R/F/M theo groupBy rồi chấm segment", async () => {
      mockClient.order.groupBy.mockResolvedValue([
        { customerId: "c1", _count: { _all: 3 }, _sum: { total: 900_000 }, _max: { createdAt: daysAgo(5) } },
      ]);
      mockClient.customer.update.mockResolvedValue({});
      mockClient.customer.findMany.mockResolvedValue([
        { id: "c1", rfmRecencyDays: 5, rfmFrequency: 3, rfmMonetary: 900_000 },
      ]);

      const res = await rfm.runForTenant();

      expect(res.customers).toBe(1);
      expect(res.scored).toBe(1);
      const data = mockClient.customer.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ rfmFrequency: 3, rfmMonetary: 900_000, rfmRecencyDays: 5 });
    });
  });

  describe("onOrderCompletedForCustomer — hook fire-and-forget", () => {
    test("luôn resolve (không ném lỗi) kể cả khi DB lỗi", async () => {
      mockClient.order.aggregate.mockRejectedValue(new Error("DB down"));
      await expect(rfm.onOrderCompletedForCustomer("c1")).resolves.toBeNull();
    });

    test("customerId rỗng → null, không query", async () => {
      expect(await rfm.onOrderCompletedForCustomer(null)).toBeNull();
      expect(mockClient.order.aggregate).not.toHaveBeenCalled();
    });
  });
});
