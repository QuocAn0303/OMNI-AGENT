'use strict';

/**
 * scripts/demo/demo-setup.js — `npm run demo:setup`
 *
 * ============================================================================
 * MỤC ĐÍCH: làm cho LUỒNG DEMO CÓ ĐỦ DỮ LIỆU ĐỂ CHẠY TRƯỚC GIỜ TRÌNH BÀY
 * ============================================================================
 * `data:import` (giả định A5) chỉ tạo lịch sử PO+GRN cho **20 SKU tồn thấp nhất** —
 * tức đúng những SKU bán nhanh nhất (`demand/ngày` hàng trăm). Hệ quả đo được:
 * `pickDemoSku` chọn "SKU có `orderQty` lớn nhất" ⇒ rơi đúng vào nhóm đó ⇒ luồng demo
 * in ra những con số như **ROP 1.421 · đề xuất nhập 2.510 cái**. Số đúng theo công thức,
 * nhưng **không giống cửa hàng nào** ⇒ khó giải thích khi trình bày.
 *
 * Script này bổ sung (KHÔNG xoá gì):
 *   1. PO + GRN **3 vòng** cho các SKU trong **dải tình huống tạp hoá nhỏ**
 *      (nhu cầu/ngày 0,5–50, `orderQty` 1–500) ⇒ lead time **ĐO ĐƯỢC**
 *      (`sampleSize = 3 ≥ LEAD_TIME_MIN_SAMPLES`) thay vì mặc định 7 ngày.
 *   2. Mỗi SKU trong nhóm đó cũng có **NCC thật** (PO gần nhất còn active), vì
 *      `suggestForProduct` cố ý **không bịa NCC**.
 *
 * ID tất định (`<tenantId>:po-demo-hist-<sku>-<ngày>d`) ⇒ chạy lại bao nhiêu lần cũng
 * không nhân bản. Chạy `--reset-demo-hist` để gỡ đúng những dòng do script này tạo.
 *
 * AN TOÀN
 *   - `assert-local-db`: chỉ chạy trên DB máy cục bộ.
 *   - Chỉ đụng tenant demo `omni-demo-mo-phong`.
 *   - Mọi PO/GRN tạo ra đều `RECEIVED`/`POSTED`, **nằm ngoài cửa sổ 28 ngày** mà
 *     `loadReplenishmentInput` dùng ⇒ **không** làm đổi `onOrder` của bất kỳ SKU nào.
 *   - Đây là dữ liệu MÔ PHỎNG: PO ghi rõ trong `note`.
 *   - GRN ghi thẳng `POSTED` nên KHÔNG đi qua `grn.service.post`. Vì vậy script
 *     phải TỰ ghi bút toán (Nợ 156 / Có 331) cho từng GRN, nếu không mỗi lần dựng
 *     demo lại lại tạo ra sổ cái lệch — đúng lỗi đã gặp và đã vá ngày 2026-10-12
 *     (`scripts/backfill-grn-journal.js`). Script cố tình KHÔNG cộng tồn kho:
 *     `data:import` đã dựng sẵn tồn kho, cộng thêm sẽ nhân đôi.
 *
 *   npm run demo:setup                      # bổ sung (idempotent)
 *   npm run demo:setup -- --reset-demo-hist # gỡ đúng dòng do script này tạo
 *   npm run demo:setup -- --json            # máy đọc
 */

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('demo:setup');

const prisma = require(path.join(ROOT, 'src/config/prisma'));
const { runWithTenant } = require(path.join(ROOT, 'src/config/tenantContext'));
const autopostService = require(path.join(ROOT, 'src/modules/accounting/autopost.service'));
const {
  loadReplenishmentInput,
  loadLeadTimeReceipts,
  HISTORY_WINDOW_DAYS,
  REVIEW_PERIOD_DAYS,
} = require(path.join(ROOT, 'src/modules/replenishment/replenishment.suggest'));
const {
  planReplenishment,
  classifyUnitCost,
  calcLeadTime,
  NEED_REPLENISHMENT,
  STOCKOUT,
} = require(path.join(ROOT, 'src/modules/replenishment/replenishment.calc'));

const DEMO_SLUG = 'omni-demo-mo-phong';

