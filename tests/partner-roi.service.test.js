/**
 * tests/partner-roi.service.test.js — Công thức lợi nhuận ròng và xếp hạng đối tác
 *
 * Đây là phần dễ sai nhất của cả phân hệ vì công thức có ba chỗ phải chốt:
 *   1. CLV lấy bản DỰ ĐOÁN hay bản THỰC TẾ.
 *   2. Hoa hồng theo TỶ LỆ hay CỐ ĐỊNH.
 *   3. Khách chưa đủ dữ liệu thì tính sao (và báo cáo phải nói rõ tỷ lệ độ phủ).
 *
 * Mỗi khẳng định dưới đây chốt một quyết định, kèm lý do vì sao chọn thế.
 */
const mockClient = {
  partner: { findMany: jest.fn(), findUnique: jest.fn() },
  partnerReferral: { findMany: jest.fn(), groupBy: jest.fn() },
  customer: { findMany: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);
jest.mock("../src/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const service = require("../src/modules/partners/roi.service");

/** Một đối tác với cấu hình hoa hồng cho sẵn. */
const partner = (over = {}) => ({
  id: "p1",
  code: "ĐT-202610-0001",
  name: "Đối tác A",
  type: "AFFILIATE",
  isActive: true,
  commissionType: "PERCENT_OF_CLV",
  commissionRate: 0.1, // 10%
  fixedCommission: 0,
  ...over,
});

/** Khách chuyển đổi với giá trị dự báo và thực tế. */
const customer = (id, predicted, actual) => ({
  id,
  clvPredicted: predicted,
  totalSpent: actual,
});

describe("roi.service — lợi nhuận ròng theo tỷ lệ CLV", () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Kịch bản gốc: 1 đối tác, 4 khách chuyển đổi, mỗi người CLV dự báo 1.000.000,
   * đã chi 500.000. Hoa hồng 10% của CLV.
   *
   *   giá trị dự báo = 4 × 1.000.000 = 4.000.000
   *   bình quân       = 4.000.000 / 4   = 1.000.000
   *   hoa hồng        = 1.000.000 × 10% × 4 = 400.000
   *   lợi nhuận ròng  = 4.000.000 − 400.000 = 3.600.000
   */
  test("tính đúng lợi nhuận ròng", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner()]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: false, _count: { _all: 0 } },
      { partnerId: "p1", converted: true, _count: { _all: 4 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p1", customerId: "c2", converted: true },
      { partnerId: "p1", customerId: "c3", converted: true },
      { partnerId: "p1", customerId: "c4", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([
      customer("c1", 1_000_000, 500_000),
      customer("c2", 1_000_000, 500_000),
      customer("c3", 1_000_000, 500_000),
      customer("c4", 1_000_000, 500_000),
    ]);

    const { partners } = await service.ranking();
    const row = partners[0];

    expect(row.converted).toBe(4);
    expect(row.predictedValue).toBe(4_000_000);
    expect(row.avgValue).toBe(1_000_000);
    expect(row.commission).toBe(400_000);
    expect(row.netProfit).toBe(3_600_000);
  });

  test("hoa hồng cố định nhân với số khách chuyển đổi", async () => {
    mockClient.partner.findMany.mockResolvedValue([
      partner({ commissionType: "FIXED_PER_CUSTOMER", commissionRate: 0, fixedCommission: 50_000 }),
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 4 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p1", customerId: "c2", converted: true },
      { partnerId: "p1", customerId: "c3", converted: true },
      { partnerId: "p1", customerId: "c4", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([
      customer("c1", 1_000_000, 0),
      customer("c2", 1_000_000, 0),
      customer("c3", 1_000_000, 0),
      customer("c4", 1_000_000, 0),
    ]);

    const { partners } = await service.ranking();
    // 4 khách × 50.000 = 200.000, KHÔNG phụ thuộc giá trị khách.
    expect(partners[0].commission).toBe(200_000);
  });
});

describe("roi.service — chọn giữa CLV dự báo và giá trị thực tế", () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Cốt lõi của quyết định thiết kế: cùng một đối tác, hai cách đo cho hai kết quả
   * khác nhau — và người đọc báo cáo phải biết mình đang nhìn cái nào.
   */
  test("metric=predicted dùng clvPredicted, metric=actual dùng totalSpent", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner({ commissionType: "FIXED_PER_CUSTOMER", fixedCommission: 0 })]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 1 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([customer("c1", 1_000_000, 500_000)]);

    const byPredicted = (await service.ranking({ metric: "predicted" })).partners[0];
    const byActual = (await service.ranking({ metric: "actual" })).partners[0];

    expect(byPredicted.predictedValue).toBe(1_000_000);
    expect(byActual.predictedValue).toBe(500_000);
    // Cả hai cột luôn có mặt để người đọc đối chiếu chéo.
    expect(byPredicted.actualValue).toBe(500_000);
    expect(byActual.actualValue).toBe(500_000);
  });

  test("metric lạ thì rơi về predicted", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner({ commissionType: "FIXED_PER_CUSTOMER", fixedCommission: 0 })]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([]);
    mockClient.partnerReferral.findMany.mockResolvedValue([]);
    mockClient.customer.findMany.mockResolvedValue([]);

    expect((await service.ranking({ metric: "gì đó lạ" })).metric).toBe("predicted");
  });

  test("kèm nhãn tiếng Việt cho metric", async () => {
    mockClient.partner.findMany.mockResolvedValue([]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([]);
    mockClient.partnerReferral.findMany.mockResolvedValue([]);
    mockClient.customer.findMany.mockResolvedValue([]);

    expect((await service.ranking({ metric: "predicted" })).metricLabel).toBe("Giá trị vòng đời dự báo");
    expect((await service.ranking({ metric: "actual" })).metricLabel).toBe("Giá trị thực tế đã thu");
  });
});

