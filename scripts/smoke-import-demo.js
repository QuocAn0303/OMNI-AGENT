'use strict';

/**
 * T9 — NGHIỆM THU GÓI P4 TRÊN DB THẬT (không mock).
 *
 * Vì sao cần: gói P4 giao "script nạp idempotent + `tenant-null --scan` = 0 sau
 * import + smoke trên DB thật". Unit test với mock Prisma KHÔNG chứng minh được
 * rằng dòng hàng lồng ghi đúng tenant, không rò sang tenant khác, và không tự
 * quyết ở chỗ lẽ ra phải hỏi người. Script này đo trên DB local thật.
 *
 * Mọi khẳng định đều là bất biến kiểm được, không phải con số "cho có":
 *   K1  không còn mồ côi-tenant ở bất kỳ bảng scoped nào (đọc trực tiếp
 *       information_schema, không đọc danh sách cứng)
 *   K2  mọi bản ghi của tenant demo có `tenantId` khớp; 0 NULL
 *   K3  KHÔNG dòng hàng nào trỏ tới sản phẩm của tenant khác (chứng minh nested
 *       write giữ được cách ly tenant)
 *   K4  mọi mã đơn trong DB đều có trong tệp xuất sàn ⇒ không có đơn bịa
 *   K5  mọi dòng hàng khớp đúng (mã hàng, số lượng, giá) với tệp xuất ⇒ truy vết
 *       được từ ERP ngược về tệp gốc
 *   K6  số SKU trong ERP = số SKU trong `daily_sku.csv`, tập mã bằng nhau
 *   K7  CÓ ít nhất một SKU dưới `minStock` (tiền đề của luồng demo P6)
 *   K8  hai tenant thật giữ nguyên số đã ký (CANDORY 82 đơn / 158 dòng / 89.862.000)
 *   K9  độ chính xác của đường khớp SKU: AUTO_ACCEPT KHÔNG được sai lần nào
 *       (sai 1 lần là âm thầm ghi dữ liệu sai); phần còn lại đo bằng TRUTH.csv
 *       và LUÔN gắn nhãn "trên dữ liệu tự tạo"
 *
 * Chạy: npm run smoke:import-demo
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { assertLocalDb } = require('./lib/assert-local-db');
assertLocalDb('smoke-import-demo');

const prisma = require('../src/config/prisma');
const { SkuMatcher, MATCH_STATUS } = require('../src/modules/import/sku-matcher');
const { listScopedTables } = require('./lib/teardown');
const { DEMO_ORDER_PREFIX } = require('./demo/demo-flow');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'dataset');
const MKT_DIR = path.join(DATA_DIR, 'marketplace');
const DEMO_SLUG = 'omni-demo-mo-phong';

// Số đã ký trong STATE.md — KHÔNG tự đổi, lệch là smoke FAIL.
const SIGNED = { slug: 'candory-scent', orders: 82, items: 158, totalVnd: 89862000 };

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label}${extra ? ` → ${extra}` : ''}`);
  if (cond) pass += 1;
  else fail += 1;
};

/**
 * `K4/K5`: mọi đơn trong DB phải có trong tệp xuất, và dòng hàng phải khớp đúng.
 *
 * Vì sao có `DEMO_ORDER_PREFIX`: luồng demo P6 (`scripts/demo/demo-flow.js`) tạo
 * MỘT đơn thật trong chính tenant demo để chứng minh "đơn → CDC → đề xuất". Đơn đó
 * cố Ý **không** nằm trong tệp xuất sàn ⇒ nếu K4 không loại nó thì smoke sẽ báo
 * "đơn bịa" và mỗi lần chạy luồng demo lại FAIL một lần. Ta loại theo MÃ ĐƠN có
 * tiền tố hằng số, không theo điều kiện mơ hồ.
 */

const csvLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
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