/**
 * Ghi bút toán cho một GRN do script tự tạo.
 *
 * Script ghi GRN thẳng ở trạng thái `POSTED` (không đi qua `grn.service.post`) để
 * không đụng tồn kho — `data:import` đã dựng sẵn. Hệ quả là mất bước ghi sổ cái,
 * nên phải bù lại ở đây, dùng CHÍNH công thức của đường chạy thật
 * (`buildGoodsReceiptEntry`) để hai nơi không lệch nhau.
 *
 * Idempotent: `journal.service.postEntry` chặn ghi trùng theo
 * `(source, sourceId, operation)`, mà `operation = GRN:<id>` là tất định.
 */
async function postGrnJournal({ grn, purchaseOrder, vendor }) {
  const payload = autopostService.buildGoodsReceiptEntry({ grn, purchaseOrder, vendor, userId: null });
  if (!payload) return false;
  const { goodsReceiptValue, ...entry } = payload;
  await autopostService.postBuiltEntry(entry);
  return true;
}
const HIST_ID = 'po-demo-hist';
/** Số vòng PO+GRN. Phải ≥ `LEAD_TIME_MIN_SAMPLES` (3) để lead time là ĐO ĐƯỢC. */
const ROUNDS = [{ daysAgo: 75 }, { daysAgo: 60 }, { daysAgo: 45 }];
/** Đủ để `pickDemoSku` có dự án chọn; không cần nhiều hơn. */
const HERO_COUNT = 12;
/** Dải tình huống tạp hoá nhỏ — cùng dải với `docs/aisc26/usertest/sku-sets.json`. */
const DEMAND_MIN = 0.5;
const DEMAND_MAX = 50;
const ORDER_QTY_MAX = 500;

const num = (v) => Number(v || 0);
const round2 = (n) => Math.round(num(n) * 100) / 100;

async function pickHeroSkus(tenantId) {
  const inT = (fn) => runWithTenant(tenantId, fn);
  const products = await inT(() =>
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, costPrice: true },
      orderBy: { sku: 'asc' },
    }));
  const inventories = await inT(() =>
    prisma.inventory.findMany({
      select: { productId: true, quantity: true, reserved: true, minStock: true },
    }));
  const invByProduct = new Map();
  for (const i of inventories) {
    const cur = invByProduct.get(i.productId) || { quantity: 0, reserved: 0, minStock: num(i.minStock) };
    cur.quantity += num(i.quantity);
    cur.reserved += num(i.reserved);
    invByProduct.set(i.productId, cur);
  }
  const inputs = await inT(() => loadReplenishmentInput(products.map((p) => p.id)));

  const out = [];
  for (const p of products) {
    const stock = invByProduct.get(p.id);
    const input = inputs.get(p.id);
    if (!stock || !input) continue;
    const cost = classifyUnitCost(p.costPrice);
    if (cost.missing) continue;
    const plan = planReplenishment({
      dailySales: input.dailySales,
      inventories: [{ quantity: stock.quantity, reserved: stock.reserved }],
      receipts: [],
      unitCost: cost.value,
      reviewPeriodDays: REVIEW_PERIOD_DAYS,
    });
    if (plan.status !== NEED_REPLENISHMENT && plan.status !== STOCKOUT) continue;
    const orderQty = num(plan.order.orderQty);
    const dpd = num(plan.rationale.demandPerDay);
    if (orderQty <= 0 || orderQty > ORDER_QTY_MAX) continue;
    if (dpd < DEMAND_MIN || dpd > DEMAND_MAX) continue;
    const receipts = await inT(() => loadLeadTimeReceipts(p.id));
    const lead = calcLeadTime({ receipts });
    out.push({
      id: p.id, sku: p.sku, unitCost: round2(cost.value),
      demandPerDay: round2(dpd), orderQty,
      leadTimeDays: lead.leadTimeDays, leadEstimated: lead.estimated,
      leadSamples: lead.sampleSize,
    });
  }
  // Ưu tiên SKU **chưa** có lead time đo được, rồi `orderQty` lớn nhất, rồi mã tăng dần
  // ⇒ chạy lại vẫn ra **cùng** một danh sách (tất định).
  out.sort((a, b) =>
    Number(a.leadEstimated) - Number(b.leadEstimated)
    || b.orderQty - a.orderQty
    || a.sku.localeCompare(b.sku));
  return out.slice(0, HERO_COUNT);
}