describe("roi.service — khách chưa đủ dữ liệu CLV", () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * `clv-forecast.service.js` để `clvPredicted` bằng rỗng với khách chưa có tối
   * thiểu 2 đơn hoàn tất. Báo cáo PHẢI nói rõ tỷ lệ độ phủ, nếu không người đọc
   * tưởng con số lợi nhuận phủ lên toàn bộ khách.
   */
  test("bỏ qua khách thiếu CLV và báo coverage thấp hơn 100%", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner()]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 4 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p1", customerId: "c2", converted: true },
      { partnerId: "p1", customerId: "c3", converted: true },
      { partnerId: "p1", customerId: "c4", converted: true },
    ]);
    // Chỉ 1 trong 4 khách đủ dữ liệu dự báo.
    mockClient.customer.findMany.mockResolvedValue([customer("c1", 1_000_000, 200_000)]);

    const { partners } = await service.ranking();
    const row = partners[0];

    expect(row.scoredCustomers).toBe(1);
    expect(row.coverage).toBe(25);
    expect(row.predictedValue).toBe(1_000_000);
    // Cột thực tế thì phủ hết 4 khách, vì mọi khách đều có tiền đã chi.
    expect(row.actualValue).toBe(200_000);
  });

  test("coverage = 0 khi không khách nào đủ dữ liệu", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner()]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 2 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p1", customerId: "c2", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([
      customer("c1", null, 100_000),
      customer("c2", null, 100_000),
    ]);

    const { partners } = await service.ranking();

    expect(partners[0].coverage).toBe(0);
    expect(partners[0].predictedValue).toBe(0);
    expect(partners[0].actualValue).toBe(200_000);
    // Giá trị dự báo bằng 0 thì KHÔNG được chia để ra số như vô hạn.
    expect(Number.isFinite(partners[0].avgValue)).toBe(true);
    expect(partners[0].avgValue).toBe(0);
  });

  // `customerId` là khoá mềm và có thể NULL. Trả 0 ngầm sẽ làm lợi nhuận ròng thành
  // số âm một cách âm thầm — phải đếm riêng và đưa ra báo cáo.
  test("lượt chuyển đổi không gắn được khách thì đếm riêng, không làm lệch số", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner()]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 3 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p1", customerId: null, converted: true },
      { partnerId: "p1", customerId: null, converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([customer("c1", 1_000_000, 300_000)]);

    const { partners, totals } = await service.ranking();

    expect(totals.unattachedReferrals).toBe(2);
    expect(partners[0].predictedValue).toBe(1_000_000);
    expect(partners[0].coverage).toBeCloseTo(33.33, 2);
  });

  /**
   * Cùng một khách có thể bị hai đối tác cùng giới thiệu — đây là dấu hiệu gian
   * lận hoa hồng. Hệ thống chỉ gán giá trị cho đối tác giới thiệu ĐẦU TIÊN, và
   * đếm số khách bị tranh chấp ra `contestedCustomers` để người dùng điều tra.
   * Gán cho cả hai sẽ làm tổng vượt thực tế; gán cho cả hai hoặc cho không ai thì
   * số hoa hồng bị sai mà báo cáo không nói gì.
   */
  test("khách bị hai đối tác ghi cùng lúc: gán cho đầu tiên, đếm khách bị tranh chấp", async () => {
    mockClient.partner.findMany.mockResolvedValue([
      partner({ id: "p1" }),
      partner({ id: "p2", code: "ĐT-202610-0002", name: "B" }),
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 1 } },
      { partnerId: "p2", converted: true, _count: { _all: 1 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p2", customerId: "c1", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([customer("c1", 1_000_000, 400_000)]);

    const { partners, totals } = await service.ranking();
    const a = partners.find((p) => p.partnerId === "p1");
    const b = partners.find((p) => p.partnerId === "p2");

    expect(a.predictedValue).toBe(1_000_000);
    // B không được cộng trùng, và phải thấy rõ là mình chưa được công nhận.
    expect(b.predictedValue).toBe(0);
    expect(b.coverage).toBe(0);
    // Báo cáo phải nói ra chứ không giấu.
    expect(totals.contestedCustomers).toBe(1);
  });
});

