/**
 * tests/analytics-customer-insights.test.js — Test RFM/CLV/churn (CRM Phase 4 mục 1)
 *
 * Trọng tâm:
 * - Chỉ ĐỌC dữ liệu đã chấm sẵn trên `Customer` — không tự tính lại RFM/CLV
 *   (tránh 2 nguồn sự thật với rfm.service.js / clv-forecast.service.js).
 * - Luôn trả đủ 5 phân khúc RFM (kể cả 0 khách) để biểu đồ không nhảy layout.
 * - Khách chưa chấm (`rfmSegment = NULL`) phải được báo riêng, không âm thầm loại
 *   khỏi tổng — đây là điểm dễ sai: đếm tổng = số khách có phân khúc là sai.
 * - Phân khúc lạ (do đổi logic cũ) gom vào "Other" thay vì rơi mất.
 */
const mockClient = {
  customer: {
    count: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock("../src/config/prisma", () => mockClient);

const analyticsService = require("../src/modules/analytics/analytics.service");

const segRow = (segment, count, extra = {}) => ({
  rfmSegment: segment,
  _count: { _all: count },
  _avg: { rfmMonetary: extra.monetary ?? null, rfmFrequency: extra.freq ?? null },
});

const tierRow = (tier, count, spent) => ({
  tier,
  _count: { _all: count },
  _sum: { totalSpent: spent },
});

describe("analytics/getCustomerInsights (CRM Phase 4)", () => {
  beforeEach(() => {
    // resetAllMocks chứ không clearAllMocks: clear chỉ xoá lịch sử call, GIỮ lại
    // hàng đợi `mockResolvedValueOnce` chưa dùng → rò sang test kế tiếp (đã xảy ra
    // ở đây: test "ngưỡng rủi ro" để lại 1 Once, test "limit" đọc nhầm).
    jest.resetAllMocks();
    mockClient.customer.count.mockResolvedValue(0);
    mockClient.customer.groupBy.mockResolvedValue([]);
    mockClient.customer.aggregate.mockResolvedValue({});
    mockClient.customer.findMany.mockResolvedValue([]);
  });

  test("trả đủ 5 phân khúc RFM kể cả nhóm rỗng", async () => {
    mockClient.customer.groupBy
      .mockResolvedValueOnce([segRow("Champions", 10), segRow("Loyal", 4)])
      .mockResolvedValueOnce([tierRow("GOLD", 5, 1000)]);

    const out = await analyticsService.getCustomerInsights();
    expect(out.rfmSegments).toHaveLength(5);
    expect(out.rfmSegments.map((s) => s.segment)).toEqual([
      "Champions", "Loyal", "Potential", "At-Risk", "Hibernating",
    ]);
    // Nhóm 0 khách vẫn phải có mặt (count = 0) để biểu đồ giữ layout
    expect(out.rfmSegments.find((s) => s.segment === "Potential").count).toBe(0);
    expect(out.rfmSegments.find((s) => s.segment === "Champions").count).toBe(10);
  });

  test("phân khúc lạ (logic cũ) → gom 'Other', không rơi mất", async () => {
    mockClient.customer.groupBy
      .mockResolvedValueOnce([segRow("Champions", 3), segRow("Vip-Legacy", 7)])
      .mockResolvedValueOnce([]);
    const out = await analyticsService.getCustomerInsights();
    const other = out.rfmSegments.find((s) => s.segment === "Other");
    expect(other).toBeDefined();
    expect(other.count).toBe(7);
    // Vip-Legacy không được xuất hiện như 1 nhóm riêng
    expect(out.rfmSegments.some((s) => s.segment === "Vip-Legacy")).toBe(false);
  });

  test("unscored = tổng khách − khách đã chấm", async () => {
    mockClient.customer.count.mockResolvedValueOnce(100); // activeCustomers
    mockClient.customer.groupBy
      .mockResolvedValueOnce([segRow("Champions", 30)])
      .mockResolvedValueOnce([]);
    mockClient.customer.count.mockResolvedValueOnce(2); // atRiskTotal
    mockClient.customer.findMany.mockResolvedValueOnce([]);

    const out = await analyticsService.getCustomerInsights();
    expect(out.totals).toMatchObject({ activeCustomers: 100, scoredCustomers: 30, unscoredCustomers: 70 });
  });

  test("chưa chấm ai: scored = 0, unscored = toàn bộ", async () => {
    mockClient.customer.count.mockResolvedValueOnce(42);
    mockClient.customer.groupBy.mockResolvedValue([]);
    mockClient.customer.count.mockResolvedValueOnce(0);

    const out = await analyticsService.getCustomerInsights();
    expect(out.totals.scoredCustomers).toBe(0);
    expect(out.totals.unscoredCustomers).toBe(42);
    expect(out.churn.atRiskTotal).toBe(0);
  });

  test("unscored không âm khi khách bị vô hiệu hoá giữa lúc đếm", async () => {
    // activeCustomers < scoredCustomers là bất khả thi; phải kẹp 0 không âm
    mockClient.customer.count.mockResolvedValueOnce(5);
    mockClient.customer.groupBy.mockResolvedValueOnce([segRow("Champions", 12)]);
    mockClient.customer.count.mockResolvedValueOnce(0);

    const out = await analyticsService.getCustomerInsights();
    expect(out.totals.unscoredCustomers).toBe(0);
  });

  test("Decimal của Prisma được chuyển sang Number", async () => {
    mockClient.customer.groupBy
      .mockResolvedValueOnce([segRow("Champions", 5, { monetary: 1234.56, freq: 2 })])
      .mockResolvedValueOnce([]);
    mockClient.customer.aggregate
      .mockResolvedValueOnce({
        _sum: { clvPredicted: 500000 },
        _avg: { clvPredicted: 250000 },
        _count: { clvPredicted: 2 },
      })
      .mockResolvedValueOnce({
        _avg: { churnProbability: 0.42 },
        _max: { churnProbability: 0.99 },
        _count: { churnProbability: 2 },
      });

    const out = await analyticsService.getCustomerInsights();
    const champ = out.rfmSegments.find((s) => s.segment === "Champions");
    expect(champ.avgMonetary).toBe(1234.56);
    expect(champ.avgFrequency).toBe(2);
    expect(typeof out.clv.total).toBe("number");
    expect(out.clv.average).toBe(250000);
    expect(out.churn.average).toBe(0.42);
  });

  test("chưa có ai chấm CLV/churn → 0 / null, không NaN", async () => {
    const out = await analyticsService.getCustomerInsights();
    expect(out.clv).toEqual({ total: 0, average: 0 });
    expect(out.churn.average).toBeNull();
    expect(out.churn.max).toBeNull();
    expect(out.churn.threshold).toBe(0.5);
  });

  test("ngưỡng rủi ro là 0.5 — khách 0.49 không bị tính", async () => {
    mockClient.customer.findMany.mockResolvedValueOnce([]);
    mockClient.customer.count.mockResolvedValueOnce(0);
    await analyticsService.getCustomerInsights();
    const atRiskCall = mockClient.customer.findMany.mock.calls[0][0];
    expect(atRiskCall.where.churnProbability.gte).toBe(0.5);
  });

  test("tier kèm tổng chi tiêu", async () => {
    mockClient.customer.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([tierRow("GOLD", 5, 2000000), tierRow("BRONZE", 20, 500000)]);
    const out = await analyticsService.getCustomerInsights();
    const gold = out.tiers.find((x) => x.tier === "GOLD");
    expect(gold).toMatchObject({ count: 5, totalSpent: 2000000 });
  });

  test("limit mặc định 20, truyền vào được tôn trọng", async () => {
    await analyticsService.getCustomerInsights();
    // calls[i] là mảng tham số → args nằm ở calls[i][0]
    const [riskDef, clvDef] = mockClient.customer.findMany.mock.calls.map((c) => c[0]);
    expect(riskDef.take).toBe(20);
    expect(clvDef.take).toBe(20);

    jest.clearAllMocks();
    mockClient.customer.findMany.mockResolvedValue([]);
    mockClient.customer.groupBy.mockResolvedValue([]);
    mockClient.customer.aggregate.mockResolvedValue({});

    await analyticsService.getCustomerInsights({ riskLimit: 5, clvLimit: 3 });
    const [riskCall, clvCall] = mockClient.customer.findMany.mock.calls.map((c) => c[0]);
    expect(riskCall.take).toBe(5);
    expect(clvCall.take).toBe(3);
  });

  test("top CLV sort giảm dần theo giá trị", async () => {
    mockClient.customer.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "c1", name: "A", clvPredicted: 900 }]);
    const out = await analyticsService.getCustomerInsights();
    expect(out.topClv[0]).toMatchObject({ id: "c1", clvPredicted: 900 });
    expect(typeof out.topClv[0].clvPredicted).toBe("number");
    const clvCall = mockClient.customer.findMany.mock.calls[1][0];
    expect(clvCall.orderBy).toEqual({ clvPredicted: "desc" });
  });

  // Bug thật phát hiện khi smoke trên DB: cột Decimal của Postgres trả về
  // STRING ("5192000"), không phải number. Mock cũ trả số nên test không bắt.
  // Test này cố tình mock giống hệt hành vi thật của Prisma + Decimal.
  test("Decimal từ DB (string) được chuyển về number ở cả atRisk và topClv", async () => {
    mockClient.customer.findMany
      .mockResolvedValueOnce([
        {
          id: "c1", name: "An", phone: "0900000001", email: "an@x.vn", tier: "GOLD",
          rfmSegment: "At-Risk",
          churnProbability: 0.79,
          clvPredicted: "2484481.1",   // <- Decimal
          totalSpent: "5946000",       // <- Decimal
        },
      ])
      .mockResolvedValueOnce([
        { id: "c1", name: "An", tier: "GOLD", rfmSegment: "Loyal", clvPredicted: "4333939.13", totalSpent: "5192000" },
      ]);

    const out = await analyticsService.getCustomerInsights();

    const a = out.atRisk[0];
    expect(typeof a.churnProbability).toBe("number");
    expect(a.clvPredicted).toBeCloseTo(2484481.1, 4);
    expect(a.totalSpent).toBe(5946000);

    const c = out.topClv[0];
    expect(c.clvPredicted).toBeCloseTo(4333939.13, 4);
    expect(c.totalSpent).toBe(5192000);

    // id/phone/email VẪN phải là string — không được convert quá tay
    expect(typeof a.phone).toBe("string");
    expect(a.phone).toBe("0900000001");
  });

  test("clvPredicted null (chưa đủ dữ liệu) → giữ null, không thành 0", async () => {
    mockClient.customer.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "c1", name: "B", tier: "BRONZE", rfmSegment: null, clvPredicted: null, totalSpent: "0" }]);
    const out = await analyticsService.getCustomerInsights();
    expect(out.topClv[0].clvPredicted).toBeNull();
    expect(out.topClv[0].totalSpent).toBe(0);
  });
});