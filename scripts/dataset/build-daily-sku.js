'use strict';

/**
 * T6 — dựng bảng SKU × ngày từ dataset đã tải, kèm bộ lọc chốt trước.
 *
 * Nguồn   : data/dataset/raw/online_retail_II.xlsx
 *           (trong zip online_retail_ii.zip, UCI Online Retail II uci_id 502)
 * Đầu ra : data/dataset/daily_sku.csv   (UTF-8: date,sku,units,revenue,unit_price_median,orders)
 *           data/dataset/dataset-summary.json  (số liệu đo được, đưa vào 02-data.md)
 *
 * Cột nguồn (đọc thật từ hàng tiêu đề): Invoice, StockCode, Description, Quantity,
 * InvoiceDate, Price, Customer ID, Country.  Cột `Customer ID` và `Country` bị BỎ hoàn
 * toàn ⇒ dữ liệu đầu ra không chứa PII.
 *
 * Bộ lọc (CHỐT TRƯỚC khi xem số liệu, ghi ở 02-data.md §4):
 *   L1 bỏ hóa đơn hủy (Invoice bắt đầu bằng "C") và dòng Quantity <= 0 hoặc Price <= 0
 *   L2 chỉ giữ mã hàng dạng mã số 5–7 chữ số + nhãn chữ cái: ^\d{5,7}[A-Z]*$
 *      (loại mã phiên hàng: POST, DOT, M, D, B, C2, BDC, PADS…)
 *   L3 SKU tổng < 30 đơn vị trong toàn kỳ ⇒ loại (không đủ tín hiệu cho d_ref)
 *   L4 nếu còn > 500 SKU: 400 SKU nhiều đơn vị nhất + 100 SKU ít đơn vị nhất còn lại
 *      (giữ SKU bán thưa); hoà thì theo StockCode tăng dần — thứ tự tất định
 *
 * Dùng: node scripts/dataset/build-daily-sku.js
 * Ghi chú môi trường: worktree P2 không có node_modules ⇒ chạy với
 *   $env:NODE_PATH="<repo chính>\node_modules"  (chỉ dùng thư viện đã có trong package.json)
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_XLSX = path.join(ROOT, 'data', 'dataset', 'raw', 'online_retail_II.xlsx');
const OUT_DIR = path.join(ROOT, 'data', 'dataset');
const OUT_CSV = path.join(OUT_DIR, 'daily_sku.csv');
const OUT_JSON = path.join(OUT_DIR, 'dataset-summary.json');

const SHA256_ZIP = '572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb';
const MIN_UNITS_PER_SKU = 30;
const MAX_SKU = 500;
const TOP_HEAVY = 400;
const SKU_CODE = /^\d{5,7}[A-Z]*$/;

const C_INVOICE = 'invoice';
const C_SKU = 'stockcode';
const C_QTY = 'quantity';
const C_PRICE = 'price';
const C_DATE = 'invoicedate';

function ymd(v) {
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  if (!fs.existsSync(RAW_XLSX)) {
    console.error('[build] THIẾU tệp thô. Chạy trước: node scripts/dataset/fetch-online-retail-ii.js');
    console.error('[build] rồi giải nén zip ra data/dataset/raw/online_retail_II.xlsx');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RAW_XLSX, { sharedStrings: 'cache', styles: 'ignore', hyperlinks: 'ignore' });
  console.log(`[build] đã đọc ${wb.worksheets.length} sheet: ${wb.worksheets.map((w) => w.name).join(', ')}`);

  const stats = {
    dongHoc: 0, boHoaDonHuy: 0, boKhongDuongTinh: 0, boMaPhu: 0, giuDong: 0,
    soSheet: wb.worksheets.length,
  };
  const bySku = new Map();

  for (const ws of wb.worksheets) {
    let header = null;
    let col = null;
    ws.eachRow((row) => {
      if (!header) {
        header = [];
        row.eachCell({ includeEmpty: true }, (cell, c) => { header[c] = String(cell.text ?? '').trim(); });
        col = {};
        header.forEach((h, i) => {
          const k = h.toLowerCase().replace(/[^a-z]/g, '');
          if ([C_INVOICE, C_SKU, C_QTY, C_PRICE, C_DATE].includes(k)) col[k] = i;
        });
        const missing = [C_INVOICE, C_SKU, C_QTY, C_PRICE, C_DATE].filter((k) => !col[k]);
        if (missing.length) {
          console.error(`[build] sheet ${ws.name}: THIẾU cột ${missing.join(',')} — header=${header.join('|')}`);
          process.exit(1);
        }
        return;
      }
      const invoice = String(row.getCell(col[C_INVOICE]).text ?? '').trim();
      const sku = String(row.getCell(col[C_SKU]).text ?? '').trim().toUpperCase();
      const qty = Number(row.getCell(col[C_QTY]).value);
      const price = Number(row.getCell(col[C_PRICE]).value);
      const day = ymd(row.getCell(col[C_DATE]).value);

      stats.dongHoc += 1;
      if (!day) return;
      if (invoice.toUpperCase().startsWith('C')) { stats.boHoaDonHuy += 1; return; }
      if (!(qty > 0) || !(price > 0)) { stats.boKhongDuongTinh += 1; return; }
      if (!SKU_CODE.test(sku)) { stats.boMaPhu += 1; return; }

      if (!bySku.has(sku)) bySku.set(sku, new Map());
      const days = bySku.get(sku);
      if (!days.has(day)) days.set(day, { units: 0, revenue: 0, orders: new Set(), prices: [] });
      const cell = days.get(day);
      cell.units += qty;
      cell.revenue += qty * price;
      cell.orders.add(invoice);
      if (cell.prices.length < 500) cell.prices.push(price);
      stats.giuDong += 1;
    });
  }

  const totals = [...bySku.entries()].map(([sku, days]) => ({
    sku,
    units: [...days.values()].reduce((s, v) => s + v.units, 0),
    dayCount: days.size,
  }));
  const afterMin = totals.filter((t) => t.units >= MIN_UNITS_PER_SKU);
  afterMin.sort((a, b) => (b.units - a.units) || a.sku.localeCompare(b.sku));

  const chosen = afterMin.length <= MAX_SKU
    ? afterMin
    : afterMin.slice(0, TOP_HEAVY).concat(afterMin.slice(TOP_HEAVY, MAX_SKU));

  const lines = ['date,sku,units,revenue,unit_price_median,orders'];
  let outRows = 0;
  let minDate = null;
  let maxDate = null;
  let totalUnits = 0;
  let totalRevenue = 0;
  const daysSet = new Set();
  const chosenSorted = chosen.slice().sort((a, b) => a.sku.localeCompare(b.sku));

  for (const { sku } of chosenSorted) {
    const days = bySku.get(sku);
    for (const k of [...days.keys()].sort()) {
      const v = days.get(k);
      const ps = v.prices.slice().sort((a, b) => a - b);
      const med = ps.length ? ps[Math.floor(ps.length / 2)] : '';
      lines.push(`${k},${sku},${v.units},${v.revenue.toFixed(4)},${med},${v.orders.size}`);
      outRows += 1;
      totalUnits += v.units;
      totalRevenue += v.revenue;
      daysSet.add(k);
      if (!minDate || k < minDate) minDate = k;
      if (!maxDate || k > maxDate) maxDate = k;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_CSV, `${lines.join('\n')}\n`, 'utf8');

  // SKU bán thưa theo đúng định nghĩa giao thức §4.2: < 10 ngày có bán trong 90 ngày
  const last90 = [...daysSet].sort().slice(-90);
  const last90Set = new Set(last90);
  let sparseCount = 0;
  const perSkuLast90 = [];
  for (const { sku } of chosenSorted) {
    let c = 0;
    for (const k of bySku.get(sku).keys()) if (last90Set.has(k)) c += 1;
    if (c < 10) sparseCount += 1;
    perSkuLast90.push({ sku, sellingDays90: c });
  }

  const months = (minDate && maxDate)
    ? (Number(maxDate.slice(0, 4)) - Number(minDate.slice(0, 4))) * 12
      + (Number(maxDate.slice(5, 7)) - Number(minDate.slice(5, 7))) + 1
    : null;

  const summary = {
    nguon: 'UCI Online Retail II (uci_id 502)',
    url: 'https://archive.ics.uci.edu/dataset/502/online+retail+ii',
    tepGoc: 'data/dataset/raw/online_retail_ii.zip',
    sha256TepGoc: SHA256_ZIP,
    baoLoc: {
      L1: 'bỏ hóa đơn hủy (Invoice bắt đầu "C") + Quantity<=0 hoặc Price<=0',
      L2: `mã hàng khớp ${SKU_CODE}`,
      L3: `SKU tổng >= ${MIN_UNITS_PER_SKU} đơn vị`,
      L4: `tối đa ${MAX_SKU} SKU = ${TOP_HEAVY} nhiều nhất + ${MAX_SKU - TOP_HEAVY} ít nhất còn lại`,
    },
    thongKe: {
      ...stats,
      skuTrongTapGoc: bySku.size,
      skuSauL3: afterMin.length,
      skuSauL4: chosen.length,
      dongCSV: outRows,
      soNgayCoBan: daysSet.size,
      nhanDau: minDate,
      nhanCuoi: maxDate,
      soThangPhu: months,
      tongDonVi: totalUnits,
      tongDoanhThu: Number(totalRevenue.toFixed(2)),
      skuBanThua90Ngay: sparseCount,
      tyLeSkuBanThua: chosen.length ? Number(((sparseCount / chosen.length) * 100).toFixed(2)) : null,
      donViTrungBinhMoiSku: chosen.length ? Math.round(totalUnits / chosen.length) : null,
    },
    gioiHan: [
      'KHÔNG có tồn kho, lead time, số kênh ⇒ mọi chỉ số tồn kho là MÔ PHỎNG (03-evaluation-protocol.md §2.3).',
      'KHÔNG tuyên bố hiệu quả đa kênh.',
      'Cột Customer ID / Country đã bị bỏ ở bước đọc ⇒ không PII trong dữ liệu đầu ra.',
    ],
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('[build] số liệu đo được:');
  console.log(JSON.stringify(summary.thongKe, null, 2));
  console.log(`[build] ghi ${OUT_CSV}`);
  void perSkuLast90;
}

main().catch((e) => {
  console.error(`[build] LỖI: ${e.stack || e.message}`);
  process.exit(1);
});