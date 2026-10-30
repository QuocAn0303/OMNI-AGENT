/**
 * scripts/backtest/lib/dataset.js — nạp `data/dataset/daily_sku.csv` thành mảng dày.
 *
 * Nguồn: UCI Online Retail II, CC BY 4.0 (xem `docs/aisc26/02-data.md` §1).
 * Cột PII (`Customer ID`, `Country`) KHÔNG tồn tại trong bảng đã dựng nên không
 * có gì phải che ở đây — nếu sau này đổi nguồn, phải kiểm tra lại trước.
 *
 * Bảng gốc CHỈ có dòng cho ngày có phát sinh bán: 604 ngày trong khoảng lịch
 * 739 ngày, tức **135 ngày không có dòng nào** (18,3%). Trục ngày ở đây là **lịch
 * đầy đủ** từ ngày nhỏ nhất đến ngày lớn nhất, ngày không có dòng = 0 đơn vị bán.
 * Quyết định này chốt trước lần chạy đầu (D-P5-07): rolling-origin cần trục ngày
 * liên tục, và "không ghi nhận bán" là cách đọc duy nhất không bịa thêm dữ liệu.
 * Hệ quả phải báo: nếu một số ngày trong 135 ngày đó là ngày cửa hàng đóng
 * chứ không phải ngày không bán, thì `d_ref` bị **thấp đi** — nhưng điều đó áp
 * dụng như nhau cho mọi phương án nên không làm đổi kết luận so sánh.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_CSV = path.join(REPO_ROOT, "data", "dataset", "daily_sku.csv");

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @returns {{
 *   source: {csvPath:string, sha256:string, bytes:number},
 *   dates: string[], dateIndex: Map<string, number>,
 *   skus: string[], skuIndex: Map<string, number>,
 *   units: Int32Array,      // nSku * nDays, ngày không bán = 0
 *   hasSale: Uint8Array,    // 1 nếu dòng có trong CSV
 *   price: Float64Array,    // unit_price_median, NaN nếu ngày đó không bán
 *   nSku: number, nDays: number
 * }}
 */
const loadDailySku = (csvPath = DEFAULT_CSV) => {
  if (!fs.existsSync(csvPath)) {
    throw new Error(
      `Khong tim thay ${csvPath}. Chay: node scripts/dataset/fetch-online-retail-ii.js ` +
        `roi node scripts/dataset/build-daily-sku.js (xem 02-data.md §3).`,
    );
  }

  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "date,sku,units,revenue,unit_price_median,orders") {
    throw new Error(`Tieu de cot cua ${csvPath} khong khop voi build-daily-sku.js`);
  }

  const dateSet = new Set();
  const skuSet = new Set();
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(",");
    if (c.length < 6) throw new Error(`Dong ${i + 1} thieu cot: ${line}`);
    const [date, sku, units, , priceMedian] = c;
    if (!DATE_RE.test(date)) throw new Error(`Ngay khong hop le o dong ${i + 1}: ${date}`);
    const u = Number(units);
    const p = Number(priceMedian);
    if (!Number.isFinite(u) || u < 0) throw new Error(`units khong hop le o dong ${i + 1}`);
    dateSet.add(date);
    skuSet.add(sku);
    rows.push({ date, sku, units: u, price: p });
  }

  const dates = [];
  for (let d = new Date(`${[...dateSet].sort()[0]}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    dates.push(iso);
    if (iso === [...dateSet].sort()[dateSet.size - 1]) break;
  }
  const skus = [...skuSet].sort();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const skuIndex = new Map(skus.map((s, i) => [s, i]));

  const nSku = skus.length;
  const nDays = dates.length;
  const units = new Int32Array(nSku * nDays);
  const hasSale = new Uint8Array(nSku * nDays);
  const price = new Float64Array(nSku * nDays).fill(Number.NaN);

  let rowsMatched = 0;
  for (const r of rows) {
    const flat = skuIndex.get(r.sku) * nDays + dateIndex.get(r.date);
    units[flat] += r.units;
    hasSale[flat] = 1;
    rowsMatched += 1;
    if (Number.isFinite(r.price) && r.price > 0) price[flat] = r.price;
  }
  if (rowsMatched !== rows.length) throw new Error("Co dong CSV khong khop ngay trong khoang quan sat.");

  // Ngày có bán ít nhất 1 SKU — dùng để báo cáo giới hạn của dữ liệu.
  const daysWithSales = dates.filter((_, i) => {
    for (let s = 0; s < nSku; s += 1) if (hasSale[s * nDays + i]) return true;
    return false;
  }).length;

  return {
    source: { csvPath, sha256: sha256File(csvPath), bytes: fs.statSync(csvPath).size },
    dates,
    dateIndex,
    skus,
    skuIndex,
    units,
    hasSale,
    price,
    nSku,
    nDays,
    daysWithSales,
    zeroSalesDays: nDays - daysWithSales,
    csvRows: rows.length,
  };
};

module.exports = { loadDailySku, DEFAULT_CSV, REPO_ROOT, sha256File };
