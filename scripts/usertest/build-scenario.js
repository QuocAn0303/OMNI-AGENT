'use strict';

/**
 * scripts/usertest/build-scenario.js — `npm run usertest:scenario`
 *
 * ============================================================================
 * MỤC ĐÍCH (T15): dựng KỊCH BẢN TÁC VỤ CỐ ĐỊNH cho 6 người thử
 * ============================================================================
 * Sinh hai bộ SKU TƯƠNG ĐƯƠNG (A và B) từ tenant demo `omni-demo-mo-phong`, mỗi bộ
 * ~20 SKU, kèm snapshot `as-of` để người thử nhìn thấy đúng những con số mà hệ
 * thống đang hiển thị.
 *
 * VÌ SAO ĐỌC QUA ĐƯỜNG MÃ THẬT (`loadReplenishmentInput` + `planReplenishment`):
 * nếu tự tính số riêng cho phiếu thử, phiếu và phần mềm sẽ lệch nhau, và người thử
 * sẽ đang đo một thứ không tồn tại. Ở đây mọi số trong `sku-sets.json` là output
 * đúng của công thức sản phẩm.
 *
 * CHỈ ĐỌC. Script này không ghi DB (không có `create/update/delete`). Dùng
 * `assertLocalDb` vì hiến pháp cấm đụng DB không phải local.
 *
 * "TƯƠNG ĐƯƠNG" nghĩa là gì — nêu đúng để không bị hiểu là "giống nhau":
 *   hai bộ cùng số SKU, cùng phân phối `orderQty` và `demandPerDay` (chia xen kẽ
 *   sau khi sắp xếp theo `orderQty` giảm dần ⇒ mỗi bộ lấy một nửa xen kẽ của thang
 *   đo), cùng cửa sổ lịch sử, cùng snapshot. Chúng KHÔNG cùng mã SKU (nếu cùng mã
 *   thì bài thứ hai học được bài thứ nhất ⇒ hiệu ứng ghi nhớ, không phải hiệu ứng hệ
 *   thống). Khả năng trùng mã SKU giữa hai bộ được in ra để kiểm chứng = 0.
 *
 * Nhãn dữ liệu: MÔ PHỎNG (dựng từ UCI Online Retail II, CC BY 4.0 — xem
 * docs/aisc26/02-data.md). Đây là kịch bản ĐỂ THỬ GIAO DIỆN QUY TRÌNH, không phải
 * bằng chứng hiệu quả trên doanh nghiệp thật.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { assertLocalDb } = require('../lib/assert-local-db');
assertLocalDb('usertest:scenario');

const prisma = require('../../src/config/prisma');
const { runWithTenant } = require('../../src/config/tenantContext');
const {
  loadReplenishmentInput,
  loadLeadTimeReceipts,
  HISTORY_WINDOW_DAYS,
  REVIEW_PERIOD_DAYS,
} = require('../../src/modules/replenishment/replenishment.suggest');
const {
  planReplenishment,
  classifyUnitCost,
  NEED_REPLENISHMENT,
  STOCKOUT,
} = require('../../src/modules/replenishment/replenishment.calc');

const DEMO_SLUG = 'omni-demo-mo-phong';
const OUT_DIR = path.resolve(__dirname, '..', '..', 'docs', 'aisc26', 'usertest');
const SET_SIZE = 20;
/** Số ngày nhu cầu dùng làm chân trời chấm điểm quyết định tay. */
const GRADING_DAYS = 14;
/**
 * Dải "tình huống tạp hoá nhỏ" — đây là **phán đoán của tôi**, ghi ra đây để người
 * đọc bác bỏ được:
 *   tệp UCI có vài SKU bán hàng loạn (mã `23843`: 80.995 đơn vị/ngày) và nhiều SKU
 *   100–200 đơn vị/ngày. Cầm những con số đó ra hỏi chủ tạp hoá "đặt mấy thì hợp lý"
 *   thì câu trả lời không có ý nghĩa ⇒ phiếu thử đo cái vô nghĩa. Nên lọc theo dải:
 *   nhu cầu/ngày trong [0.5, 50] và `orderQty` trong [1, 500].
 *   Số SKU bị loại vì lý do này được đếm và ghi vào `sku-sets.json`.
 */
