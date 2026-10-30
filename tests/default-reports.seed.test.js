/**
 * tests/default-reports.seed.test.js — Test seed báo cáo phân tích (Mục 8)
 *
 * Gồm 12 báo cáo: R-01 → R-10 cho khách hàng / nhà cung cấp / kho, và R-11/R-12
 * mới thêm cho phân hệ đối tác (PRM).
 */
const mockClient = {
  savedReport: { findFirst: jest.fn(), create: jest.fn() },
};

jest.mock("../src/config/prisma", () => mockClient);

const seed = require("../src/modules/report-builder/default-reports.seed");
const notificationService = require("../src/modules/notifications/notification.service");

describe("default-reports.seed (Mục 8)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("có đúng 12 báo cáo R-01 → R-12", () => {
    expect(seed.DEFAULT_REPORTS).toHaveLength(12);
    const codes = seed.DEFAULT_REPORTS.map((r) => r.code);
    expect(codes).toEqual([
      "R-01", "R-02", "R-03", "R-04", "R-05", "R-06",
      "R-07", "R-08", "R-09", "R-10", "R-11", "R-12",
    ]);
  });

  test("R-01: CLV Leaderboard — sort clvPredicted desc", () => {
    const r01 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-01");
    expect(r01.config.table).toBe("customers");
    expect(r01.config.orderBy.field).toBe("clvPredicted");
    expect(r01.config.orderBy.dir).toBe("desc");
    expect(r01.config.fields).toContain("clvPredicted");
  });

  test("R-04: Win-back alerts — group by status", () => {
    const r04 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-04");
    expect(r04.config.table).toBe("churn_alerts");
    expect(r04.config.groupBy).toBe("status");
  });

  test("R-06: Kraljic — group by kraljicCategory", () => {
    const r06 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-06");
    expect(r06.config.table).toBe("vendors");
    expect(r06.config.groupBy).toBe("kraljicCategory");
  });

  test("R-07: Vendor Scorecard — OTIF/defect/grade", () => {
    const r07 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-07");
    expect(r07.config.table).toBe("vendors");
    expect(r07.config.fields).toEqual(expect.arrayContaining(["otifScore", "defectRate", "vendorGrade"]));
  });

  test("R-08: QC Pass Rate — goods_receipt_items", () => {
    const r08 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-08");
    expect(r08.config.table).toBe("goods_receipt_items");
    expect(r08.config.aggregate.fn).toBe("SUM");
    expect(r08.config.aggregate.field).toBe("passQty");
  });

  test("R-09: AP Aging — filter PAYABLE", () => {
    const r09 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-09");
    expect(r09.config.table).toBe("debts");
    expect(r09.config.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "type", op: "=", value: "PAYABLE" }),
    ]));
  });

  test("R-10: Lead channel — group by referralSource", () => {
    const r10 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-10");
    expect(r10.config.table).toBe("customers");
    expect(r10.config.groupBy).toBe("referralSource");
  });

  test("R-11: lợi nhuận ròng theo đối tác — chỉ lượt đã chuyển đổi", () => {
    const r11 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-11");
    expect(r11.config.table).toBe("partner_referrals");
    expect(r11.config.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "converted", op: "=", value: true })]),
    );
  });

  test("R-12: tỷ lệ chuyển đổi — group by partnerId", () => {
    const r12 = seed.DEFAULT_REPORTS.find((r) => r.code === "R-12");
    expect(r12.config.table).toBe("partner_referrals");
    expect(r12.config.groupBy).toBe("partnerId");
  });

  // R-11 và R-12 là báo cáo đối tác nên PHẢI chỉ dùng bảng đã nằm trong
  // ALLOWED_TABLES của report-builder.service.js. Bảng ngoài whitelist là đường đọc
  // dữ liệu vượt qua bộ lọc trường.
  test("mọi bảng dùng trong báo cáo đều phải nằm trong ALLOWED_TABLES", () => {
    const allowed = require("../src/modules/report-builder/report-builder.service");
    const tables = new Set();
    for (const r of seed.DEFAULT_REPORTS) tables.add(r.config.table);
    // eslint-disable-next-line global-require
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "src", "modules", "report-builder", "report-builder.service.js"),
      "utf8",
    );
    const allowedTables = new Set(
      [...src.matchAll(/^\s{2}([a-z_]+):\s*\{$/gm)].map((m) => m[1]),
    );
    expect(allowedTables.size).toBeGreaterThan(10);
    for (const t of tables) {
      expect(allowedTables.has(t)).toBe(true);
    }
    void allowed;
  });

  test("seedDefaultReports: idempotent — báo cáo đã tồn tại → bỏ qua", async () => {
    mockClient.savedReport.findFirst.mockResolvedValue({ id: "exists-1" });
    mockClient.savedReport.create.mockResolvedValue({ id: "created-1" });

    const res = await seed.seedDefaultReports("admin-1");

    const created = res.filter((r) => r.created).length;
    expect(created).toBe(0);
    expect(mockClient.savedReport.create).not.toHaveBeenCalled();
  });

  test("seedDefaultReports: tạo báo cáo mới khi chưa có", async () => {
    mockClient.savedReport.findFirst.mockResolvedValue(null);
    mockClient.savedReport.create.mockResolvedValue({ id: "new-1" });

    const res = await seed.seedDefaultReports("admin-1");

    const created = res.filter((r) => r.created).length;
    expect(created).toBe(12);
    expect(mockClient.savedReport.create).toHaveBeenCalledTimes(12);
  });
});