describe("roi.service — thứ tự xếp hạng", () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Hai đối tác cố tình trái ngược để chứng minh thứ tự ưu tiên:
   *   A giới thiệu nhiều nhưng khách rẻ  → giá trị thấp, chuyển đổi cao
   *   B giới thiệu ít nhưng khách đắt   → giá trị cao, chuyển đổi thấp
   * Nếu xếp theo số lượt thì A thắng, và đó chính là cái sai mà phân hệ này sinh ra
   * để tránh.
   */
  const setupTwoPartners = () => {
    mockClient.partner.findMany.mockResolvedValue([
      partner({ id: "pA", code: "ĐT-202610-0001", name: "A", commissionType: "FIXED_PER_CUSTOMER", fixedCommission: 0 }),
      partner({ id: "pB", code: "ĐT-202610-0002", name: "B", commissionType: "FIXED_PER_CUSTOMER", fixedCommission: 0 }),
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "pA", converted: false, _count: { _all: 60 } },
      { partnerId: "pA", converted: true, _count: { _all: 10 } },
      { partnerId: "pB", converted: true, _count: { _all: 3 } },
    ]);
    const refs = [];
    for (let i = 0; i < 10; i += 1) refs.push({ partnerId: "pA", customerId: `a${i}`, converted: true });
    for (let i = 0; i < 3; i += 1) refs.push({ partnerId: "pB", customerId: `b${i}`, converted: true });
    mockClient.partnerReferral.findMany.mockResolvedValue(refs);
    const customers = [];
    for (let i = 0; i < 10; i += 1) customers.push(customer(`a${i}`, 100_000, 50_000));
    for (let i = 0; i < 3; i += 1) customers.push(customer(`b${i}`, 2_000_000, 1_000_000));
    mockClient.customer.findMany.mockResolvedValue(customers);
  };

  test("mặc định xếp theo lợi nhuận ròng — đối tác khách đắt thắng", async () => {
    setupTwoPartners();

    const { partners, sortBy } = await service.ranking();

    expect(sortBy).toBe("profit");
    // A: 10 × 100.000 = 1.000.000.  B: 3 × 2.000.000 = 6.000.000.
    expect(partners[0].code).toBe("ĐT-202610-0002");
    expect(partners[0].rank).toBe(1);
    expect(partners[1].rank).toBe(2);
  });

  test("xếp theo conversion thì đối tác nhiều lượt thắng", async () => {
    setupTwoPartners();

    const { partners, sortBy } = await service.ranking({ sortBy: "conversion" });

    expect(sortBy).toBe("conversion");
    // A: 10/70 = 14.29%.  B: 3/3 = 100%.
    expect(partners[0].code).toBe("ĐT-202610-0002");
    expect(partners[1].conversionRate).toBeCloseTo(14.29, 2);
  });

  test("xếp theo revenue thì đối tác giá trị cao thắng", async () => {
    setupTwoPartners();

    const { partners } = await service.ranking({ sortBy: "revenue" });

    expect(partners[0].code).toBe("ĐT-202610-0002");
  });

  test("sortBy lạ thì rơi về profit", async () => {
    setupTwoPartners();

    expect((await service.ranking({ sortBy: "gì đó lạ" })).sortBy).toBe("profit");
  });

  test("activeOnly mặc định chỉ lấy đối tác đang hoạt động", async () => {
    setupTwoPartners();

    await service.ranking();

    expect(mockClient.partner.findMany.mock.calls[0][0].where).toEqual({ isActive: true });
  });
});

