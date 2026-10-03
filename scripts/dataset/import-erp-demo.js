'use strict';

/**
 * T9 — NẠP DỮ LIỆU VÀO ERP DEMO (idempotent, dry-run mặc định, chạy trong tenant context)
 *
 * Nguồn: data/dataset/daily_sku.csv + data/dataset/sku_names.csv (UCI Online Retail II,
 *        CÔNG KHAI — xem docs/aisc26/02-data.md) và data/dataset/marketplace/orders_*.csv
 *        (MÔ PHỎNG — xem docs/aisc26/notes/marketplace-format.md).
 *
 * CÓ GÌ ĐƯỢC NẠP
 *   1. Danh mục: 1 category, 1 kho, 1 NCC, 500 sản phẩm (SKU = StockCode, tên thật
 *      lấy từ `sku_names.csv`), 500 dòng tồn kho + 500 giao dịch tồn đầu kỳ.
 *   2. Đơn hàng mô phỏng từ tệp xuất sàn: khách ẩn danh + `orders` + `order_items`
 *      ghi LỒNG (nested create) trong `runWithTenant`.
 *   3. Hàng đợi "cần người xác nhận" của khớp SKU được GHI RA TỆP, không tự quyết.
 *
 * IDEMPOTENT: sản phẩm upsert theo (tenantId, sku); đơn có `orderCode` = chính
 * `Order ID` trong tệp (đã `@unique`) nên chạy lại chỉ bỏ qua, không nhân bản.
 * `inventory` upsert theo (productId, warehouseId).
 *
 * AN TOÀN (NIGHT-PROMPT.md §3): chỉ DB local (`assertLocalDb`), **dry-run là mặc
 * định**, phải `--apply` mới ghi, `--reset` xoá đúng thứ tự phụ thuộc, mọi ghi
 * tenant-scoped đều đi qua `runWithTenant` của `src/config/tenantContext.js`.
 *
 * GIẢ ĐỊNH PHẢI GHI (không đo được từ dataset — 02-data.md §6):
 *   A1 dataset KHÔNG có tồn kho ⇒ `minStock` = p90 số lượng/ngày trong cửa sổ (làm
 *      tròn lên, tối thiểu 1) và tồn đầu kỳ là HẰNG SỐ MÔ PHỎNG (xem MIN_STOCK_GUESS).
 *   A2 dataset KHÔNG có giá vốn ⇒ `costPrice = price` (giá niêm yết), và mọi cờ
 *      MISSING_COST vẫn chạy được vì trường NOT NULL.
 *   A3 tiền tệ GBP giữ nguyên, KHÔNG quy đổi sang VND.
 *
 * Dùng:
 *   node scripts/dataset/import-erp-demo.js                  # dry-run (mặc định)
 *   node scripts/dataset/import-erp-demo.js --apply          # ghi thật vào DB local
 *   node scripts/dataset/import-erp-demo.js --apply --days 7 # giới hạn cửa sổ đơn
 *   node scripts/dataset/import-erp-demo.js --reset           # xoá sạch tenant demo
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { assertLocalDb } = require('../lib/assert-local-db');
assertLocalDb('import-erp-demo');

const prisma = require('../../src/config/prisma');
const { runWithTenant } = require('../../src/config/tenantContext');
const { SkuMatcher, MATCH_STATUS } = require('../../src/modules/import/sku-matcher');
const logger = require('../../src/utils/logger');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', 'dataset');
const MKT_DIR = path.join(DATA_DIR, 'marketplace');
const DAILY_CSV = path.join(DATA_DIR, 'daily_sku.csv');
const NAMES_CSV = path.join(DATA_DIR, 'sku_names.csv');
const QUEUE_CSV = path.join(DATA_DIR, 'sku-review-queue.csv');

const SLUG = 'omni-demo-mo-phong';
const TENANT_NAME = 'OMNI DEMO (MÔ PHỎNG — dữ liệu UCI Online Retail II)';
const WAREHOUSE_CODE = 'KHO-MOPHONG';
const CATEGORY_NAME = 'Hàng quà tặng (MÔ PHỎNG)';
const VENDOR_CODE = 'NCC-MOPHONG';
const VENDOR_NAME = 'Nhà cung cấp giả định (MÔ PHỎNG)';
const CURRENCY = 'GBP';

// Số lần chạy lại chấp nhận được về tồn đầu kỳ (giả định A1): 3× p50 lượng
// bán/ngày — đủ để phần lớn SKU không "hết hàng", còn một phần nhỏ cố ý thấp để
// luồng demo "cảnh báo sắp hết hàng" có dữ liệu.
const OPENING_DAYS_OF_SUPPLY = 3;
// Cứ mỗi N SKU theo thứ tự mã thì đặt tồn thấp hơn minStock để tạo tình huống
// sắp hết hàng. Tất định, không ngẫu nhiên.
const LOW_STOCK_EVERY = 4;
// Chia lô ghi vào DB để không giữ transaction quá dài.
const ORDER_CHUNK = 150;

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const out = { apply: false, reset: false, days: 30, maxOrders: 1500 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') out.apply = true;
    if (argv[i] === '--reset') out.reset = true;
    if (argv[i] === '--days') out.days = Number(argv[++i]);
    if (argv[i] === '--max-orders') out.maxOrders = Number(argv[++i]);
  }
  if (!Number.isFinite(out.days) || out.days <= 0) out.days = 30;
  if (!Number.isFinite(out.maxOrders) || out.maxOrders <= 0) out.maxOrders = 1500;
  return out;
};

const readCsv = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').filter(Boolean);
};

/** Bộ tách CSV tối giản (phân cách phẩy, `""` escape). Đủ cho tệp do script này sinh. */
const parseCsvLine = (line) => {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
};

