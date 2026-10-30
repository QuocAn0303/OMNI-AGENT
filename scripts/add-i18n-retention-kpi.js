/**
 * Thêm key i18n cho panel KPI giữ chân (AN.4) vào vi.json + en.json.
 * Chạy 1 lần: node scripts/add-i18n-retention-kpi.js
 */
const fs = require("fs");
const path = require("path");

const VI = path.join(__dirname, "..", "frontend", "src", "locales", "vi.json");
const EN = path.join(__dirname, "..", "frontend", "src", "locales", "en.json");

// key mới → {vi, en}
const ADDITIONS = {
  kpiAtRisk: { vi: "Khách rủi ro (ngưỡng sàng lọc)", en: "At-risk customers (screening threshold)" },
  kpiAtRiskRate: { vi: "Tỷ lệ rủi ro", en: "At-risk rate" },
  kpiAlerts: { vi: "Cảnh báo churn", en: "Churn alerts" },
  kpiVoucherUsed: { vi: "Voucher win-back đã dùng", en: "Win-back voucher redemption" },
  kpiCohortTitle: {
    vi: "Tỷ lệ giữ chân theo cohort (tháng khách đến)",
    en: "Retention rate by cohort (customer signup month)",
  },
  kpiCohortMonth: { vi: "Tháng", en: "Month" },
  kpiCohortCustomers: { vi: "Số khách", en: "Customers" },
  kpiCohortActive: { vi: "Còn hoạt động (90 ngày)", en: "Still active (90 days)" },
  kpiCohortRate: { vi: "Tỷ lệ giữ chân", en: "Retention rate" },
  kpiThresholds: {
    vi: "Ngưỡng sàng lọc {{screening}} · ngưỡng gửi voucher {{action}}",
    en: "Screening threshold {{screening}} · voucher action threshold {{action}}",
  },
  kpiLoadFailed: { vi: "Không tải được KPI giữ chân", en: "Failed to load retention KPI" },
};

const patch = (file, lang) => {
  const raw = fs.readFileSync(file, "utf8");
  const json = JSON.parse(raw);
  json.crmPipeline.insights = json.crmPipeline.insights || {};
  const added = [];
  for (const [key, val] of Object.entries(ADDITIONS)) {
    if (json.crmPipeline.insights[key] == null) {
      json.crmPipeline.insights[key] = val[lang];
      added.push(key);
    }
  }
  // Giữ đúng 2 khoảng trắng như file gốc và không thêm BOM.
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return added;
};

const a = patch(VI, "vi");
const b = patch(EN, "en");
console.log(`vi.json: +${a.length} key${a.length ? ` (${a.join(", ")})` : ""}`);
console.log(`en.json: +${b.length} key${b.length ? ` (${b.join(", ")})` : ""}`);