const DEMAND_MIN = 0.5;
const DEMAND_MAX = 50;
const ORDER_QTY_MAX = 500;
const num = (v) => Number(v || 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;

/** Lấy nhu cầu bán theo ngày (chỉ đơn COMPLETED) trong `days` ngày trước `asOf`. */
const dailySalesAsOf = async (productIds, asOf, days) => {
  const since = new Date(asOf.getTime() - days * 86400000);
  const rows = await prisma.orderItem.findMany({
    where: {
      productId: { in: productIds },
      order: { createdAt: { gte: since, lt: asOf }, status: { in: ['COMPLETED'] } },
    },
    select: { productId: true, quantity: true, order: { select: { createdAt: true } } },
  });
  const acc = new Map(productIds.map((id) => [id, new Map()]));
  for (const r of rows) {
    const d = new Date(r.order.createdAt).toISOString().slice(0, 10);
    const m = acc.get(r.productId);
    m.set(d, (m.get(d) || 0) + num(r.quantity));
  }
  const out = new Map();
  for (const [id, m] of acc) out.set(id, [...m.entries()].sort().map(([date, qty]) => ({ date, qty })));
  return out;
};

/** Số tồn khả dụng + minStock tại thời điểm chụp. */
const inventoryAsOf = async (productIds) => {
  const rows = await prisma.inventory.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, quantity: true, reserved: true, minStock: true },
  });
  const acc = new Map();
  for (const r of rows) {
    const cur = acc.get(r.productId) || { quantity: 0, reserved: 0, minStock: num(r.minStock) };
    cur.quantity += num(r.quantity);
    cur.reserved += num(r.reserved);
    cur.minStock = Math.max(cur.minStock, num(r.minStock));
    acc.set(r.productId, cur);
  }
  return acc;
};

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, name: true } });
  if (!tenant) throw new Error(`Không thấy tenant demo "${DEMO_SLUG}" — chạy: npm run data:import -- --reset --apply`);
  const inTenant = (fn) => runWithTenant(tenant.id, fn);

  // ── as-of: thời điểm chụp = ngày bán cuối cùng trong tenant demo ─────────────
  const orderRange = await inTenant(() =>
    prisma.order.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }));
  const asOf = new Date(orderRange._max.createdAt);
  asOf.setUTCHours(23, 59, 59, 999);
  const asOfIso = asOf.toISOString().slice(0, 10);

  // ── ứng viên: có giá vốn để chấm được bằng tiền + đang cần nhập ───────────
  // KHÔNG bắt buộc có NCC: đề xuất của hệ thống cần NCC (thiếu thì `suggest` trả
  // `needVendor`), nhưng BÀI THỬ là "chọn số lượng đặt", không cần NCC. SKU không
  // có NCC sẽ có `leadTimeEstimated = true` ⇒ cột lead time mang nhãn `⚠` và phải
  // nói ra với người thử. Số SKU có/không NCC được đếm và ghi vào tệp.
  const vendorLinked = await inTenant(() =>
    prisma.purchaseItem.findMany({
      where: { purchaseOrder: { tenantId: tenant.id } },
      select: { product: { select: { id: true } } },
    }));
  const vendorProductIds = new Set(vendorLinked.map((r) => r.product && r.product.id).filter(Boolean));

  const products = await inTenant(() =>
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, name: true, costPrice: true },
      orderBy: { sku: 'asc' },
    }));

  const ids = products.map((p) => p.id);
  const sales = await dailySalesAsOf(ids, asOf, HISTORY_WINDOW_DAYS);
  const inv = await inventoryAsOf(ids);

  const candidates = [];
  let droppedNoCost = 0;
  let droppedNotNeeding = 0;
  let droppedNoQty = 0;
  let droppedOutOfBand = 0;
  for (const p of products) {
    const stock = inv.get(p.id);
    if (!stock) continue;
    const cost = classifyUnitCost(p.costPrice);
    if (cost.missing) { droppedNoCost += 1; continue; } // không chấm được bằng tiền ⇒ loại, đếm lại
    const receipts = await inTenant(() => loadLeadTimeReceipts(p.id));
    const dailySales = sales.get(p.id) || [];
    const inventories = [{ quantity: stock.quantity, reserved: stock.reserved }];
    const plan = planReplenishment({
      dailySales,
      inventories,
      receipts,
      unitCost: cost.value,
      reviewPeriodDays: REVIEW_PERIOD_DAYS,
    });
    if (plan.status !== NEED_REPLENISHMENT && plan.status !== STOCKOUT) { droppedNotNeeding += 1; continue; }
    const orderQty = num(plan.order.orderQty);
    if (orderQty <= 0) { droppedNoQty += 1; continue; }

    const dpd = num(plan.rationale.demandPerDay);
    if (dpd < DEMAND_MIN || dpd > DEMAND_MAX || orderQty > ORDER_QTY_MAX) { droppedOutOfBand += 1; continue; }

    // Chân trời chấm điểm: `GRADING_DAYS` ngày LÍCH có bán gần nhất của chính SKU này,
    // đã điền 0 cho ngày không bán (`dailySales` chỉ chứa ngày có số bán).
    // KHÔNG phải dữ liệu tương lai thật — là kịch bản cố định để mọi người thử
    // được chấm trên cùng một kịch bản (xem grading.md).
    const horizon = [];
    for (let k = GRADING_DAYS - 1; k >= 0; k -= 1) {
      const d = new Date(asOf.getTime() - k * 86400000).toISOString().slice(0, 10);
      const hit = dailySales.find((x) => x.date === d);
      horizon.push(num(hit && hit.qty));
    }

    candidates.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      hasVendor: vendorProductIds.has(p.id),
      unitCost: r2(cost.value),
      atp: num(plan.atp.atp),
      onOrder: num(plan.atp.onOrder),
      minStock: num(stock.minStock),
      demandPerDay: r2(plan.rationale.demandPerDay),
      sigmaDaily: r2(plan.rationale.sigmaDaily),
      leadTimeDays: num(plan.rationale.leadTimeDays),
      leadTimeEstimated: Boolean(plan.rationale.leadTimeEstimated),
      safetyStock: r2(plan.rationale.safetyStock),
      rop: r2(plan.rationale.rop),
      daysOfCoverLeft: r2(plan.rationale.daysOfCoverLeft),
      status: plan.status,
      orderQty,
      totalEstimate: r2(plan.rationale.totalEstimate),
      demandMethod: plan.rationale.demandMethod,
      demandConfidence: plan.rationale.demandConfidence,
      // dữ liệu chấm điểm (không in ra cho người thử)
      _horizon: horizon,
      _salesDays: dailySales.length,
    });
  }

  if (candidates.length < SET_SIZE * 2) {
    throw new Error(
      `Chỉ ${candidates.length} ứng viên đủ điều kiện, cần ≥ ${SET_SIZE * 2}. ` +
      'Nạp lại dữ liệu demo: npm run data:import -- --reset --apply --days 34 --max-orders 6000');
  }

  // ── lấy mẫu TRẢI ĐỀU theo phân phối rồi chia xen kẽ thành hai bộ ──────────
  // Vì sao không lấy "40 SKU đầu theo orderQty": khi đó cả hai bộ đều toàn SKU
  // bán nhanh, mọi tình huống giống nhau ⇒ phiếu thử mất sức phân biệt. Ở đây lấy
  // 40 mẫu cách đều trên toàn dải `orderQty` (từ SKU đặt ít nhất đến nhiều nhất),
  // rồi chia xen kẽ A = chỉ số chẵn, B = chỉ số lẻ ⇒ mỗi bộ trải đều như nhau.
  const byQty = [...candidates].sort((a, b) => a.orderQty - b.orderQty || a.sku.localeCompare(b.sku));
  const need = SET_SIZE * 2;
  const pool = [];
  for (let i = 0; i < need; i += 1) {
    const idx = Math.round((i * (byQty.length - 1)) / (need - 1));
    const pick = byQty[idx];
    if (!pool.includes(pick)) pool.push(pick);
  }
  // Bổ sung nếu trùng chỉ số (dải hẹp) cho đủ `need`.
  for (const c of byQty) {
    if (pool.length >= need) break;
    if (!pool.includes(c)) pool.push(c);
  }
  const setA = pool.filter((_, i) => i % 2 === 0);
  const setB = pool.filter((_, i) => i % 2 === 1);
  const overlap = setA.filter((a) => setB.some((b) => b.sku === a.sku)).map((a) => a.sku);

  const asOfSales = (set) => {
    const q = set.map((c) => c.orderQty);
    const d = set.map((c) => c.demandPerDay);
    const sum = (a) => r2(a.reduce((x, y) => x + y, 0));
    const avg = (a) => r2(a.reduce((x, y) => x + y, 0) / (a.length || 1));
    return {
      sumOrderQty: sum(q),
      avgOrderQty: avg(q),
      medianOrderQty: r2([...q].sort((x, y) => x - y)[Math.floor(q.length / 2)]),
      avgDemandPerDay: avg(d),
      sumTotalEstimate: sum(set.map((c) => c.totalEstimate)),
      leadTimeEstimatedCount: set.filter((c) => c.leadTimeEstimated).length,
      stockoutCount: set.filter((c) => c.status === STOCKOUT).length,
    };
  };

  const payload = {
    generatedBy: 'scripts/usertest/build-scenario.js',
    generatedAt: new Date().toISOString(),
    dataLabel: 'MÔ PHỎNG — dựng từ UCI Online Retail II (CC BY 4.0), xem docs/aisc26/02-data.md',
    tenant: { slug: DEMO_SLUG, name: tenant.name },
    asOf: asOfIso,
    asOfNote:
      'Snapshot đọc từ trạng thái hiện tại của tenant demo tại thời điểm sinh tệp. ' +
      'Số trong tệp là output của công thức sản phẩm (loadReplenishmentInput + planReplenishment), ' +
      'không tính lại riêng cho phiếu thử.',
    historyWindowDays: HISTORY_WINDOW_DAYS,
    reviewPeriodDays: REVIEW_PERIOD_DAYS,
    gradingDays: GRADING_DAYS,
    pool: {
      activeProducts: products.length,
      withVendor: products.filter((p) => vendorProductIds.has(p.id)).length,
      eligible: candidates.length,
      eligibleWithVendor: candidates.filter((c) => c.hasVendor).length,
      dropped: {
        missingCost: droppedNoCost,
        notNeedingReplenishment: droppedNotNeeding,
        orderQtyZero: droppedNoQty,
        outsideScenarioBand: droppedOutOfBand,
      },
      scenarioBand: {
        demandPerDay: [DEMAND_MIN, DEMAND_MAX],
        orderQtyMax: ORDER_QTY_MAX,
        why:
          'Lọc theo dải tình huống tạp hoá nhỏ. Tệp UCI có SKU bán hàng loạn (mã 23843: ' +
          '80.995 đơn vị/ngày) — đưa vào phiếu thử thì câu hỏi mất nghĩa. Đây là phán đoán ' +
          'của nhóm soạn tài liệu, có thể bác bỏ; mọi số đếm loại nằm ở `dropped`.',
      },
      note:
        'Ứng viên phải: có giá vốn (không MISSING_COST), trạng thái = cần nhập/hết hàng, orderQty > 0, ' +
        'nằm trong dải tình huống. KHÔNG bắt buộc có NCC (bài thử không cần NCC; SKU thiếu NCC thì ' +
        'lead time là ước lượng, đánh dấu ⚠).',
    },
    equivalence: {
      rule:
        'Sắp xếp ứng viên theo orderQty TĂNG dần, lấy 40 mẫu cách đều trên toàn dải ' +
        '(từ SKU đặt ít nhất đến nhiều nhất), rồi chia xen kẽ: A = chỉ số chẵn, B = chỉ số lẻ.',
      overlapSkus: overlap,
      sampling: 'quantile-spread + xen-kẽ',
      setA: asOfSales(setA),
      setB: asOfSales(setB),
    },
    sets: {
      A: setA.map(strip),
      B: setB.map(strip),
    },
    // Kịch bản chấm điểm: tách riêng khỏi `sets` để bảng in ra cho người thử không
    // lộ chân trời nhu cầu.
    grading: {
      days: GRADING_DAYS,
      rule:
        'Với mỗi SKU, chân trời nhu cầu là GRADING_DAYS ngày bán gần nhất của CHÍNH SKU đó ' +
        '(trong cửa sổ lịch sử tính tới as-of). Đây KHÔNG phải dữ liệu tương lai thật — mọi ' +
        'người thử được chấm trên CÙNG một kịch bản để số mới so sánh được. Hệ quả: có nhìn trước, ' +
        'nên chỉ dùng để so TƯƠNG ĐỐI giữa quyết định tay và hệ thống trên cùng dữ liệu.',
      simulation: 'scripts/backtest/lib/simulate.js — CÙNG bộ mô phỏng với backtest T10.',
      variants: {
        MANUAL: 'đặt đúng số người thử chọn, MỘT lần tại ngày 0',
        REF: 'hệ thống: rà soát hằng ngày, đặt max(0, ROP − vị thế) theo đúng công thức sản phẩm',
        NONE: 'không đặt gì (đường cơ sở)',
      },
      initialAtpRule:
        'initialAtp = ATP + hàng đang trên đường (vị thế tồn kho tại as-of); simulate() tự theo dõi ' +
        'hàng về trong lead time. packMultiple = 1 (bài thử không có ràng buộc bao bì).',
      horizonBySku: Object.fromEntries([...setA, ...setB].map((c) => [c.sku, c._horizon])),
    },
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const sha = crypto.createHash('sha256').update(json, 'utf8').digest('hex');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'sku-sets.json'), json, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'sku-sets.md'), renderMd(payload, sha), 'utf8');

  console.log(`as-of            : ${asOfIso}`);
  console.log(`ứng viên đủ điền : ${candidates.length} / ${products.length} SKU có NCC`);
  console.log(`bộ A / bộ B      : ${setA.length} / ${setB.length} SKU · trùng mã SKU = ${overlap.length}`);
  console.log(`  A: Σ orderQty ${asOfSales(setA).sumOrderQty} · TB demand/ngày ${asOfSales(setA).avgDemandPerDay}`);
  console.log(`  B: Σ orderQty ${asOfSales(setB).sumOrderQty} · TB demand/ngày ${asOfSales(setB).avgDemandPerDay}`);
  console.log(`sha256 sku-sets.json: ${sha}`);
  console.log(`Đã ghi ${path.relative(process.cwd(), OUT_DIR)}/sku-sets.{json,md}`);
  await prisma.$disconnect();
}