describe("roi.service — tổng hệ thống", () => {
  beforeEach(() => jest.clearAllMocks());

  test("ROI trên hoa hồng: lợi nhuận ròng chia cho tổng hoa hồng", async () => {
    mockClient.partner.findMany.mockResolvedValue([
      partner({ commissionType: "PERCENT_OF_CLV", commissionRate: 0.1 }),
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 2 } },
      { partnerId: "p1", converted: false, _count: { _all: 2 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
      { partnerId: "p1", customerId: "c2", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([
      customer("c1", 1_000_000, 0),
      customer("c2", 1_000_000, 0),
    ]);

    const { totals } = await service.ranking();

    expect(totals.predictedValue).toBe(2_000_000);
    expect(totals.commission).toBe(200_000);
    expect(totals.netProfit).toBe(1_800_000);
    // 1.800.000 / 200.000 = 900%
    expect(totals.roiOnCommission).toBe(900);
    expect(totals.overallConversionRate).toBe(50);
  });

  test("chưa trả hoa hồng nào thì roiOnCommission là null, không phải 0", async () => {
    mockClient.partner.findMany.mockResolvedValue([
      partner({ commissionType: "FIXED_PER_CUSTOMER", fixedCommission: 0 }),
    ]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 1 } },
    ]);
    mockClient.partnerReferral.findMany.mockResolvedValue([
      { partnerId: "p1", customerId: "c1", converted: true },
    ]);
    mockClient.customer.findMany.mockResolvedValue([customer("c1", 1_000_000, 0)]);

    const { totals } = await service.ranking();

    // 0 sẽ bị hiểu nhầm là "không sinh lời"; null mới đúng nghĩa là chưa có mẫu số.
    expect(totals.roiOnCommission).toBeNull();
  });

  test("không có đối tác nào thì tổng bằng 0, không lỗi", async () => {
    mockClient.partner.findMany.mockResolvedValue([]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([]);
    mockClient.partnerReferral.findMany.mockResolvedValue([]);
    mockClient.customer.findMany.mockResolvedValue([]);

    const { partners, totals } = await service.ranking();

    expect(partners).toEqual([]);
    expect(totals.netProfit).toBe(0);
    expect(totals.overallConversionRate).toBe(0);
  });
});

describe("roi.service — chi tiết một đối tác", () => {
  beforeEach(() => jest.clearAllMocks());

  test("trả danh sách khách xếp theo giá trị giảm dần, đánh dấu khách thiếu dữ liệu", async () => {
    mockClient.partner.findMany.mockResolvedValue([partner()]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([
      { partnerId: "p1", converted: true, _count: { _all: 2 } },
    ]);
    mockClient.partnerReferral.findMany
      .mockResolvedValueOnce([
        { partnerId: "p1", customerId: "c1", converted: true },
        { partnerId: "p1", customerId: "c2", converted: true },
      ])
      .mockResolvedValue([
        { referralCode: "RF-1", customerId: "c1", convertedAt: new Date(), partnerId: "p1" },
        { referralCode: "RF-2", customerId: "c2", convertedAt: new Date(), partnerId: "p1" },
      ]);
    mockClient.customer.findMany.mockResolvedValue([
      { id: "c1", name: "Thấp", phone: "1", totalSpent: 0, clvPredicted: 100_000, churnProbability: 0.1, rfmSegment: "Loyal" },
      { id: "c2", name: "Cao", phone: "2", totalSpent: 0, clvPredicted: null, churnProbability: 0.9, rfmSegment: "At-Risk" },
    ]);

    const out = await service.detail("p1");

    // c2 thiếu CLV dự báo nên bị đẩy xuống cuối (giá trị -1), dù tên là "Cao".
    expect(out.customers.map((c) => c.customerId)).toEqual(["c1", "c2"]);
    expect(out.customers[1].insufficientData).toBe(true);
    expect(out.customers[1].predictedValue).toBeNull();
  });

  test("trả 404 khi đối tác không có trong báo cáo", async () => {
    mockClient.partner.findMany.mockResolvedValue([]);
    mockClient.partnerReferral.groupBy.mockResolvedValue([]);
    mockClient.partnerReferral.findMany.mockResolvedValue([]);
    mockClient.customer.findMany.mockResolvedValue([]);

    await expect(service.detail("nope")).rejects.toMatchObject({ status: 404 });
  });
});