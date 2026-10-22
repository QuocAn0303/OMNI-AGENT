'use strict';

/**
 * scripts/ml/build-churn-panel.js — Phase 4.2: dựng PANEL KHÁCH từ UCI Online Retail II
 *
 * ============================================================================
 * VÌ SAO CẦN SCRIPT NÀY
 * DoD của R4 yêu cầu "model + API thật" với chỉ số AUC ≥ 0.65. Để đo AUC có
 * nghĩa, nhãn churn phải bám **hành vi mua thật**, không phải dữ liệu tự sinh.
 * Nguồn duy nhất trong repo có hành vi mua thật là `online_retail_II.xlsx`
 * (1.067.371 dòng, CC BY 4.0) — nhưng bảng dựng sẵn trong repo (`daily_sku.csv`)
 * đã BỎ cột `Customer ID`, nên không gom được lịch sử theo khách.
 *
 * Script này đọc TỆP GỐC (chỉ cột giao dịch + khách + thời gian), gom theo
 * khách rồi xuất PANEL: mỗi (khách, mốc tháng) là một mẫu với đặc trưng R/F/M
 * và NHÃN churn (90 ngày sau mốc khách có mua lại hay không).
 *
 * VỀ PII (quyết định đã chốt với nhóm):
 *   - `Customer ID` của tệp gốc KHÔNG rời khỏi script này. Mọi bản ghi xuất ra
 *     dùng mã thay thế liên tục `KH-00001`.
 *   - `Description` (chuỗi tự do) và `Country` không đọc vào bảng đầu ra — đúng
 *     nguyên tắc đã ghi ở `docs/aisc26/02-data.md` §5.
 *   - Bảng đầu ra KHÔNG chứa PII: mã khách là số thứ tự tự sinh.
 *
 *   Yêu cầu: tệp `data/dataset/raw/online_retail_II.xlsx`
 *   Chạy:   npm run ml:panel            # xuất data/dataset/churn/panel.csv
 *   Ghi đè: --force
 */

const fs = require("fs");
const path = require("path");
const { WorkbookReader } = require("exceljs").stream.xlsx;

const ROOT = path.join(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "data", "dataset", "raw", "online_retail_II.xlsx");
const OUT_DIR = path.join(ROOT, "data", "dataset", "churn");
const OUT_CSV = path.join(OUT_DIR, "panel.csv");
const OUT_META = path.join(OUT_DIR, "panel-meta.json");

const FORCE = process.argv.includes("--force");
const HORIZON_DAYS = 90; // cửa sổ dự đoán churn
const MIN_ORDERS_BEFORE = 2; // khách mới có 1 đơn thì chưa đủ lịch sử để dự đoán
const DAY_MS = 86400000;

/** Quy đổi ngày sang "ô tháng" = số tháng kể từ 2000-01-01 (chỉ để so sánh). */
const monthIndex = (d) => Math.floor((d.getUTCFullYear() - 2000) * 12 + d.getUTCMonth());

