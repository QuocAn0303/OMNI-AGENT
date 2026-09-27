/**
 * tests/clv-forecast.service.test.js — Test CLV/Churn dự báo (Mục 3.3)
 *
 * Trọng tâm:
 * - Công thức BG/NBD gần đúng: p_alive giảm theo inactivity, CLV = AOV × expectedOrders × p_alive.
 * - Fallback bắt buộc: < 2 đơn COMPLETED → churnProbability/clvPredicted = null.
 * - churnProbability nằm trong [0, 1].
 * - Hook fire-and-forget trên order.completed — fire-and-forget, fire-and-forget.
 */
const clv = require("../src/modules/customers/clv-forecast.service");

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

describe("clv-forecast.service — BG/NBD + Gamma-Gamma (Mục 3.3)", () => {
  describe("forecastCustomer — công thức thuần", () => {
    test("fallback: < 2 đơn COMPLETED → null (không suy đoán bừa)", () => {
      const res = clv.forecastCustomer({ orders: [{ status: "COMPLETED", createdAt: daysAgo(5), total: 100_000 }] });
      expect(res.clvPredicted).toBeNull();
      expect(res.churnProbability).toBeNull();
      expect(res.insufficientData).toBe(true);
    });

    test("0 đơn → null", () => {
      const res = clv.forecastCustomer({ orders: [] });
      expect(res.clvPredicted).toBeNull();
      expect(res.churnProbability).toBeNull();
      expect(res.insufficientData).toBe(true);
    });

    test("chỉ đếm đơn COMPLETED (loại trừ PENDING/CANCELLED)", () => {
      const res = clv.forecastCustomer({
        orders: [
          { status: "COMPLETED", createdAt: daysAgo(20), total: 100_000 },
          { status: "CANCELLED", createdAt: daysAgo(15), total: 50_000 },
          { status: "PENDING", createdAt: daysAgo(10), total: 70_000 },
        ],
      });
      expect(res.insufficientData).toBe(true); // chỉ có 1 COMPLETED
    });

    test("2+ đơn COMPLETED → tính CLV + churn", () => {
      const now = new Date();
      const res = clv.forecastCustomer({
        orders: [
          { status: "COMPLETED", createdAt: new Date(now.getTime() - 40 * 86_400_000), total: 1_000_000 },
          { status: "COMPLETED", createdAt: new Date(now.getTime() - 10 * 86_400_000), total: 1_000_000 },
        ],
        now,
      });

      expect(res.insufficientData).toBe(false);
      // p_alive = 1/(1+hazard), hazard = 10/age. Age tính từ đơn đầu → hiện tại
      // CLV = avgOrderValue × expectedOrders × p_alive
      expect(res.clvPredicted).toBeGreaterThan(0);
      expect(res.pAlive).toBeGreaterThan(0);
      expect(res.pAlive).toBeLessThanOrEqual(1);
    });

    test("churnProbability = 1 - pAlive, luôn trong [0, 1]", () => {
      const now = new Date();
      const res = clv.forecastCustomer({
        orders: [
          { status: "COMPLETED", createdAt: new Date(now.getTime() - 365 * 86_400_000), total: 500_000 },
          { status: "COMPLETED", createdAt: new Date(now.getTime() - 1 * 86_400_000), total: 500_000 },
        ],
        now,
      });
      expect(res.churnProbability).toBeGreaterThanOrEqual(0);
      expect(res.churnProbability).toBeLessThanOrEqual(1);
    });

    test("khách hàng không hoạt động lâu → churnProbability gần 1", () => {
      const now = new Date();
      // 10 đơn đều đặn, tất cả cách đây 300-365 ngày → chu kỳ mua ~36 ngày
      // nhưng im lặng 300 ngày → hazard = 300/36.5 ≈ 8.2 → churn ≈ 0.89
      const orders = [];
      for (let i = 0; i < 10; i += 1) {
        orders.push({
          status: "COMPLETED",
          createdAt: new Date(now.getTime() - (365 - i * 7) * 86_400_000),
          total: 500_000,
        });
      }
      const res = clv.forecastCustomer({ orders, now });
      expect(res.churnProbability).toBeGreaterThan(0.7);
      expect(res.pAlive).toBeLessThan(0.3);
    });

    test("khách hàng mua gần đây → churnProbability thấp", () => {
      const now = new Date();
      const res = clv.forecastCustomer({
        orders: [
          { status: "COMPLETED", createdAt: new Date(now.getTime() - 365 * 86_400_000), total: 500_000 },
          { status: "COMPLETED", createdAt: new Date(now.getTime() - 1 * 86_400_000), total: 500_000 },
        ],
        now,
      });
      expect(res.churnProbability).toBeLessThan(0.3);
      expect(res.pAlive).toBeGreaterThan(0.7);
    });

    test("hằng số cấu hình", () => {
      expect(clv.MIN_ORDERS).toBe(2);
      expect(clv.HORIZON_DAYS).toBe(365);
    });
  });

  describe("scoreCustomer — persist kết quả vào Customer", () => {
    const mockClient = {
      order: { findMany: jest.fn() },
      customer: { update: jest.fn() },
    };

    beforeEach(() => jest.clearAllMocks());

    test("persists clvPredicted, churnProbability, clvScoredAt", async () => {
      mockClient.order.findMany.mockResolvedValue([
        { status: "COMPLETED", createdAt: daysAgo(365), total: 500_000 },
        { status: "COMPLETED", createdAt: daysAgo(1), total: 500_000 },
      ]);
      mockClient.customer.update.mockResolvedValue({});

      const result = await clv.scoreCustomer("cus-1", mockClient);

      const updateArg = mockClient.customer.update.mock.calls[0][0];
      expect(updateArg.data.clvPredicted).toBeDefined();
      expect(updateArg.data.churnProbability).toBeDefined();
      expect(updateArg.data.clvScoredAt).toBeInstanceOf(Date);
      expect(result.customerId).toBe("cus-1");
    });

    test("customer < 2 orders → set null", async () => {
      mockClient.order.findMany.mockResolvedValue([
        { status: "COMPLETED", createdAt: daysAgo(5), total: 100_000 },
      ]);
      mockClient.customer.update.mockResolvedValue({});

      await clv.scoreCustomer("cus-2", mockClient);

      const updateArg = mockClient.customer.update.mock.calls[0][0];
      expect(updateArg.data.clvPredicted).toBeNull();
      expect(updateArg.data.churnProbability).toBeNull();
    });
  });
});