async function main() {
  const reset = process.argv.includes('--reset-demo-hist');
  const asJson = process.argv.includes('--json');
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, name: true } });
  if (!tenant) {
    console.error(`Không thấy tenant demo "${DEMO_SLUG}". Chạy trước: npm run data:import -- --reset --apply`);
    process.exit(1);
  }
  const inT = (fn) => runWithTenant(tenant.id, fn);

  if (reset) {
    const pos = await inT(() => prisma.purchaseOrder.findMany({
      where: { id: { contains: `:${HIST_ID}-` } }, select: { id: true, poCode: true },
    }));
    if (!pos.length) {
      console.log('Không có dữ liệu demo-hist để gỡ.');
      await prisma.$disconnect();
      return;
    }
    const ids = pos.map((p) => p.id);
    const deleted = await prisma.$transaction(async (tx) => {
      const items = await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: { in: ids } } });
      const grnItems = await tx.goodsReceiptItem.deleteMany({ where: { grn: { id: { contains: `:${HIST_ID}-` } } } });
      const grns = await tx.goodsReceiptNote.deleteMany({ where: { id: { contains: `:${HIST_ID}-` } } });
      const orders = await tx.purchaseOrder.deleteMany({ where: { id: { in: ids } } });
      return {
        purchaseItems: items.count, grnItems: grnItems.count,
        grns: grns.count, purchaseOrders: orders.count,
      };
    });
    console.log(`Đã gỡ demo-hist: ${JSON.stringify(deleted)}`);
    await prisma.$disconnect();
    return;
  }

  const vendor = await inT(() => prisma.vendor.findFirst({
    where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  }));
  if (!vendor) throw new Error('tenant demo chưa có NCC — chạy: npm run data:import -- --reset --apply');
  const warehouse = await inT(() => prisma.warehouse.findFirst({
    where: { tenantId: tenant.id }, select: { id: true, name: true },
  }));
  if (!warehouse) throw new Error('tenant demo chưa có kho');
  // `PurchaseOrder.createdById` và `GoodsReceiptNote.createdById` là BẮT BUỘC trong
  // schema — thiếu thì Prisma báo "Argument ... is missing" và dừng giữa chừng.
  const demoUser = await inT(() => prisma.user.findFirst({
    where: { tenantId: tenant.id, role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fullName: true },
  }));
  if (!demoUser) throw new Error('tenant demo chưa có user ADMIN/MANAGER để ghi PO');

  const heroes = await pickHeroSkus(tenant.id);
  if (!heroes.length) {
    console.error('Không tìm thấy SKU nào trong dải tình huống. Nạp lại dữ liệu demo trước.');
    process.exit(1);
  }

  let created = 0;
  let existed = 0;
  for (let hi = 0; hi < heroes.length; hi += 1) {
    const h = heroes[hi];
    // `poCode` là UNIQUE toàn cục. Mỗi vòng có một ngày riêng nhưng **12 SKU cùng
    // ngày** ⇒ seq phải theo cả SKU, không chỉ theo vòng (trước đây cả 12 SKU trong
    // một vòng đều đòi `…-950` ⇒ lần thứ hai là UNIQUE). 95xx tránh khu vực 9001–9003
    // của `data:import` và 0001+ của PO do gate tạo.
    const seq = `95${String(hi).padStart(2, '0')}`;
    for (let round = 0; round < ROUNDS.length; round += 1) {
      const { daysAgo } = ROUNDS[round];
      const poDate = new Date(Date.now() - daysAgo * 86400000);
      poDate.setUTCHours(0, 0, 0, 0);
      const ymd = poDate.toISOString().slice(0, 10).replace(/-/g, '');
      const grnAt = new Date(+poDate + 7 * 86400000);
      const poId = `${tenant.id}:${HIST_ID}-${h.sku}-${daysAgo}d`;
      const total = round2(h.orderQty * h.unitCost);

      const found = await inT(() => prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true } }));
      if (found) { existed += 1; continue; }

      // Ghi TỪNG BẢNG bằng lời gọi phẳng, KHÔNG dùng `items: { create: [...] }`.
      // Lý do: lớp tiêm `tenantId` lồng của Prisma extension xử lý payload ghi
      // lồng nhau (`withNestedTenant`), và với `PurchaseOrder` (nhiều quan hệ bắt
      // buộc) lời gọi lồng bị Prisma từ chối với "Argument `createdBy` is missing"
      // dù `createdById` đã truyền. Ghi phẳng đi hết đường đó, đồng thời đúng với
      // cách `purchase.service.js` tạo PO trong sản phẩm.
      const po = await inT(() => prisma.purchaseOrder.create({
        data: {
          id: poId, tenantId: tenant.id,
          poCode: `PO-${ymd}-${seq}`,
          date: poDate, expectedAt: grnAt, receivedAt: grnAt,
          status: 'RECEIVED', paymentStatus: 'PAID', paidAmount: total,
          subtotal: total, total,
          vendorId: vendor.id, createdById: demoUser.id,
          note: `Lịch sử nhập cho luồng demo (MÔ PHỎNG — do scripts/demo/demo-setup.js tạo, ${daysAgo} ngày trước): để lead time của SKU ${h.sku} ĐO ĐƯỢC thay vì ước lượng.`,
        },
      }));
      const itemId = `${poId}:i`;
      await inT(() => prisma.purchaseItem.create({
        data: {
          id: itemId, tenantId: tenant.id, purchaseOrderId: po.id,
          productId: h.id, quantity: h.orderQty, unitCost: h.unitCost, subtotal: total,
        },
      }));
      const grnId = `${tenant.id}:grn-${HIST_ID}-${h.sku}-${daysAgo}d`;
      const grn = await inT(() => prisma.goodsReceiptNote.create({
        data: {
          id: grnId, tenantId: tenant.id,
          grnCode: `GRN-${ymd}-${seq}`,
          purchaseOrderId: po.id, warehouseId: warehouse.id,
          status: 'POSTED', receivedAt: grnAt, onTime: true,
          createdById: demoUser.id,
        },
      }));
      await inT(() => prisma.goodsReceiptItem.create({
        data: {
          id: `${grnId}:i`, tenantId: tenant.id, grnId: grn.id,
          productId: h.id, purchaseItemId: itemId,
          receivedQty: h.orderQty, passQty: h.orderQty,
        },
      }));

      // Ghi bút toán cho GRN vừa tạo — bù cho việc bypass `grn.service.post`.
      // PHẢI bọc trong `inT`: ngoài tenant context thì `journal_entries.tenantId`
      // ghi NULL, và vì `entryCode` unique toàn cục, 18 dòng NULL đó đã chiếm mã
      // `JE-...-0040..0057` khiến mọi bút toán của tenant demo trong ngày đó đụng
      // P2002 (đã xảy ra 2026-10-12, vá bằng scripts/fix-null-journal-tenant.js).
      await inT(() => postGrnJournal({
        grn: { ...grn, items: [{ passQty: h.orderQty, purchaseItem: { quantity: h.orderQty, unitCost: h.unitCost, taxAmount: 0 } }] },
        purchaseOrder: po,
        vendor,
      }));

      created += 1;
    }
  }

  // Kiểm chứng lại bằng đúng hàm của sản phẩm, không tin vào phần vừa ghi.
  const verified = [];
  for (const h of heroes) {
    const receipts = await inT(() => loadLeadTimeReceipts(h.id));
    const lead = calcLeadTime({ receipts });
    verified.push({
      sku: h.sku, demandPerDay: h.demandPerDay, orderQty: h.orderQty,
      leadTimeDays: lead.leadTimeDays, estimated: lead.estimated, sampleSize: lead.sampleSize,
    });
  }
  const measured = verified.filter((v) => !v.estimated).length;

  if (asJson) {
    console.log(JSON.stringify({ created, existed, heroes: verified }, null, 2));
  } else {
    console.log(`tenant      : ${tenant.name}`);
    console.log(`PO+GRN mới  : ${created} (đã có sẵn: ${existed}) · ${ROUNDS.length} vòng × ${heroes.length} SKU`);
    console.log(`lead time ĐO ĐƯỢC sau khi thiết lập: ${measured}/${verified.length} SKU`);
    for (const v of verified) {
      console.log(`   ${v.sku} · nhu cầu ${v.demandPerDay}/ngày · đề xuất ${v.orderQty} · ` +
        `lead ${v.leadTimeDays} ngày ${v.estimated ? `(ƯỚC LƯỢNG, ${v.sampleSize} mẫu)` : `(ĐO ĐƯỢC, ${v.sampleSize} mẫu)`}`);
    }
    if (measured < verified.length) {
      console.log('\nCẢNH BÁO: vẫn còn SKU lead time ước lượng — kiểm tra GRN đã POSTED chưa.');
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LỖI:', e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