/** ExcelJS đọc ngày trong xlsx ra Date (UTC) hoặc số serial — chuẩn hoá cả hai. */
const toDate = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Serial date của Excel: 1899-12-30 là mốc 0.
    return new Date(Date.UTC(1899, 11, 30) + v * DAY_MS);
  }
  if (typeof v === "string") {
    const s = v.replace(" ", "T");
    const d = new Date(s.includes("Z") ? s : `${s}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/**
 * Hoá đơn hợp lệ = KHÔNG phải credit note.
 *
 * LƯU Ý QUAN TRỌNG: trong tệp UCI, cột `Invoice` có dạng SỐ (489434) ở tệp
 * `.xlsx` này, không phải chuỗi. Hàm cũ ép `typeof === "string"` nên loại mất
 * TOÀN BỘ dòng ⇒ panel rỗng mà không báo lỗi. Phải nhận cả hai kiểu.
 * Credit note trong bộ dữ liệu có dạng chuỗi bắt đầu bằng "C" (ví dụ "C536379").
 */
const isRealInvoice = (invoiceNo) => {
  if (invoiceNo == null) return false;
  const s = String(invoiceNo).trim();
  if (!s) return false;
  return !/^c/i.test(s);
};

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[ml:panel] KHÔNG có tệp nguồn: ${SOURCE}`);
    console.error("[ml:panel] Tải UCI Online Retail II (uci_id 502) hoặc trỏ SOURCE sang tệp gốc.");
    process.exit(1);
  }
  if (fs.existsSync(OUT_CSV) && !FORCE) {
    console.log(`[ml:panel] Đã có ${path.relative(ROOT, OUT_CSV)} — không ghi đè. Dùng --force để dựng lại.`);
    process.exit(0);
  }

  console.log(`[ml:panel] Đọc: ${path.relative(ROOT, SOURCE)} (${(fs.statSync(SOURCE).size / 1048576).toFixed(1)} MB)`);

  // ---------------------------------------------------------------- 1. Đọc và gom
  /** @type {Map<string, {id:string, dates:Set<number>, revenue:number, orders:number, baskets:number}>} */
  const customers = new Map();
  const errors = { badDate: 0, noCustomer: 0, notReal: 0 };
  let rowCount = 0;
  let keptRows = 0;
  let headerChecked = false;
  const t0 = Date.now();

  const workbook = new WorkbookReader();
  // ExcelJS 3.10: worksheet phát `finished`, workbook phát `end`. Chỉ nghe
  // `finished` của sheet cuối không đáng tin (nó chỉ chắc chắn khi stream kết
  // thúc toàn cục) ⇒ nghe `end` của workbook rồi mới xử lý phần còn lại.
  await new Promise((resolve, reject) => {
    workbook.on("worksheet", (ws) => {
      ws.on("row", (row) => {
        rowCount += 1;
        if (rowCount % 200000 === 0) {
          console.log(`[ml:panel]   …đã đọc ${rowCount.toLocaleString("vi-VN")} dòng, ${customers.size} khách`);
        }
        if (!headerChecked) {
          headerChecked = true;
          const cols = (row.values || []).map((v) => String(v ?? "").toUpperCase());
          console.log(`[ml:panel] Cột: ${cols.filter(Boolean).join(", ")}`);
          const hasCustomerCol = cols.some((c) => /CUSTOMER\s*ID/i.test(c));
          const hasInvoiceCol = cols.some((c) => /INVOICE|INVOICENO/i.test(c));
          const hasDateCol = cols.some((c) => /INVOICEDATE|DATE/i.test(c));
          if (!hasCustomerCol || !hasInvoiceCol || !hasDateCol) {
            reject(new Error(`Tệp gốc thiếu cột bắt buộc (cần: Invoice/InvoiceNo, CustomerID, InvoiceDate — thấy: ${cols.join(", ")})`));
            return;
          }
          return;
        }
        const v = row.values || [];
        // Header đã biết thứ tự cột của tệp UCI (ExcelJS `row.values` là mảng
        // 1-indexed, v[0] rỗng):
        //   1=InvoiceNo, 2=StockCode, 3=Description, 4=Quantity, 5=InvoiceDate,
        //   6=UnitPrice, 7=CustomerID, 8=Country
        const invoiceNo = v[1];
        const customerRaw = v[7];
        const date = toDate(v[5]);
        const qty = Number(v[4]);
        const price = Number(v[6]);

        if (!isRealInvoice(invoiceNo)) { errors.notReal += 1; return; }
        if (customerRaw == null || customerRaw === "") { errors.noCustomer += 1; return; }
        if (!date) { errors.badDate += 1; return; }

        let cid = customers.get(String(customerRaw));
        if (!cid) {
          // Mã thay thế liên tục — Customer ID gốc KHÔNG được ghi ra file.
          cid = { id: "", dates: new Set(), revenue: 0, orders: 0 };
          customers.set(String(customerRaw), cid);
        }
        const day = Math.floor(date.getTime() / DAY_MS);
        if (!cid.dates.has(day)) { cid.dates.add(day); cid.orders += 1; }
        cid.revenue += Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
        keptRows += 1;
      });
      // ExcelJS 3.10 (`lib/stream/xlsx/worksheet-reader.js`) phát sự kiện
      // `finished`, KHÔNG phát `end`. Bắt `end` trên worksheet ⇒ promise không
      // bao giờ resolve ⇒ tiến trình thoát code 0 mà không ghi tệp.
      ws.on("finished", () => {});
    });
    workbook.on("end", resolve);
    workbook.on("error", reject);
    workbook.read(fs.createReadStream(SOURCE), { worksheets: "emit", sharedStrings: "cache", styles: "ignore" });
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[ml:panel] Đọc xong ${rowCount.toLocaleString("vi-VN")} dòng trong ${elapsed}s`);
  console.log(`[ml:panel] Khách có giao dịch hợp lệ: ${customers.size.toLocaleString("vi-VN")}`);
  console.log(`[ml:panel] Bỏ qua: dòng credit note=${errors.notReal}, không khách=${errors.noCustomer}, ngày lỗi=${errors.badDate}`);

  // Gán mã thay thế sau khi đã gom xong (thứ tự = thứ tự phát hiện, ổn định theo file).
  const byId = [...customers.entries()];
  byId.forEach(([, c], i) => { c.id = `KH-${String(i + 1).padStart(5, "0")}`; });

  // ------------------------------------------------------- 2. Dựng mẫu theo tháng
  const globalMin = byId.reduce(
    (min, [, c]) => Math.min(min, ...[...c.dates]),
    Number.POSITIVE_INFINITY,
  );
  const globalMax = byId.reduce((max, [, c]) => Math.max(max, ...[...c.dates]), 0);
  const monthTotal = monthIndex(new Date(globalMax * DAY_MS)) - monthIndex(new Date(globalMin * DAY_MS));
  console.log(`[ml:panel] Khoảng thời gian: ${new Date(globalMin * DAY_MS).toISOString().slice(0, 10)} → ${new Date(globalMax * DAY_MS).toISOString().slice(0, 10)} (${monthTotal} tháng)`);

  const samples = [];
  for (const [, c] of byId) {
    const days = [...c.dates].sort((a, b) => a - b);
    const firstDay = days[0];
    const firstMonth = monthIndex(new Date(firstDay * DAY_MS));
    const lastMonth = monthIndex(new Date(days[days.length - 1] * DAY_MS));

    // Mốc bắt đầu từ tháng thứ 3 (đủ 2 tháng lịch sử) và kết thúc khi còn đủ
    // 90 ngày quan sát phía sau mốc.
    for (let m = firstMonth + 2; m <= lastMonth; m += 1) {
      const cutoff = Date.UTC(new Date(monthMinUtc(m)).getUTCFullYear(), new Date(monthMinUtc(m)).getUTCMonth(), 1) / DAY_MS;
      if (cutoff < days[0]) continue;
      // Bỏ mốc quá gần cuối dữ liệu: không đủ 90 ngày để gán nhãn.
      if (cutoff + HORIZON_DAYS > globalMax) break;

      const window = days.filter((d) => d >= cutoff - 365 && d < cutoff);
      const future = days.filter((d) => d >= cutoff && d <= cutoff + HORIZON_DAYS);
      if (window.length < MIN_ORDERS_BEFORE) continue; // chưa đủ lịch sử

      const recency = cutoff - window[window.length - 1];
      // Nhịp mua trung bình (ngày) giữa các lần mua trong cửa sổ.
      let gapSum = 0;
      for (let i = 1; i < window.length; i += 1) gapSum += window[i] - window[i - 1];
      const avgGap = window.length > 1 ? gapSum / (window.length - 1) : 0;
      const spanDays = cutoff - window[0];
      // Số tháng không mua = số tháng giữa lần mua cuối trong cửa sổ và mốc.
      const monthsIdle = Math.floor(recency / 30.44);

      samples.push({
        customer: c.id,
        cutoffMonth: m,
        recencyDays: recency,
        frequency: window.length,
        // Tiền đưa qua log1p — BẮT BUỘC, không phải cho "đẹp".
        // Tập huấn luyện dùng GBP của UCI, còn hệ thống chạy VND: chênh lệch
        // 4–5 bậc độ lớn làm z-score vô nghĩa và xác suất dồn về 0 hoặc 1. log1p
        // đưa hai thang tiền khác nhau về cùng dạng và giữ tính đơn điệu.
        logMonetary: Math.log1p(Math.max(0, Math.round(c.revenue * (window.length / c.orders)))),
        avgGapDays: Math.round(avgGap * 100) / 100,
        tenureDays: spanDays,
        logAvgOrderValue: Math.log1p(Math.max(0, Math.round(c.revenue / c.orders))),
        monthsIdle,
        // NHÃN: 1 = không mua lại trong 90 ngày (churn), 0 = còn mua.
        label: future.length === 0 ? 1 : 0,
      });
    }
  }

  const churn = samples.filter((s) => s.label === 1).length;
  console.log(`[ml:panel] Số mẫu: ${samples.length.toLocaleString("vi-VN")} | churn=${churn} (${((churn / samples.length) * 100).toFixed(1)}%)`);

  if (samples.length < 500) {
    console.error(`[ml:panel] Số mẫu quá ít (${samples.length}) — không đủ để train. Kiểm tra lại cách lọc hoá đơn.`);
    process.exit(1);
  }

  // ---------------------------------------------------------------- 3. Ghi file
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const header = [
    "customer", "cutoffMonth", "recencyDays", "frequency", "logMonetary",
    "avgGapDays", "tenureDays", "logAvgOrderValue", "monthsIdle", "label",
  ];
  const lines = [header.join(",")];
  for (const s of samples) lines.push(header.map((k) => s[k]).join(","));
  fs.writeFileSync(OUT_CSV, `${lines.join("\n")}\n`, "utf8");

  const meta = {
    generatedAt: new Date().toISOString(),
    source: {
      file: path.relative(ROOT, SOURCE).replace(/\\/g, "/"),
      license: "CC BY 4.0 — UCI Online Retail II (uci_id 502)",
      rowsRead: rowCount,
      rowsKept: keptRows,
      skipped: errors,
    },
    // Quyết định nhóm: đọc Customer ID của tệp gốc để gom lịch sử theo khách,
    // nhưng KHÔNG xuất ra bất kỳ đâu. File này chỉ có mã KH-xxxxx tự sinh.
    pii: "Customer ID gốc chỉ tồn tại trong RAM của script; đầu ra chỉ dùng mã KH-xxxxx",
    customers: customers.size,
    months: monthTotal,
    horizonDays: HORIZON_DAYS,
    minOrdersBefore: MIN_ORDERS_BEFORE,
    samples: samples.length,
    churnSamples: churn,
    churnRate: Number((churn / samples.length).toFixed(4)),
    features: header.filter((h) => h !== "customer" && h !== "cutoffMonth" && h !== "label"),
    label: "label = 1 nếu khách không mua lại trong 90 ngày sau mốc",
    moneyFeatures: "logMonetary / logAvgOrderValue = log1p(giá trị) — dùng chung được cho GBP (tập train) và VND (hệ thống chạy)",
  };
  fs.writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  console.log(`[ml:panel] Đã ghi ${path.relative(ROOT, OUT_CSV)} (${(fs.statSync(OUT_CSV).size / 1048576).toFixed(2)} MB)`);
  console.log(`[ml:panel] Đã ghi ${path.relative(ROOT, OUT_META)}`);
  console.log(`[ml:panel] Đặc trưng: ${meta.features.join(", ")}`);
}

function monthMinUtc(m) {
  const year = 2000 + Math.floor(m / 12);
  const month = m % 12;
  return new Date(Date.UTC(year, month, 1));
}

main().catch((e) => {
  console.error("[ml:panel] LỖI:", e.message);
  process.exit(1);
});