const quantile = (sorted, p) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
};

const round2 = (n) => Math.round(n * 100) / 100;

function loadCatalogStats() {
  const names = new Map();
  for (const line of readCsv(NAMES_CSV).slice(1)) {
    const m = line.match(/^([^,]+),"(.*)"$/);
    if (m) names.set(m[1], m[2].replace(/""/g, '"'));
  }
  const dailyBySku = new Map();
  const dates = new Set();
  for (const line of readCsv(DAILY_CSV).slice(1)) {
    const [date, sku, units, revenue, price] = line.split(',');
    if (!dates.has(date)) dates.add(date);
    if (!dailyBySku.has(sku)) dailyBySku.set(sku, []);
    dailyBySku.get(sku).push({ date, units: Number(units), price: Number(price), revenue: Number(revenue) });
  }
  return { names, dailyBySku, dates: [...dates].sort() };
}

function newestMarketplaceFile() {
  if (!fs.existsSync(MKT_DIR)) return null;
  const files = fs.readdirSync(MKT_DIR).filter((f) => /^orders_.*\.csv$/.test(f) && !f.endsWith('.truth.csv'));
  if (!files.length) return null;
  files.sort();
  return path.join(MKT_DIR, files[files.length - 1]);
}

/** Đọc tệp xuất sàn mô phỏng → map theo Order ID, giữ dòng hàng lồng. */
function readMarketplace(file, days) {
  const lines = readCsv(file);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const need = ['Order ID', 'Order Creation Date', 'Product Name', 'SKU Reference No.', 'Quantity', 'Deal Price', 'Grand Total', 'Username (Buyer)'];
  const missing = need.filter((c) => idx[c] === undefined);
  if (missing.length) {
    console.error(`[import] tệp xuất thiếu cột: ${missing.join(', ')} — xem docs/aisc26/notes/marketplace-format.md`);
    process.exit(1);
  }
  const maxDate = lines.slice(1).reduce((m, l) => {
    const d = l.length ? parseCsvLine(l)[idx['Order Creation Date']].slice(0, 10) : '';
    return d > m ? d : m;
  }, '');
  const fromDate = new Date(`${maxDate}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  const minDate = fromDate.toISOString().slice(0, 10);

  const orders = new Map();
  let skippedOutOfWindow = 0;
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const date = c[idx['Order Creation Date']].slice(0, 10);
    if (date < minDate) { skippedOutOfWindow += 1; continue; }
    const id = c[idx['Order ID']];
    if (!orders.has(id)) {
      orders.set(id, {
        orderCode: id,
        createdAt: new Date(`${date}T09:00:00Z`),
        buyer: c[idx['Username (Buyer)']],
        grandTotal: Number(c[idx['Grand Total']]) || 0,
        items: [],
      });
    }
    orders.get(id).items.push({
      name: c[idx['Product Name']],
      sku: c[idx['SKU Reference No.']].trim(),
      qty: Number(c[idx['Quantity']]) || 0,
      price: Number(c[idx['Deal Price']]) || 0,
    });
  }
  return { orders, minDate, maxDate, skippedOutOfWindow };
}

/** Xoá sạch tenant demo theo thứ tự phụ thuộc (con → cha). */
async function resetTenant(tenantId) {
  const order = [
    ['orderItem', { order: { tenantId } }],
    ['order', { tenantId }],
    ['inventoryTransaction', { inventory: { tenantId } }],
    ['inventory', { tenantId }],
    ['product', { tenantId }],
    ['category', { tenantId }],
    ['customer', { tenantId }],
    ['warehouse', { tenantId }],
    ['vendor', { tenantId }],
    ['auditLog', { tenantId }],
    ['user', { tenantId }],
  ];
  for (const [model, where] of order) {
    await prisma[model].deleteMany({ where });
  }
  await prisma.tenant.delete({ where: { id: tenantId } });
}

async function main() {
  const opts = parseArgs();
  const stats = loadCatalogStats();

  const mktFile = newestMarketplaceFile();
  if (!mktFile) {
    console.error('[import] chưa có tệp xuất sàn mô phỏng — chạy: node scripts/dataset/gen-marketplace-orders.js');
    process.exit(1);
  }
  const mkt = readMarketplace(mktFile, opts.days);
  let mktList = [...mkt.orders.values()];
  if (mktList.length > opts.maxOrders) {
    mktList = mktList.slice(0, opts.maxOrders);
  }
  console.log(`[import] tệp xuất: ${path.relative(ROOT, mktFile)}`);
  console.log(`[import] cửa sổ ${mkt.minDate} → ${mkt.maxDate}; bỏ ${mkt.skippedOutOfWindow} dòng ngoài cửa sổ; giữ ${mktList.length}/${mkt.orders.size} đơn`);

  // --- catalog + SKU matching KHÔNG LLM -------------------------------------
  const catalog = [...stats.dailyBySku.keys()].sort().map((sku) => ({
    sku,
    name: stats.names.get(sku) || `Mã hàng ${sku}`,
  }));
  const matcher = new SkuMatcher(catalog);

  const productBySku = new Map();
  const plan = [];
  let lineTotal = 0;
  let unknownItem = 0;
  for (const o of mktList) {
    const items = [];
    let sub = 0;
    for (const it of o.items) {
      const r = matcher.match(it.name, { inputSku: it.sku || undefined });
      if (r.status === MATCH_STATUS.NO_MATCH) { unknownItem += 1; continue; }
      productBySku.set(r.sku, true);
      if (it.qty <= 0) continue;
      items.push({ productSku: r.sku, quantity: it.qty, price: round2(it.price), status: r.status, score: r.score });
      sub += it.qty * it.price;
    }
    lineTotal += items.length;
    if (items.length) {
      plan.push({ orderCode: o.orderCode, createdAt: o.createdAt, buyer: o.buyer, items, sub: round2(sub) });
    }
  }

  // Hàng đợi người xác nhận: ghi ra TỆP, không tự quyết ở bất kỳ đâu trong mã.
  const reviewRows = [
    'order_id,product_name,input_sku,status,score,reason,top_candidates',
    '#NHAN,MO PHONG — dien giai nhuoc: nguoi xac nhan truoc khi nhap,,,,,',
  ];
  const perOrderQueue = new Map();
  for (const o of mktList) {
    for (const it of o.items) {
      const r = matcher.match(it.name, { inputSku: it.sku || undefined });
      if (r.status === MATCH_STATUS.AUTO) continue;
      perOrderQueue.set(o.orderCode, (perOrderQueue.get(o.orderCode) ?? 0) + 1);
      reviewRows.push([
        o.orderCode,
        it.name,
        it.sku || '',
        r.status,
        r.score,
        r.reason,
        (r.candidates || []).map((c) => `${c.sku}:${c.total.toFixed(3)}`).join(' | '),
      ].map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','));
    }
  }
  const plannedOrders = plan.filter((p) => !perOrderQueue.has(p.orderCode)).length;
  // Đơn nào còn dòng hàng chưa đủ tin cậy thì KHÔNG nhập: nhập nửa vời sẽ tạo đơn
  // thiếu dòng hàng, mà `Grand Total` của tệp xuất vẫn ghi trọn ⇒ sai số.
  const planToWrite = plan.filter((p) => !perOrderQueue.has(p.orderCode));

  console.log('[import] KHỚP SKU KHÔNG LLM (trên dữ liệu tự tạo):');
  console.log(`         dòng hàng đọc vào: ${lineTotal + unknownItem}; dòng hàng sẽ nhập: ${lineTotal}`);
  console.log(`         ngưỡng tự ghi ${matcher.constructor.name ? 'AUTO_ACCEPT' : ''} = 0.86, ngưỡng xem lại = 0.62`);
  console.log(`         SKU không khớp (bỏ, có trong hàng đợi): ${unknownItem}`);
  console.log(`         đơn sẽ nhập (mọi dòng hàng đủ tin cậy): ${plannedOrders}/${plan.length}`);
  console.log(`         đơn giữ lại chờ người xác nhận: ${perOrderQueue.size}`);
  console.log(`         hàng đợi "cần người xác nhận" → ${path.relative(ROOT, QUEUE_CSV)}`);

  if (!opts.apply) {
    if (!opts.reset) {
      console.log('[import] DRY-RUN (mặc định): KHÔNG ghi gì. Thêm --apply để ghi vào DB local.');
      return;
    }
  }

  if (!opts.apply && opts.reset) {
    console.log('[import] DRY-RUN --reset: KHÔNG xoá gì. Thêm --apply để xoá.');
    return;
  }

  // --- ghi thật --------------------------------------------------------------
  let tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });

  if (opts.reset) {
    if (!tenant) {
      console.log(`[import] không có tenant ${SLUG} — không cần --reset`);
      return;
    }
    const tid = tenant.id;
    await prisma.$transaction(async (tx) => {
      for (const [model, where] of [
        ['orderItem', { order: { tenantId: tid } }],
        ['order', { tenantId: tid }],
        ['inventoryTransaction', { inventory: { tenantId: tid } }],
        ['inventory', { tenantId: tid }],
        ['product', { tenantId: tid }],
        ['category', { tenantId: tid }],
        ['customer', { tenantId: tid }],
        ['warehouse', { tenantId: tid }],
        ['vendor', { tenantId: tid }],
        ['auditLog', { tenantId: tid }],
        ['user', { tenantId: tid }],
      ]) {
        await tx[model].deleteMany({ where });
      }
    });
    await prisma.tenant.delete({ where: { id: tid } });
    console.log(`[import] đã xoá tenant demo ${tid}`);
    tenant = null;
  }

  if (!tenant) tenant = await prisma.tenant.create({ data: { name: TENANT_NAME, slug: SLUG } });
  const tenantId = tenant.id;
  console.log(`[import] tenant: ${tenant.name} (${tenantId})`);

  const result = await runWithTenant(tenantId, async () => {
    // ID tất định cho MỌI bản ghi cha. `user.email`, `warehouse.code`, `vendor.code`
    // là UNIQUE toàn cục ⇒ nếu dùng `create` thì lần chạy thứ hai vỡ, tức là
    // script KHÔNG idempotent. Upsert theo `id` tất định là cách duy nhất vừa
    // chạy lại được vừa không cần dọn dữ liệu trước.
    const user = await prisma.user.upsert({
      where: { id: `${tenantId}:demo-user` },
      create: {
        id: `${tenantId}:demo-user`,
        tenantId,
        email: 'demo-mo-phong@local.invalid',
        password: 'khong-dang-nhap-duoc',
        fullName: 'Kế toán demo (MÔ PHỎNG)',
        role: 'ADMIN',
      },
      update: {},
    });

    const category = await prisma.category.upsert({
      where: { id: `${tenantId}:cat-hang-qua-tang` },
      create: {
        id: `${tenantId}:cat-hang-qua-tang`, tenantId, name: CATEGORY_NAME,
        description: 'Nhãn MÔ PHỎNG — không phải danh mục thật của doanh nghiệp nào',
      },
      update: {},
    });
    const warehouse = await prisma.warehouse.upsert({
      where: { id: `${tenantId}:wh-main` },
      create: { id: `${tenantId}:wh-main`, tenantId, code: WAREHOUSE_CODE, name: 'Kho mô phỏng', isDefault: true },
      update: {},
    });
    const vendor = await prisma.vendor.upsert({
      where: { id: `${tenantId}:vendor-chinh` },
      create: { id: `${tenantId}:vendor-chinh`, tenantId, code: VENDOR_CODE, name: VENDOR_NAME, paymentTerms: 7 },
      update: {},
    });

    // --- sản phẩm + tồn (giả định A1) ------------------------------------
    const skus = [...stats.dailyBySku.keys()].sort();
    let created = 0;
    for (let i = 0; i < skus.length; i += 1) {
      const sku = skus[i];
      const days = stats.dailyBySku.get(sku).map((d) => d.units).sort((a, b) => a - b);
      const p50 = quantile(days, 0.5);
      const p90 = quantile(days, 0.9);
      const prices = stats.dailyBySku.get(sku).map((d) => d.price).filter((p) => p > 0).sort((a, b) => a - b);
      const price = round2(quantile(prices, 0.5));
      const minStock = Math.max(1, Math.ceil(p90));
      const opening = i % LOW_STOCK_EVERY === 0
        ? Math.max(0, Math.floor(minStock / 2))          // cố ý thấp để demo luồng sắp hết hàng
        : Math.round(p50 * OPENING_DAYS_OF_SUPPLY);

      const product = await prisma.product.upsert({
        where: { id: `${tenantId}:${sku}` },
        create: {
          id: `${tenantId}:${sku}`,
          tenantId, sku,
          name: stats.names.get(sku) || `Mã hàng ${sku}`,
          description: `Nguồn: UCI Online Retail II (CÔNG KHAI). costPrice = price (giả định A2, dataset không có giá vốn).`,
          price, costPrice: price, unit: 'cái', categoryId: category.id,
        },
        update: { name: stats.names.get(sku) || `Mã hàng ${sku}`, price, costPrice: price },
      });
      created += 1;

      const inventory = await prisma.inventory.upsert({
        where: { id: `${tenantId}:${sku}:${warehouse.id}` },
        create: { id: `${tenantId}:${sku}:${warehouse.id}`, tenantId, productId: product.id, warehouseId: warehouse.id, quantity: opening, minStock },
        update: { quantity: opening, minStock },
      });
      const openingTx = await prisma.inventoryTransaction.findFirst({
        where: { inventoryId: inventory.id, type: 'ADJUSTMENT', note: 'Tồn đầu kỳ (MÔ PHỎNG — A1)' },
      });
      if (!openingTx) {
        await prisma.inventoryTransaction.create({
          data: {
            tenantId, inventoryId: inventory.id, type: 'ADJUSTMENT', quantity: opening,
            note: 'Tồn đầu kỳ (MÔ PHỎNG — giả định A1, dataset không có tồn kho)',
            unitCost: price, createdById: user.id,
          },
        });
      }
    }

    // --- khách ẩn danh (không PII) ----------------------------------------
    // ID tất định theo TÊN MÔ PHỎNG của buyer trong tệp xuất, KHÔNG theo thứ tự
    // duyệt: nếu id gắn với vị trí trong danh sách thì đổi `--days` sẽ sinh
    // trùng khách. `buyer` đã là `kh_mock_NNNN` nên an toàn dùng thẳng vào id.
    const buyerNames = [...new Set(planToWrite.map((o) => o.buyer))].sort();
    const customerByBuyer = new Map();
    for (let i = 0; i < buyerNames.length; i += 1) {
      const buyer = buyerNames[i];
      const customer = await prisma.customer.upsert({
        where: { id: `${tenantId}:cust:${buyer}` },
        create: {
          id: `${tenantId}:cust:${buyer}`,
          tenantId,
          name: `Khách mô phỏng ${buyer.replace('kh_mock_', '#')}`,
          // `phone` unique theo (phone, tenantId) nên phải sinh TỪ CHÍNH `buyer`, không
          // được theo vị trí `i`: đổi `--days` sẽ đổi thứ tự rồi trùng số.
          phone: `09${(buyer.match(/(\d+)$/)?.[1] ?? '0').padStart(8, '0')}`,
          tier: 'BRONZE',
        },
        update: {},
      });
      customerByBuyer.set(buyer, customer.id);
    }

    // --- đơn + dòng hàng lồng --------------------------------------------
    // Chỉ `planToWrite`: đơn còn dòng chờ người xác nhận KHÔNG được nhập vội.
    const existing = new Set((await prisma.order.findMany({ where: { orderCode: { in: planToWrite.map((p) => p.orderCode) } }, select: { orderCode: true } })).map((o) => o.orderCode));
    let createdOrders = 0;
    let skippedOrders = 0;
    let createdLines = 0;
    // Vòng lặp `for` + `continue` làm lệch số: `continue` bỏ qua phần nhảy `i`, nên
    // cùng một lô bị đếm lại nhiều lần (`skippedOrders` chạy tới 142575 cho 1025
    // đơn). Dùng `while` với bước tường minh để con số báo cáo đáng tin.
    let cursor = 0;
    while (cursor < planToWrite.length) {
      const chunk = planToWrite.slice(cursor, cursor + ORDER_CHUNK);
      cursor += chunk.length;
      const writable = chunk.filter((p) => !existing.has(p.orderCode));
      skippedOrders += chunk.length - writable.length;
      if (!writable.length) continue;
      await prisma.$transaction(async (tx) => {
        for (const o of writable) {
          const total = round2(o.sub);
          await tx.order.create({
            data: {
              tenantId,
              orderCode: o.orderCode,
              status: 'COMPLETED',
              paymentMethod: 'BANK_TRANSFER',
              paymentStatus: 'PAID',
              subtotal: total, total,
              currency: CURRENCY, exchangeRate: 1,
              channel: 'SHOPEE',
              note: 'MÔ PHỎNG — sinh từ data/dataset/marketplace (không phải đơn thật)',
              orderType: 'DELIVERY',
              createdAt: o.createdAt,
              updatedAt: o.createdAt,
              customerId: customerByBuyer.get(o.buyer),
              warehouseId: warehouse.id,
              createdById: user.id,
              items: {
                create: o.items.map((it) => ({
                  tenantId,
                  productId: `${tenantId}:${it.productSku}`,
                  quantity: it.quantity,
                  price: it.price,
                  subtotal: round2(it.price * it.quantity),
                  status: 'SERVED',
                })),
              },
            },
          });
          createdOrders += 1;
          createdLines += o.items.length;
        }
      });
    }

    return {
      created, createdOrders, skippedOrders, createdLines,
      customers: buyerNames.length,
      warehouseId: warehouse.id, vendorId: vendor.id, userId: user.id,
    };
  });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_CSV, reviewRows.join('\n') + '\n', 'utf8');

  console.log('[import] ĐÃ GHI (DB local):');
  console.log(`         sản phẩm upsert: ${result.created}`);
  console.log(`         đơn tạo mới: ${result.createdOrders} (bỏ qua vì đã có: ${result.skippedOrders} — idempotent)`);
  console.log(`         dòng hàng lồng: ${result.createdLines}`);
  console.log(`         khách ẩn danh: ${result.customers}`);
  console.log(`         hàng đợi người xác nhận: ${reviewRows.length - 2} dòng → ${path.relative(ROOT, QUEUE_CSV)}`);
  console.log('[import] kiểm tra tiếp: npm run tenant:null -- --scan  (mọi bảng scoped phải = 0 mồ côi)');
}

main().catch((e) => {
  logger.error(`[import] LỖI: ${e.stack || e.message}`);
  console.error(`[import] LỖI: ${e.stack || e.message}`);
  process.exit(1);
});