const strip = ({ _horizon, _salesDays, ...rest }) => rest;

const nfmt = (v) => new Intl.NumberFormat('vi-VN').format(num(v));

function renderMd(p, sha) {
  const row = (c) =>
    `| ${c.sku} | ${String(c.name).replace(/\|/g, '/')} | ${nfmt(c.atp)} | ${nfmt(c.onOrder)} | ` +
    `${c.minStock} | ${c.demandPerDay} | ${c.leadTimeDays}${c.leadTimeEstimated ? ' ⚠' : ''} | ` +
    `${c.safetyStock} | ${c.rop} | ${c.daysOfCoverLeft} | **${nfmt(c.orderQty)}** | ${nfmt(c.totalEstimate)} |`;

  const head =
    '| SKU | Tên | ATP | Đang trên đường | minStock | Nhu cầu/ngày | Lead time (ngày) | SS | ROP | Còn đủ bán (ngày) | **Hệ thống đề xuất** | Ước tính tiền |\n' +
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';

  const setBlock = (key, title) =>
    `### Bộ ${key} — ${title} (${p.sets[key].length} SKU)\n\n${head}\n` +
    `${p.sets[key].map(row).join('\n')}\n`;

  return `# Hai bộ SKU cho bài thử (sinh tự động — đừng sửa tay)

> **Nhãn dữ liệu: MÔ PHỎNG.** Dựng từ **UCI Online Retail II — CC BY 4.0**
> (nguồn + sha256 ở \`docs/aisc26/02-data.md\`). Tên hàng là tên hàng trong tệp công
> khai; giá là **sterling của tập dữ liệu**, không phải giá vốn của bất kỳ doanh
> nghiệp Việt Nam nào. Kịch bản này dùng để **thử quy trình duyệt**, không phải để
> chứng minh hiệu quả trên thị trường.

| Mục | Giá trị |
|---|---|
| Sinh bởi | \`npm run usertest:scenario\` (\`scripts/usertest/build-scenario.js\`, **chỉ đọc**) |
| Tenant | \`${p.tenant.slug}\` — ${p.tenant.name} |
| **Snapshot as-of** | **${p.asOf}** |
| Cửa sổ lịch sử nhu cầu | ${p.historyWindowDays} ngày trước as-of |
| Chu kỳ rà soát | ${p.reviewPeriodDays} ngày |
| Chân trời chấm điểm (P4) | ${p.gradingDays} ngày |
| sha256 \`sku-sets.json\` | \`${sha}\` |

\`⚠\` = lead time **ước lượng** (chưa đủ mẫu GRN) — cột này phải nói ra khi hỏi người thử.

## Vì sao có hai bộ

Quy tắc chia: sắp xếp ứng viên theo \`orderQty\` **tăng dần**, lấy **40 mẫu cách đều**
trên toàn dải (từ SKU đặt ít nhất đến nhiều nhất), rồi **chia xen kẽ**
(A = chỉ số chẵn, B = chỉ số lẻ) ⇒ hai bộ có cùng phân phối \`orderQty\` và
\`demandPerDay\`, và cả hai đều trải đều chứ không chỉ gọm SKU bán nhanh.

Hai bộ **cố ý không trùng mã SKU**: nếu trùng, người thử học được bài một rồi làm bài
hai ⇒ đo nhầm trí nhớ thay vì đo tác động của hệ thống.

| So sánh hai bộ | A | B |
|---|---:|---:|
| Số SKU | ${p.sets.A.length} | ${p.sets.B.length} |
| Σ \`orderQty\` | ${nfmt(p.equivalence.setA.sumOrderQty)} | ${nfmt(p.equivalence.setB.sumOrderQty)} |
| TB \`orderQty\` | ${p.equivalence.setA.avgOrderQty} | ${p.equivalence.setB.avgOrderQty} |
| TB nhu cầu/ngày | ${p.equivalence.setA.avgDemandPerDay} | ${p.equivalence.setB.avgDemandPerDay} |
| Σ ước tính tiền | ${nfmt(p.equivalence.setA.sumTotalEstimate)} | ${nfmt(p.equivalence.setB.sumTotalEstimate)} |
| SKU lead time ước lượng | ${p.equivalence.setA.leadTimeEstimatedCount} | ${p.equivalence.setB.leadTimeEstimatedCount} |
| SKU hết hàng | ${p.equivalence.setA.stockoutCount} | ${p.equivalence.setB.stockoutCount} |
| **SKU trùng mã giữa hai bộ** | colspan | **${p.equivalence.overlapSkus.length}** |

## Cột nào cho người thử, cột nào giữ

- **Điều kiện 1 (đối chứng — không có hệ thống):** chỉ cột *Tồn khả dụng*, *Nhu cầu/ngày*,
  *Lead time*, *Giá vốn*. **Không** cho cột *Hệ thống đề xuất*.
- **Điều kiện 2 (có hệ thống):** thêm cột *Hệ thống đề xuất* + *SS* + *ROP*.
- *Đang trên đường*, *minStock*, *Ước tính tiền* là cột của điều phối — dùng để chấm,
  không nhất thiết đưa hết ra giấy.

${setBlock('A', 'điều kiện 1 của nhóm AB, điều kiện 2 của nhóm BA')}
${setBlock('B', 'điều kiện 1 của nhóm BA, điều kiện 2 của nhóm AB')}
`;
}

main().catch(async (e) => {
  console.error('LỖI:', e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