function newestMarketplace() {
  const files = fs.readdirSync(MKT_DIR)
    .filter((f) => /^orders_.*\.csv$/.test(f) && !f.endsWith('.truth.csv'))
    .sort();
  if (!files.length) throw new Error('chưa có tệp xuất sàn mô phỏng — chạy gen-marketplace-orders.js');
  return path.join(MKT_DIR, files[files.length - 1]);
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    console.error(`[smoke] KHÔNG có tenant demo ${DEMO_SLUG}. Chạy: node scripts/dataset/import-erp-demo.js --apply`);
    process.exit(1);
  }
  const tid = tenant.id;
  console.log(`[smoke] tenant demo: ${tenant.name} (${tid})`);

  // K1 — mồ côi-tenant trên TOÀN BỘ bảng scoped, đọc từ information_schema.
  const tables = await listScopedTables(prisma);
  const orphans = [];
  for (const t of tables) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${t}" WHERE "tenantId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = "${t}"."tenantId")`,
    );
    if (r[0].n > 0) orphans.push(`${t}=${r[0].n}`);
  }
  ok('K1 mồ côi-tenant = 0 ở mọi bảng scoped', orphans.length === 0, orphans.join(', ') || `${tables.length} bảng đã quét`);

  // K2 — tenantId của bản ghi demo luôn khớp, không NULL.
  const nullDemo = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM orders WHERE "tenantId" = $1`, tid,
  );
  const crossItems = await prisma.orderItem.findMany({
    where: { order: { tenantId: tid } },
    select: { tenantId: true, product: { select: { tenantId: true } } },
  });
  const badTenant = crossItems.filter((i) => i.tenantId !== tid).length;
  ok('K2 dòng hàng của tenant demo có tenantId đúng', badTenant === 0 && nullDemo[0].n > 0, `${nullDemo[0].n} đơn, ${crossItems.length} dòng`);

  // K3 — không dòng hàng nào trỏ sản phẩm của tenant khác (cách ly nested write).
  const foreignProduct = crossItems.filter((i) => i.product.tenantId !== tid).length;
  ok('K3 không dòng hàng nào trỏ sản phẩm tenant khác', foreignProduct === 0, `vi phạm=${foreignProduct}`);

  // K4/K5 — truy vết ngược từ ERP về tệp xuất.
  const file = newestMarketplace();
  const lines = csvLines(file);
  const head = parseCsvLine(lines[0]);
  const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const truthPath = file.replace(/\.csv$/, '.truth.csv');
  // Đáp án sinh CÙNG lúc với tệp xuất, cùng thứ tự dòng ⇒ ghép theo CHỈ SỐ DÒNG.
  // Không được so "SKU đầu tiên của đơn": một đơn có nhiều dòng hàng, mỗi dòng một
  // SKU khác nhau — so vậy ra kết quả sai (lần chạy đầu báo sai 50%).
  const truthRows = csvLines(truthPath).slice(1);
  const rowTruth = new Map();
  for (let i = 0; i < lines.length - 1; i += 1) rowTruth.set(i, truthRows[i]?.split(',') ?? []);

  const allOrders = await prisma.order.findMany({
    where: { tenantId: tid },
    select: {
      orderCode: true, subtotal: true, note: true,
      items: { select: { quantity: true, price: true, product: { select: { sku: true } } } },
    },
  });
  // Đơn của luồng demo P6 được tạo CỐ Ý ngoài tệp xuất (note có tiền tố
  // DEMO_ORDER_PREFIX) — loại khỏi K4/K5, KHÔNG phải vì "bỏ qua lỗi": nó được
  // nhận diện bằng mã đặt biệt do chính `demo-flow.js` ghi vào.
  const isDemoFlow = (o) => String(o.note || '').startsWith(DEMO_ORDER_PREFIX);
  const demoFlowOrders = allOrders.filter(isDemoFlow);
  const dbOrders = allOrders.filter((o) => !isDemoFlow(o));
  const fileOrders = new Set([...lines.slice(1)].map((l) => parseCsvLine(l)[ix['Order ID']]));
  const invented = dbOrders.filter((o) => !fileOrders.has(o.orderCode));
  ok('K4 không có đơn nào ngoài tệp xuất (không bịa đơn)', invented.length === 0,
    `db=${dbOrders.length} đơn (cộng ${demoFlowOrders.length} đơn luồng demo P6), tệp=${fileOrders.size} đơn, bịa=${invented.length}`);

  // Mỗi đơn: so ĐA TẬP (multiset) dòng hàng, vì thứ tự dòng trong DB không bảo đảm
  // theo thứ tự tệp. Khoá so = sku|số lượng|giá.
  const expectedByOrder = new Map();
  for (let i = 0; i < lines.length - 1; i += 1) {
    const c = parseCsvLine(lines[i + 1]);
    const t = rowTruth.get(i);
    const sku = c[ix['SKU Reference No.']].trim() || t?.[1] || '';
    const key = `${c[ix['Order ID']]}|${sku}|${Number(c[ix['Quantity']]) || 0}|${(Number(c[ix['Deal Price']]) || 0).toFixed(2)}`;
    expectedByOrder.set(key, (expectedByOrder.get(key) ?? 0) + 1);
  }
  let mismatch = 0;
  const badSample = [];
  for (const o of dbOrders) {
    const actual = new Map();
    for (const it of o.items) {
      const key = `${o.orderCode}|${it.product.sku}|${it.quantity}|${Number(it.price).toFixed(2)}`;
      actual.set(key, (actual.get(key) ?? 0) + 1);
    }
    for (const [key, n] of expectedByOrder) {
      if (!key.startsWith(`${o.orderCode}|`)) continue;
      const got = actual.get(key) ?? 0;
      if (got !== n) {
        mismatch += 1;
        if (badSample.length < 3) badSample.push(`${key} mong đợi ${n}, ERP có ${got}`);
      }
    }
    for (const [key, n] of actual) {
      const want = expectedByOrder.get(key) ?? 0;
      if (want !== n) {
        mismatch += 1;
        if (badSample.length < 3) badSample.push(`${key} ERP thừa (tệp có ${want})`);
      }
    }
  }
  ok('K5 dòng hàng khớp (SKU, số lượng, giá) với tệp xuất', mismatch === 0,
    `đơn kiểm=${dbOrders.length}, lệch=${mismatch}${badSample.length ? ` | ${badSample.join(' ; ')}` : ''}`);

  // K6 — tập SKU trong ERP khớp tập SKU của dataset.
  const dbSkus = (await prisma.product.findMany({ where: { tenantId: tid }, select: { sku: true } })).map((p) => p.sku).sort();
  const csvSkus = [...new Set(csvLines(path.join(DATA_DIR, 'daily_sku.csv')).slice(1).map((l) => l.split(',')[1]))].sort();
  const setEq = dbSkus.length === csvSkus.length && dbSkus.every((s, i) => s === csvSkus[i]);
  ok('K6 tập SKU trong ERP = tập SKU dataset', setEq, `${dbSkus.length} vs ${csvSkus.length}`);

  // K7 — có SKU dưới minStock (tiền đề luồng demo P6).
  const below = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM inventories WHERE "tenantId" = $1 AND quantity < "minStock"', tid,
  );
  ok('K7 có SKU dưới minStock (tiền đề demo)', below[0].n > 0, `${below[0].n} SKU`);

  // K8 — hai tenant thật giữ nguyên số đã ký.
  const real = await prisma.order.findMany({ where: { tenantId: { not: tid } }, select: { tenantId: true, total: true } });
  const realItems = await prisma.orderItem.count({ where: { order: { tenantId: { not: tid } } } });
  const byTenant = new Map();
  for (const o of real) {
    const e = byTenant.get(o.tenantId) ?? { orders: 0, total: 0 };
    e.orders += 1;
    e.total += Number(o.total);
    byTenant.set(o.tenantId, e);
  }
  const signedTenant = await prisma.tenant.findUnique({ where: { slug: SIGNED.slug } });
  const s = byTenant.get(signedTenant?.id);
  ok('K8 tenant thật giữ nguyên số đã ký', Boolean(s) && s.orders === SIGNED.orders && realItems === SIGNED.items && Math.round(s.total) === SIGNED.totalVnd,
    `${SIGNED.slug}: ${s?.orders ?? '?'} đơn / ${realItems} dòng / ${Math.round(s?.total ?? 0).toLocaleString('vi-VN')} VND`);

  // K9 — độ chính xác đường khớp SKU KHÔNG LLM (nhãn: trên dữ liệu tự tạo).
  const names = new Map();
  for (const l of csvLines(path.join(DATA_DIR, 'sku_names.csv')).slice(1)) {
    const m = l.match(/^([^,]+),"(.*)"$/);
    if (m) names.set(m[1], m[2]);
  }
  const matcher = new SkuMatcher([...names.keys()].sort().map((k) => ({ sku: k, name: names.get(k) })));
  let auto = 0; let autoRight = 0; let autoWrong = 0; let review = 0; let noMatch = 0; let skuHidden = 0;
  const wrongSamples = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const c = parseCsvLine(lines[i + 1]);
    const truthSku = rowTruth.get(i)?.[1];
    const sku = c[ix['SKU Reference No.']].trim();
    if (!sku) skuHidden += 1;
    const r = matcher.match(c[ix['Product Name']], { inputSku: sku || undefined });
    if (r.status === MATCH_STATUS.AUTO) {
      auto += 1;
      if (r.sku === truthSku) autoRight += 1;
      else {
        autoWrong += 1;
        if (wrongSamples.length < 3) wrongSamples.push(`"${c[ix['Product Name']]}" → ${r.sku} (thật ${truthSku})`);
      }
    } else if (r.status === MATCH_STATUS.REVIEW) review += 1;
    else noMatch += 1;
  }
  const total = auto + review + noMatch;
  console.log('[smoke] KHỚP SKU KHÔNG LLM — số đo trên DỮ LIỆU TỰ TẠO (không phải sàn thật):');
  console.log(`         dòng hàng: ${total} | ẩn mã: ${skuHidden} | AUTO ${auto} | REVIEW ${review} | NO_MATCH ${noMatch}`);
  console.log(`         độ chính xác AUTO_ACCEPT = ${((autoRight / Math.max(1, auto)) * 100).toFixed(2)}% (sai ${autoWrong})`);
  console.log(`         độ bao phủ (nếu cả REVIEW đều đúng) = ${(((autoRight + review) / Math.max(1, total)) * 100).toFixed(2)}%`);
  ok('K9 AUTO_ACCEPT không được sai lần nào (sai 1 lần = ghi dữ liệu sai âm thầm)', autoWrong === 0,
    wrongSamples.length ? wrongSamples.join(' | ') : `auto=${auto}`);

  console.log(`\n[smoke] KẾT QUẢ: ${pass} pass / ${fail} fail (DB THẬT)`);
  if (fail) process.exit(1);
}

main()
  .catch((e) => {
    console.error(`[smoke] LỖI: ${e.stack || e.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());