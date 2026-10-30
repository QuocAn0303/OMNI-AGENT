'use strict';

/**
 * T9 — BỘ SINH TỆP XUẤT ĐƠN MÔ PHỎNG (định dạng giả định theo Shopee).
 *
 * CỐ Ý KHÔNG tích hợp sàn thật. Kênh sàn của luồng demo là **tệp xuất đơn mô
 * phỏng** (`NIGHT-PROMPT.md` §1). Tệp này sinh ra đúng để chứng minh: đường nạp
 * đơn + đường khớp SKU không-LLM chạy được trên dữ liệu có nhiễu tên hàng.
 *
 * NHÃN: **MÔ PHỎNG**. Mọi mã đơn có tiền tố `MOPHONG-`. Không rút chỉ số
 * hiệu quả kinh doanh nào từ tệp này mà không ghi rõ "trên dữ liệu tự tạo".
 *
 * ĐỊNH DẠNG GIẢ ĐỊNH: Shopee không công khai đặc tả tệp xuất của Seller Centre.
 * Tên cột lấy từ tài liệu bên thứ ba — xem `docs/aisc26/notes/marketplace-format.md`
 * (có URL + ngày + mức độ tin cậy). Không khẳng định tương thích hệ thống thật.
 *
 * NHIỄU TÊN HÀNG (để khớp SKU có việc thật, không phải so chuỗi y hệt):
 *   N0 giữ nguyên   · N1 đổi HOA/THƯỜNG · N2 bỏ 1 từ   · N3 lỗi gõ 1 ký tự
 *   N4 thêm đuôi rác · N5 bỏ CỐ Ý mã hàng (chỉ còn tên)
 * Tất định: PRNG có seed cố định ⇒ chạy lại ra CÙNG tệp, sha256 giống nhau.
 *
 * Đầu ra (thư mục này nằm trong .gitignore, chỉ mã + tài liệu được commit):
 *   data/dataset/marketplace/orders_<from>_<to>.csv     (giả lập, 1 dòng = 1 dòng hàng)
 *   data/dataset/marketplace/orders_<from>_<to>.truth.csv (đáp án thật, KHÔNG có trong tệp xuất thật)
 *   data/dataset/marketplace/MANIFEST.json             (nhãn MÔ PHỎNG + sha256)
 *
 * Dùng: node scripts/dataset/gen-marketplace-orders.js [--days 30] [--seed 20261003]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', 'dataset');
const DAILY_CSV = path.join(DATA_DIR, 'daily_sku.csv');
const NAMES_CSV = path.join(DATA_DIR, 'sku_names.csv');
const OUT_DIR = path.join(DATA_DIR, 'marketplace');

const DEFAULT_DAYS = 30;
const DEFAULT_SEED = 20261003;
const MAX_LINES_PER_ORDER = 3;

/** PRNG tất định (mulberry32) — không dùng Math.random vì phải lặp lại được. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_TAILS = [' - SALE', ' (VN)', ' - HANG MOI', ' [CHUYEN SI]', ' - IMPORT'];

function perturb(name, mode, rng) {
  const words = name.split(/\s+/).filter(Boolean);
  switch (mode) {
    case 1:
      return rng() < 0.5
        ? name.toLowerCase()
        : name
            .toLowerCase()
            .replace(/\b[a-z]/g, (c) => c.toUpperCase());
    case 2: {
      if (words.length < 2) return name;
      const i = Math.floor(rng() * words.length);
      words.splice(i, 1);
      return words.join(' ');
    }
    case 3: {
      const chars = name.split('');
      const i = 1 + Math.floor(rng() * Math.max(1, chars.length - 2));
      chars[i] = String.fromCharCode(97 + Math.floor(rng() * 26));
      return chars.join('');
    }
    case 4:
      return name + NOISE_TAILS[Math.floor(rng() * NOISE_TAILS.length)];
    case 5:
      return name.toUpperCase();
    default:
      return name;
  }
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const out = { days: DEFAULT_DAYS, seed: DEFAULT_SEED };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--days') out.days = Number(argv[++i]);
    if (argv[i] === '--seed') out.seed = Number(argv[++i]);
  }
  if (!Number.isFinite(out.days) || out.days <= 0) out.days = DEFAULT_DAYS;
  if (!Number.isFinite(out.seed)) out.seed = DEFAULT_SEED;
  return out;
};

function main() {
  const { days, seed } = parseArgs();
  for (const f of [DAILY_CSV, NAMES_CSV]) {
    if (!fs.existsSync(f)) {
      console.error(`[mkt] THIẾU ${path.relative(ROOT, f)} — chạy build-daily-sku.js và build-sku-names.js trước`);
      process.exit(1);
    }
  }

  const names = new Map();
  for (const line of fs.readFileSync(NAMES_CSV, 'utf8').split('\n').slice(1)) {
    if (!line) continue;
    const m = line.match(/^([^,]+),"(.*)"$/);
    if (m) names.set(m[1], m[2].replace(/""/g, '"'));
  }

  const rows = fs
    .readFileSync(DAILY_CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const [date, sku, units, revenue, price] = l.split(',');
      return { date, sku, units: Number(units), revenue: Number(revenue), price: Number(price) };
    });

  const allDates = [...new Set(rows.map((r) => r.date))].sort();
  const from = allDates[Math.max(0, allDates.length - days)];
  const to = allDates[allDates.length - 1];
  const win = rows.filter((r) => r.date >= from && r.date <= to);
  console.log(`[mkt] cửa sổ ${from} → ${to} (${days} ngày cuối), ${win.length} dòng SKU×ngày`);

  const rng = makeRng(seed);
  const byDate = new Map();
  for (const r of win) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const outCsv = [
    'Order ID,Order Status,Return / Refund Status,Order Creation Date,Product Name,Variation Name,SKU Reference No.,Original Price,Deal Price,Quantity,Product Subtotal,Seller Voucher,Shopee Voucher,Buyer Paid Shipping Fee,Grand Total,Username (Buyer)',
  ];
  const outTruth = ['order_id,sku,units,deal_price,noise_mode,sku_hidden'];
  let orderNo = 0;
  let lineNo = 0;
  const modeCount = new Map();

  for (const date of [...byDate.keys()].sort()) {
    const pool = byDate.get(date).slice();
    while (pool.length) {
      orderNo += 1;
      const id = `MOPHONG-${date.replace(/-/g, '')}-${String(orderNo).padStart(4, '0')}`;
      const buyer = `kh_mock_${String(((orderNo * 7919) % 1000) + 1).padStart(4, '0')}`;
      const nLines = 1 + Math.floor(rng() * MAX_LINES_PER_ORDER);
      const picked = [];
      for (let i = 0; i < nLines && pool.length; i += 1) {
        picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      }
      const grandTotal = picked.reduce(
        (s, r) => s + r.units * r.price * (0.9 + rng() * 0.1),
        0,
      );
      for (const r of picked) {
        lineNo += 1;
        // 20% dòng CỐ Ý mất mã hàng (chỉ còn tên) — đo được đường khớp bằng TÊN.
        const skuHidden = rng() < 0.2;
        const mode = skuHidden ? Math.floor(rng() * 5) + 1 : Math.floor(rng() * 6);
        const baseName = names.get(r.sku) || `Mã hàng ${r.sku}`;
        const shown = perturb(baseName, mode, rng);
        modeCount.set(mode, (modeCount.get(mode) ?? 0) + 1);
        const deal = Number((r.price * (0.9 + rng() * 0.1)).toFixed(2));
        outCsv.push([
          id,
          'Completed',
          'No Request',
          `${date} 00:00:00`,
          shown,
          '',
          skuHidden ? '' : r.sku,
          r.price.toFixed(2),
          deal.toFixed(2),
          r.units,
          (deal * r.units).toFixed(2),
          '0.00',
          '0.00',
          (3000 + Math.floor(rng() * 3000)).toFixed(2),
          grandTotal.toFixed(2),
          buyer,
        ].map(csvCell).join(','));
        outTruth.push([id, r.sku, r.units, deal.toFixed(2), mode, skuHidden ? '1' : '0'].join(','));
      }
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = `orders_${from}_${to}`;
  const csvPath = path.join(OUT_DIR, `${base}.csv`);
  const truthPath = path.join(OUT_DIR, `${base}.truth.csv`);
  fs.writeFileSync(csvPath, outCsv.join('\n') + '\n', 'utf8');
  fs.writeFileSync(truthPath, outTruth.join('\n') + '\n', 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(csvPath)).digest('hex');

  const manifest = {
    nhan: 'MÔ PHỏNG — KHÔNG phải dữ liệu sàn thật',
    dinhDang: 'ĐỊNH DẠNH GIẢ ĐỊNH (Shopee không công khai đặc tả tệp xuất)',
    nguonDinhDang: 'docs/aisc26/notes/marketplace-format.md',
    seed,
    cuaSo: { tu: from, den: to, soNgay: days },
    soDong: lineNo,
    soDon: orderNo,
    nhieuTen: Object.fromEntries([...modeCount.entries()].sort((a, b) => a[0] - b[0])),
    tepXuat: path.relative(ROOT, csvPath),
    sha256TepXuat: sha,
    tepDapAn: path.relative(ROOT, truthPath),
    canhBao: [
      'Không rút chỉ số hiệu quả kinh doanh nào từ tệp này mà không ghi nhãn "trên dữ liệu tự tạo".',
      'Grand Total lặp lại ở mọi dòng của cùng một Order ID (đúng như đặc tả giả định) ⇒ cộng cột này sẽ đếm thừa.',
      'Tệp .truth.csv là đáp án sinh ra cùng lúc, KHÔNG tồn tại trong tệp xuất thật của sàn.',
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[mkt] ${orderNo} đơn / ${lineNo} dòng hàng`);
  console.log(`[mkt] ghi ${path.relative(ROOT, csvPath)}`);
  console.log(`[mkt] sha256 ${sha}`);
  console.log(`[mkt] phân bố nhiễu tên (0=giữ nguyên, 5=bỏ mã): ${JSON.stringify(manifest.nhieuTen)}`);
}

main();