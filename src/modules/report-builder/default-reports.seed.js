/**
 * modules/report-builder/default-reports.seed.js — 10 báo cáo phân tích mặc định (Mục 8)
 *
 * Seed 10 SavedReport (R-01 → R-10) cho tenant, dùng Report Builder hiện có
 * (query builder an toàn — mọi config đều thuộc whitelist ALLOWED_TABLES của
 * report-builder.service.js). Idempotent theo tên report trong tenant.
 *
 * R-01 CLV Leaderboard                  → customers sort clvPredicted desc
 * R-02 Ma trận phân khúc RFM            → customers group by rfmSegment
 * R-03 Giám sát rủi ro Churn            → customers filter churnProbability >= 0.7
 * R-04 Hiệu quả xử lý cảnh báo (Win-back) → churn_alerts group by status
 * R-05 Hiệu suất chiến dịch Email/Zalo  → campaign_recipients group by status
 * R-06 Ma trận Kraljic                  → vendors group by kraljicCategory
 * R-07 Vendor Scorecard                 → vendors (OTIF/defect/grade)
 * R-08 QC Pass Rate (nhận hàng PO)      → goods_receipt_items SUM passQty by product
 * R-09 AP Aging (tuổi nợ NCC)           → debts type PAYABLE (dueDate + amount/paid)
 * R-10 Hiệu quả kênh nguồn Lead         → customers group by referralSource
 */
const prisma = require("../../config/prisma");

const DEFAULT_REPORTS = [
  {
    code: "R-01",
    name: "R-01 CLV Leaderboard",
    description: "Top khách hàng theo giá trị vòng đời dự báo (BG/NBD + Gamma-Gamma)",
    config: {
      table: "customers",
      fields: ["name", "phone", "clvPredicted", "churnProbability", "rfmSegment"],
      orderBy: { field: "clvPredicted", dir: "desc" },
    },
  },
  {
    code: "R-02",
    name: "R-02 Ma trận phân khúc RFM",
    description: "Số khách hàng theo từng segment RFM động",
    config: { table: "customers", aggregate: { fn: "COUNT", field: "id" }, groupBy: "rfmSegment" },
  },
  {
    code: "R-03",
    name: "R-03 Giám sát rủi ro Churn theo phân khúc",
    description: "Khách có xác suất rời bỏ >= 70%",
    config: {
      table: "customers",
      fields: ["name", "phone", "churnProbability", "rfmSegment", "totalSpent"],
      filters: [{ field: "churnProbability", op: ">=", value: 0.7 }],
      orderBy: { field: "churnProbability", dir: "desc" },
    },
  },
  {
    code: "R-04",
    name: "R-04 Hiệu quả xử lý cảnh báo Win-back",
    description: "Số churn alert theo trạng thái (RETAINED / LOST / đang mở)",
    config: { table: "churn_alerts", aggregate: { fn: "COUNT", field: "id" }, groupBy: "status" },
  },
  {
    code: "R-05",
    name: "R-05 Hiệu suất chiến dịch Email/Zalo",
    description: "Số người nhận theo trạng thái gửi chiến dịch",
    config: { table: "campaign_recipients", aggregate: { fn: "COUNT", field: "id" }, groupBy: "status" },
  },
  {
    code: "R-06",
    name: "R-06 Ma trận Kraljic",
    description: "Số nhà cung cấp theo nhóm Kraljic",
    config: { table: "vendors", aggregate: { fn: "COUNT", field: "id" }, groupBy: "kraljicCategory" },
  },
  {
    code: "R-07",
    name: "R-07 Vendor Scorecard",
    description: "OTIF / Defect rate / Hạng A-B-C của nhà cung cấp",
    config: {
      table: "vendors",
      fields: ["name", "otifScore", "defectRate", "vendorGrade"],
      orderBy: { field: "otifScore", dir: "desc" },
    },
  },
  {
    code: "R-08",
    name: "R-08 QC Pass Rate (nhận hàng PO)",
    description: "Tổng số lượng PASS QC theo sản phẩm (GRN)",
    config: { table: "goods_receipt_items", aggregate: { fn: "SUM", field: "passQty" }, groupBy: "productId" },
  },
  {
    code: "R-09",
    name: "R-09 AP Aging (tuổi nợ phải trả NCC)",
    description: "Danh sách công nợ phải trả theo hạn (0 / 1-30 / 31-60 / >60 ngày — lọc theo dueDate)",
    config: {
      table: "debts",
      fields: ["vendorId", "amount", "paidAmount", "dueDate", "status"],
      filters: [{ field: "type", op: "=", value: "PAYABLE" }],
      orderBy: { field: "dueDate", dir: "asc" },
    },
  },
  {
    code: "R-10",
    name: "R-10 Hiệu quả kênh nguồn Lead",
    description: "Số lead/khách theo nguồn (webhook đa kênh)",
    config: { table: "customers", aggregate: { fn: "COUNT", field: "id" }, groupBy: "referralSource" },
  },
];

// Seed idempotent — report đã tồn tại (theo tên) thì bỏ qua
const seedDefaultReports = async (userId = null) => {
  const results = [];
  for (const r of DEFAULT_REPORTS) {
    const exists = await prisma.savedReport.findFirst({
      where: { name: r.name },
      select: { id: true },
    });
    if (exists) {
      results.push({ name: r.name, created: false });
      continue;
    }
    const created = await prisma.savedReport.create({
      data: {
        name: r.name,
        description: r.description,
        config: r.config,
        isPublic: true,
        createdById: userId,
      },
      select: { id: true, name: true },
    });
    results.push({ name: r.name, created: true, id: created.id });
  }
  return results;
};

module.exports = { seedDefaultReports, DEFAULT_REPORTS };
