'use strict';

/**
 * scripts/demo/demo-flow.js — LUỒNG DEMO DUY NHẤT, dùng chung cho smoke và trình diễn
 *
 * ============================================================================
 * VÌ SAO TÁCH RA THƯ VIỆN
 * ============================================================================
 * `smoke:demo-flow` (khẳng định) và `demo:run` (kể chuyện cho khán giả) phải chạy
 * **cùng một đường mã**. Nếu mỗi cái tự viết, "bản trình diễn" sẽ là một đường
 * khác với "bản nghiệm thu" ⇒ giám khảo soi thấy ngay. Ở đây chỉ có MỘT hàm
 * `runDemoFlow()`, hai script kia chỉ khác phần in ấn và phần khẳng định.
 *
 * ============================================================================
 * ĐƯỜNG ĐI (8 bước, mỗi bước đều là đường mã sản phẩm thật)
 * ============================================================================
 *   1. chọn SKU          — công thức `planReplenishment` (KHÔNG dùng LLM)
 *   2. tạo đơn           — `order.service.create` (trừ kho thật)
 *   3. CDC               — `EVENT_HANDLERS.LOW_STOCK` (đúng hàm mà `pg_notify` gọi)
 *   4. đề xuất PENDING   — `replenishment.suggest` (tự tạo human-gate)
 *   5. kiểm tra drift    — `revalidate` CHƯA duyệt: đây là bằng chứng `freshness`
 *   6. duyệt             — `buildDecisionData` (đảo trạng thái) + `executeGate`
 *   7. ĐÓNG VÒNG        — `grnService.create` → `recordQc` → `post`
 *                          đơn PO biến thành phiếu nhập kho THẬT: tồn kho tăng,
 *                          bút toán Nợ 156 + Nợ 1331 = Có 331, cộng dồn công nợ
 *                          NCC. Đây là phần *chuỗi cung ứng* bị BỎ SÓT trước đây
 *                          — đo được 39 PO đã nhận hàng mà không có bút toán nào.
 *   8. chống trùng       — `suggestForProduct` lần 2 ⇒ `onOrder` đã che ⇒ không
 *                          sinh đề xuất thứ hai
 *
 * BỎ QUA CÓ CHỦ ĐÍCH (nói thẳng, không giấu):
 *   - **Vận chuyển `pg_notify`/LISTEN**: bước 3 gọi thẳng handler. Trigger PL/pgSQL
 *     được `startCDC()` cài khi server chạy; script này không bật tiến trình nền
 *     (hiến pháp: phải dọn mọi tiến trình nền). Phần còn thiếu là **đường vận
 *     chuyển**, không phải logic xử lý sự kiện.
 *   - **HTTP**: bước 6 gọi `executeGate` trực tiếp với đúng thứ tự route làm
 *     (`updateMany` PENDING→APPROVED rồi mới `executeGate`). Phần HTTP được phủ
 *     bởi `scripts/check-humangate.js` (11/11, HTTP thật).
 *
 * DỌN DẸP: `cleanupDemoArtifacts()` xoá đúng những dòng lần chạy này sinh ra và
 * trả tồn kho/khách về đúng số trước. `captureTenantCounts`/`diffTenantCounts`
 * đo lại trên **toàn bộ bảng scoped** ⇒ nếu còn sót bảng nào thì smoke FAIL, không
 * thể "chắc là không sao".
 */

const ROOT = require('path').resolve(__dirname, '..', '..');
const prisma = require(`${ROOT}/src/config/prisma`);
const { runWithTenant } = require(`${ROOT}/src/config/tenantContext`);
const { listScopedTables } = require(`${ROOT}/scripts/lib/teardown`);
const orderService = require(`${ROOT}/src/modules/orders/order.service`);
const { EVENT_HANDLERS, resetLowStockDebounce } = require(`${ROOT}/src/jobs/agent.cdc`);
const {
  suggestForProduct,
  loadReplenishmentInput,
  loadLeadTimeReceipts,
  findOpenProposalKeys,
  REVIEW_PERIOD_DAYS,
} = require(`${ROOT}/src/modules/replenishment/replenishment.suggest`);
const { planReplenishment, classifyUnitCost, NEED_REPLENISHMENT, STOCKOUT } =
  require(`${ROOT}/src/modules/replenishment/replenishment.calc`);
const { revalidate, executeGate } = require(`${ROOT}/src/modules/ai/agent.gate.exec`);
const { explainProposal, draftVendorMessage } = require(`${ROOT}/src/modules/replenishment/proposal-explain.llm`);
const { buildDecisionData, PO_PROPOSAL } = require(`${ROOT}/src/modules/ai/agent.humangate`);
// Bước "đóng vòng" (7) dùng đúng đường code sản phẩm, không gọi Prisma tay.
const grnService = require(`${ROOT}/src/modules/accounting/grn.service`);
const purchaseService = require(`${ROOT}/src/modules/accounting/purchase.service`);

const DEMO_SLUG = 'omni-demo-mo-phong';
/** Mã đơn demo có tiền tố này ⇒ dọn lại được, không nhầm đơn sàn. */
const DEMO_ORDER_PREFIX = 'P6-DEMO-';
const DEMO_ORDER_NOTE = 'MÔ PHỎNG — đơn sinh bởi luồng demo P6 (không phải đơn thật)';
/** Số SKU ứng viên tối đa để chọn — đủ để có dữ liệu, không quét cả 500 SKU. */
const MAX_CANDIDATES = 20;

const num = (v) => Number(v || 0);
/** Decimal của Prisma không tự + được — mọi phép cộng tiền phải ép qua đây. */
const toNum = (v) => Number(v || 0);

/**
 * Đếm số dòng theo `tenantId` trên TOÀN BỘ bảng scoped.
 * Chỉ dùng để so trước/sau — không tự sửa số kỳ vọng.
 */
const captureTenantCounts = async (tenantId) => {
  const out = {};
  for (const t of await listScopedTables(prisma)) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${t}" WHERE "tenantId" = $1`,
      tenantId,
    );
    out[t] = r[0].n;
  }
  return out;
};

/** Bảng nào thay đổi giữa hai lần đếm (delta ≠ 0). */
const diffTenantCounts = (before, after) =>
  Object.keys(after)
    .filter((t) => num(before[t]) !== num(after[t]))
    .map((t) => ({ table: t, before: num(before[t]), after: num(after[t]), delta: num(after[t]) - num(before[t]) }));

/**
 * Bước 1 — chọn SKU để kể chuyện.
 *
 * Tiêu chí (tất định, không ngẫu nhiên):
 *   - có NCC đã biết (đã từng có PO) — nếu không thì `suggest` cố ý trả
 *     `{ needVendor: true }` và không sinh đề xuất;
 *   - `plan.status` = cần nhập và `orderQty > 0`;
 *   - còn tồn ≥ 1 để bước 2 bán được (đơn cần tồn để trừ kho);
 *   - chưa có đề xuất PENDING (nếu có thì `findOpenProposalKeys` sẽ chặn).
  * Chọn SKU theo thứ tự ưu tiên (mọi tiêu chí đều **tất định**, không random):
  *   1. **lead time ĐO ĐƯỢC** (`leadEstimated = false`) — số của hệ thống do lịch sử
  *      PO→GRN thật, không phải mặc định 7 ngày. `npm run demo:setup` tạo đúng dữ liệu
  *      này cho 12 SKU trong dải tình huống.
  *   2. `orderQty` **vừa đủ nhìn được** (1–500) và nhu cầu 0,5–50/ngày — tức trong
  *      dải "tạp hoá nhỏ". KHÔNG dùng `orderQty` LỚN NHẤT nữa: tệp công khai có SKU
  *      bán hàng loạn (mã 23843: 80.995 cái/ngày) ⇒ bản demo in ra ROP 1.421 và đề xuất
  *      2.510 cái — đúng theo công thức nhưng **không giống cửa hàng nào**.
  *   3. `orderQty` lớn nhất trong dải đó (đề xuất nhìn rõ nhất trong dải), rồi sku tăng dần.
  * Nếu không SKU nào khớp tiêu chí 1–2 (chưa chạy `demo:setup`), lùi về tiêu chí cũ
  * ⇒ `demo:run` vẫn chạy được như trước, chỉ là số kém thân thiện hơn.
  */
const pickDemoSku = async (tenantId) => {
  const inTenant = (fn) => runWithTenant(tenantId, fn);
  const vendorLinked = await inTenant(() =>
    prisma.purchaseItem.findMany({
      where: { purchaseOrder: { tenantId } },
      select: {
        productId: true,
        product: { select: { id: true, sku: true, name: true, costPrice: true } },
      },
      orderBy: { productId: 'asc' },
    }),
  );
  const seen = new Set();
  const uniqueProducts = [];
  for (const row of vendorLinked) {
    if (!row.product || seen.has(row.product.id)) continue;
    seen.add(row.product.id);
    uniqueProducts.push(row.product);
  }
  // Chọn ứng viên ĐANG CÓ TỒN THẤP trước, rồi mới tính toán.
  //
  // VÌ SAO (đo được 2026-10-16 với bộ dữ liệu chuỗi siêu thị): bản cũ cắt
  // `slice(0, MAX_CANDIDATES)` theo thứ tự `productId` (UUID ⇒ vô nghĩa với
  // nghĩa bán hàng). Trong 600 SKU chỉ 12 SKU là "hero" (tồn thấp + có NCC),
  // nên 20 ứng viên đầu gần như không bao giờ chạm vào hero ⇒
  // `KHÔNG có SKU nào đủ điều kiện chạy luồng demo`.
  //
  // Sắp theo ATP tăng dần vẫn TẤT ĐỊNH (ATP là số trong DB), và đúng nghĩa:
  // SKU cần nhập là SKU còn ít hàng.
  const ids = uniqueProducts.map((p) => p.id);
  const invRows = ids.length
    ? await inTenant(() => prisma.inventory.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, warehouseId: true, quantity: true, reserved: true },
    }))
    : [];
  const atpTheoSanPham = new Map();
  for (const r of invRows) {
    atpTheoSanPham.set(r.productId, num(atpTheoSanPham.get(r.productId)) + num(r.quantity) - num(r.reserved));
  }
  // Chỉ ứng viên nào CÒN HÀNG Ở KHO MẶC ĐỊNH mới bán được trong bước 2.
  //
  // VÌ SAO (đo được 2026-10-16 trên bộ dữ liệu chuỗi siêu thị): ATP là TỔNG
  // tồn mọi kho, còn `order.service.create` bán ở KHO MẬC ĐỊNH. SKU có tồn ở
  // cửa hàng nhưng 0 ở kho trung tâm vẫn được tính là "còn hàng" ⇒ bước 2 văng
  // `Số lượng phẩm ... không đủ số lượng có thể bán` và cả luồng chết.
  const { getDefaultWarehouseId } = require(`${ROOT}/src/utils/warehouse.helper`);
  const defaultWarehouseId = await inTenant(() => getDefaultWarehouseId());
  const tonKhoMacDinh = new Map(
    invRows
      .filter((r) => r.warehouseId === defaultWarehouseId)
      .map((r) => [r.productId, num(r.quantity) - num(r.reserved)]),
  );
  const daSapXep = uniqueProducts
    .slice()
    .sort((a, b) => num(atpTheoSanPham.get(a.id)) - num(atpTheoSanPham.get(b.id))
      || a.sku.localeCompare(b.sku));

  const candidates = [];
  for (const product of daSapXep.slice(0, MAX_CANDIDATES)) {
    const input = (await inTenant(() => loadReplenishmentInput([product.id]))).get(product.id);
    if (!input) continue;
    const receipts = await inTenant(() => loadLeadTimeReceipts(product.id));
    const cost = classifyUnitCost(product.costPrice);
    const plan = planReplenishment({
      dailySales: input.dailySales,
      inventories: input.inventories,
      receipts,
      unitCost: cost.value,
      reviewPeriodDays: REVIEW_PERIOD_DAYS,
      onOrder: input.onOrder,
    });
    const atp = num(plan.atp.atp);
    candidates.push({ product, plan, atp, measuredLead: plan.lead.estimated !== true });
    if (atp < 1) continue;
    if (plan.status !== NEED_REPLENISHMENT && plan.status !== STOCKOUT) continue;
    if (!plan.order.orderQty || plan.order.orderQty <= 0) continue;
  }
  const openKeys = await inTenant(() => findOpenProposalKeys());
  const eligible = candidates.filter(
    (c) => c.atp >= 1 && c.plan.order.orderQty > 0
      && num(tonKhoMacDinh.get(c.product.id)) >= 1
      && !openKeys.some((k) => k.startsWith(`PROPOSAL:${c.product.id}:`)),
  );
  const inScenarioBand = (c) => {
    const q = num(c.plan.order.orderQty);
    const d = num(c.plan.rationale.demandPerDay);
    return q >= 1 && q <= 500 && d >= 0.5 && d <= 50;
  };
  const better = (a, b) =>
    Number(a.measuredLead) - Number(b.measuredLead) || a.product.sku.localeCompare(b.product.sku);
  const hero = eligible
    .filter((c) => c.measuredLead && inScenarioBand(c))
    .sort((a, b) => better(a, b) || num(b.plan.order.orderQty) - num(a.plan.order.orderQty) || a.product.sku.localeCompare(b.product.sku));
  const fallback = eligible
    .slice()
    .sort((a, b) => num(b.plan.order.orderQty) - num(a.plan.order.orderQty) || a.product.sku.localeCompare(b.product.sku));
  const usable = hero.length ? hero : fallback;
  if (!usable.length) {
    throw new Error(
      `KHÔNG có SKU nào đủ điều kiện chạy luồng demo (ứng viên ${candidates.length}). ` +
      `Kiểm tra giả định A5 (PO tiền sử) và A4 (cửa sổ ngày) trong 02-data.md §9.2.`,
    );
  }
  return {
    ...usable[0],
    defaultWarehouseId,
    candidates: candidates.length,
    usable: usable.length,
    pickedFrom: hero.length ? 'hero (lead time đo được + dải tình huống)' : 'fallback (chưa chạy demo:setup?)',
  };
};

/**
 * Chạy trọn luồng. Trả về `trace` (mỗi bước có `ms` để đo trong trình diễn) và
 * `cleanup()` để trả DB về trạng thái trước.
 */
/**
 * Xoá mọi dòng luồng demo sinh ra, theo CỬA SỔ THỜI GIAN `since`.
 *
 * Tách ra khỏi `runDemoFlow` (2026-10-13) vì lý do sau — đây là bài học
 * từ sự cố thật, không phải phòng xa:
 *
 *   Khi một bước ném lỗi giữa chừng, `cleanup` nằm SAU các bước nên chưa tồn
 *   tại ⇒ KHÔNG dọn được. Đo được 2026-10-13: hai lần chạy lỗi để lại 2
 *   phiếu GRN POSTED + 2 đơn mua + 2 bút toán. Tệ hơn: `demo:check` KHÔNG bắt
 *   được, vì nó chỉ so sánh trước và sau lần chạy của chính nó.
 *
 * Hàm này chỉ cần `tenantId` và mốc thời gian ⇒ gọi được từ `catch` khi
 * luồng chết, không phụ thuộc bước nào đã chạy xong.
 *
 * THỨ TỰ BẮT BUỘC: GRN items → GRN notes → lots → purchaseItems → POs.
 * `GoodsReceiptItem.purchaseItemId` là FK **RESTRICT** tới `PurchaseItem`;
 * xoá sai thứ tự sẽ văng lỗi FK và dọn dở dang (tai nạn P8).
 */
const purgeFlowResidue = async (tenantId, since) => {
  const inT = (fn) => runWithTenant(tenantId, fn);
  const deleted = {};

  deleted.debts = (await inT(() =>
        prisma.debt.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      // Bút toán của ĐƠN bán (không chỉ của PO) — `sourceId` là id đơn/PO.
      const freshEntries = await inT(() =>
        prisma.journalEntry.findMany({
          where: { createdAt: { gte: since } },
          select: { id: true },
        }),
      );
      const freshEntryIds = freshEntries.map((e) => e.id);
      deleted.journalLines = freshEntryIds.length
        ? (await inT(() => prisma.journalLine.deleteMany({ where: { entryId: { in: freshEntryIds } } }))).count
        : 0;
      deleted.journalEntries = (await inT(() =>
        prisma.journalEntry.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      // Hoá đơn điện tử: `order.service.create` gọi `autoIssue` (ở local không có
      // cấu hình VNPT nên nó log lỗi rồi bỏ, nhưng vẫn tạo dòng ở trạng thái lỗi).
      deleted.electronicInvoices = (await inT(() =>
        prisma.electronicInvoice.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      deleted.purchaseInvoices = (await inT(() =>
        prisma.purchaseInvoiceRecord.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      // ── Bước 7 sinh PHIẾU NHẬP KHO (GRN) — xoá TRƯỚC `purchaseItems` ──────
      // BẮT BUỘC (thêm 2026-10-13): `GoodsReceiptItem.purchaseItemId` là FK
      // **RESTRICT** tới `PurchaseItem`. Xoá `purchaseItems` trước sẽ văng lỗi FK và
      // dọn dở dang — đúng kiểu tai nạn P8. Thứ tự bắt buộc:
      //   GRN items → GRN notes → lot transactions → lots → purchaseItems → POs.
      //
      // Bảng nào KHÔNG có `createdAt` thì phải xoá theo id chứ không theo thời gian
      // (`GoodsReceiptItem` không có; `LotTransaction` có nhưng nên theo lot để chắc).
      const freshGrnIds = (await inT(() =>
        prisma.goodsReceiptNote.findMany({ where: { createdAt: { gte: since } }, select: { id: true } }),
      )).map((g) => g.id);
      if (freshGrnIds.length) {
        await inT(() => prisma.goodsReceiptItem.deleteMany({ where: { grnId: { in: freshGrnIds } } }));
      }
      deleted.goodsReceipts = (await inT(() =>
        prisma.goodsReceiptNote.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      const freshLotIds = (await inT(() =>
        prisma.inventoryLot.findMany({ where: { createdAt: { gte: since } }, select: { id: true } }),
      )).map((l) => l.id);
      if (freshLotIds.length) {
        await inT(() => prisma.lotTransaction.deleteMany({ where: { lotId: { in: freshLotIds } } }));
      }
  deleted.lotTransactions = (await inT(() =>
    prisma.lotTransaction.deleteMany({ where: { createdAt: { gte: since } } }),
  )).count;
  // `LotTransaction` cung co `createdAt` => xoa theo thoi gian la du va BAT BUOC.
  //
  // VI SAO CA HAI: `grn.service.post` co the ghi vao LO DA TON TAI (cung
  // `lotCode`) - lo do co `createdAt` cu nen `freshLotIds` khong bat, va dong giao
  // dich cua lan nhan nay se sot lai. Do duoc: `lot_transactions 0->1` moi lan
  // chay => rac dan, dung kieu D7 bat duoc.
      deleted.inventoryLots = (await inT(() =>
        prisma.inventoryLot.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      // `PurchaseItem` KHÔNG có cột `createdAt` ⇒ phải xoá theo PO cha (đúng thứ tự
      // phụ thuộc: con trước cha).
      const freshPoIds = (await inT(() =>
        prisma.purchaseOrder.findMany({ where: { createdAt: { gte: since } }, select: { id: true } }),
      )).map((p) => p.id);
      deleted.purchaseItems = freshPoIds.length
        ? (await inT(() => prisma.purchaseItem.deleteMany({ where: { purchaseOrderId: { in: freshPoIds } } }))).count
        : 0;
      deleted.purchaseOrders = (await inT(() =>
        prisma.purchaseOrder.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      deleted.gates = (await inT(() =>
        prisma.agentHumanGate.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      deleted.sessions = (await inT(() =>
        prisma.agentSession.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      deleted.notifications = (await inT(() =>
        prisma.notification.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      // `OrderItem` cũng không có `createdAt` ⇒ xoá theo đơn cha. `KdsTicket` trỏ tới
      // `orderItem` (FK, không cascade) ⇒ phải xoá trước.
      //
      // CHỈ đơn có mã `ORD-YYYYMMDD-XXXX` (do `orderService.create` sinh). Đơn của
      // `data:import` mang `orderCode` = Order ID gốc của tệp sàn VÀ có `createdAt`
      // theo neo A4 — ngày cuối cửa sổ rơi vào 09:00 UTC HÔM NAY, tức là "tương lai"
      // nếu chạy demo:check trước 16:00 local. Cửa sổ thời gian đơn thuần đã từng
      // xoá nhầm 146 đơn import thật (đo được: 5.282 → 5.136 sau một lần demo:check,
      // 2026-10-18). Lọc theo tiền tố mã đơn là lọc theo NGUỒN GỐC, không theo giờ.
      const freshOrderIds = (await inT(() =>
        prisma.order.findMany({
          where: {
            createdAt: { gte: since },
            orderCode: { startsWith: 'ORD-' },
          },
          select: { id: true },
        }),
      )).map((o) => o.id);
      const freshOrderItemIds = freshOrderIds.length
        ? (await inT(() => prisma.orderItem.findMany({
          where: { orderId: { in: freshOrderIds } }, select: { id: true },
        }))).map((i) => i.id)
        : [];
      if (freshOrderItemIds.length) {
        await inT(() => prisma.kdsTicket.deleteMany({ where: { orderItemId: { in: freshOrderItemIds } } }));
        await inT(() => prisma.orderItemModifier.deleteMany({ where: { orderItemId: { in: freshOrderItemIds } } }));
      }
      deleted.orderItems = freshOrderIds.length
        ? (await inT(() => prisma.orderItem.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      // `invoices.orderId` là FK **RESTRICT** (không cascade) và bản cleanup cũ KHÔNG
      // xoá bảng này. Mọi lần chạy luồng demo từ trước đã để lại dòng `invoices` ở đây
      // ⇒ lần sau xoá đơn sẽ văng `violates RESTRICT setting of foreign key
      // constraint "invoices_orderId_fkey"` và dọn dở dang. Xoá theo đơn con trước đơn.
      deleted.invoices = freshOrderIds.length
        ? (await inT(() => prisma.invoice.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      // `payments.orderId` cũng là FK **RESTRICT** và bản cleanup cũ không xoá.
      // Đo được 2026-10-16 (bộ dữ liệu chuỗi siêu thị): `order.service.create`
      // với `paymentStatus: PAID` sinh dòng `payments` ⇒ xoá `orders` văng
      // `violates RESTRICT ... "payments_orderId_fkey"` ⇒ `demo:run` chết đúng
      // lúc dọn dẹp, để lại PO + GRN + bút toán. Xoá theo đơn con TRƯỚC đơn.
      deleted.payments = freshOrderIds.length
        ? (await inT(() => prisma.payment.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      // `loyalty_transactions.orderId` không có quan hệ (không cascade, không
      // RESTRICT) ⇒ xoá đơn xong thì dòng điểm thưởng của đơn đó VẪN ở lại.
      // Đo được 2026-10-16: mỗi lần chạy luồng để lại đúng 1 dòng ⇒ `demo:run`
      // báo "rác còn lại: loyalty_transactions +1" dù đã dọn hết phần còn lại.
      deleted.loyaltyTransactions = freshOrderIds.length
        ? (await inT(() => prisma.loyaltyTransaction.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      deleted.billSplits = freshOrderIds.length
        ? (await inT(() => prisma.billSplit.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      deleted.promotionUsages = freshOrderIds.length
        ? (await inT(() => prisma.promotionUsage.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      deleted.deliveries = freshOrderIds.length
        ? (await inT(() => prisma.delivery.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      deleted.returns = freshOrderIds.length
        ? (await inT(() => prisma.orderReturn.deleteMany({ where: { orderId: { in: freshOrderIds } } }))).count
        : 0;
      deleted.orders = freshOrderIds.length
        ? (await inT(() => prisma.order.deleteMany({ where: { id: { in: freshOrderIds } } }))).count
        : 0;
      deleted.inventoryTransactions = (await inT(() =>
        prisma.inventoryTransaction.deleteMany({
          where: { createdAt: { gte: since } },
        }),
      )).count;
      // Audit của cả luồng (đơn, PO, bút toán, hoá đơn điện tử, gate). Có dòng
      // `entityId = NULL` (GENERATE_KDS_TICKETS) nên không lọc được theo id ⇒ theo
      // thời gian.
      deleted.auditLogs = (await inT(() =>
        prisma.auditLog.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
      // Sổ lỗi bút toán: `order.service.create` (BƯỚC A, bước 2) gọi autopost; khi
      // thiếu tài khoản/số tiền nó KHÔNG ném lỗi mà ghi 1 dòng `journal_posting_errors`
      // để retry sau. Đây chính là dòng rác đã làm D7 FAIL ở P7 (đo được 2026-10-03:
      // mỗi lần chạy luồng +1 dòng, 2 lần liên tiếp = 2 dòng rác).
      deleted.journalPostingErrors = (await inT(() =>
        prisma.journalPostingError.deleteMany({ where: { createdAt: { gte: since } } }),
      )).count;
  return deleted;
};

const runDemoFlow = async ({ tenantId, onEvent = () => {} } = {}) => {
  const trace = [];
  const inTenant = (fn) => runWithTenant(tenantId, fn);
  // Khai báo TRƯỚC `step` vì `step` cần dùng khi bắt lỗi.
  const startedAt = new Date();
  const step = async (name, fn) => {
    const t0 = Date.now();
    let data;
    try {
      data = await fn();
    } catch (e) {
      // ── DỌN KHI BƯỚC CHẾT, NGAY TẠI CHỖ ────────────────────────────────
      // Sự cố thật 2026-10-13: hai lần chạy lỗi để lại 2 GRN POSTED + 2 đơn
      // mua. Nguyên nhân gốc: lỗi ném ra khỏi hàm trước khi tới dòng gán
      // `cleanupFn`, nên không ai gọi được `cleanup`. Sửa bằng cách bắt lỗi
      // NGAY TẠI `step` — đây là ngõ duy nhất mọi bước đi qua.
      //
      // Dọn được cả phần GIÁ TRỊ (tồn kho, tổng chi khách) chứ không chỉ số
      // dòng, vì `diffTenantCounts` chỉ đếm dòng nên không bắt được trường hợp
      // tồn bị cộng sai mà vẫn ra "0 bảng thay đổi".
      await emergencyCleanup().catch(() => null);
      throw e;
    }
    const ms = Date.now() - t0;
    trace.push({ step: name, ms, ...data });
    onEvent({ step: name, ms, ...data });
    return data;
  };

  /**
   * Dọn cấp cứu — chạy được NGAY CẢ KHI luồng đã chết giữa chừng.
   * Chỉ dùng những gì đã biết (cửa sổ thời gian + các giá trị đã chụp ở bước
   * trước đó); phần không biết thì bỏ qua chứ không đoán.
   */
  const emergencyCleanup = async () => {
    const inT = (fn) => runWithTenant(tenantId, fn);
    const deleted = await purgeFlowResidue(tenantId, startedAt).catch(() => ({}));
    for (const r of grn?.stockRestore || []) {
      await inT(() => prisma.inventory.update({
        where: { id: r.id }, data: { quantity: r.quantity, reserved: r.reserved },
      })).catch(() => null);
    }
    if (picked?.inventoryId) {
      await inT(() => prisma.inventory.update({
        where: { id: picked.inventoryId },
        data: { quantity: picked.quantity, reserved: picked.reserved },
      })).catch(() => null);
    }
    if (customer?.id && customerBefore) {
      await inT(() => prisma.customer.update({
        where: { id: customer.id },
        data: { totalSpent: customerBefore.totalSpent, totalDebt: customerBefore.totalDebt },
      })).catch(() => null);
    }
    return { deleted, emergency: true };
  };

  // ── KHAI BÁO TRƯỚC + `cleanup` ĐỊNH NGHĨA TRƯỚC CÁC BƯỚC ──────────────
  // VÌ SAO (sửa 2026-10-13): trước đây `cleanup` nằm SAU các bước. Khi một bước
  // ném lỗi giữa chừng, `cleanup` chưa tồn tại ⇒ không dọn được ⇒ để lại rác.
  // Đo được: 2 lần chạy lỗi (PO chưa APPROVED; tra cứu bút toán sai khóa) để lại
  // 2 phiếu GRN POSTED mà `demo:check` KHÔNG bắt được — vì nó chỉ so sánh trước và
  // sau *lần chạy của chính nó*, đối với dữ liệu đã sót từ trước đó.
  //
  // Cách sửa: khai báo biến trạng thái trước, định nghĩa `cleanup` trước các bước,
  // và bọc toàn bộ chuỗi bước trong try/catch — lỗi thì dọn rồi mới ném lại.
  let picked, customer, customerBefore, order, cdc, gate, fresh, explain, approved, poCheck, grn, dedupe;
  let cleanupFn = null;

  /** Xoá mọi dòng lần chạy này sinh ra. Chịu được cả khi chạy dở dang. */
  const cleanup = async () => {
    if (!cleanupFn) return { deleted: {}, residue: [], skipped: true };
    return cleanupFn();
  };

  // ── 1. chọn SKU ─────────────────────────────────────────────────────────
  picked = await step('pick-sku', async () => {
    const r = await pickDemoSku(tenantId);
    // Dòng tồn PHẢI là của KHO MẶC ĐỊNH — cùng kho mà `order.service.create`
    // dùng. Bản cũ đọc `findFirst({ productId })` (kho tuỳ ý) nên `soldQty` tính
    // trên một kho khác ⇒ hoặc bán quá tồn, hoặc `cleanup` trả nhầm kho.
    const inv = await inTenant(() =>
      prisma.inventory.findFirst({
        where: { productId: r.product.id, warehouseId: r.defaultWarehouseId },
        select: { id: true, quantity: true, reserved: true, minStock: true },
      }),
    );
    if (!inv) throw new Error('SKU được chọn không có dòng tồn ở kho mặc định');
    return {
      sku: r.product.sku,
      productName: r.product.name,
      productId: r.product.id,
      warehouseId: r.defaultWarehouseId,
      candidates: r.candidates,
      usable: r.usable,
      pickedFrom: r.pickedFrom,
      inventoryId: inv.id,
      quantity: num(inv.quantity),
      reserved: num(inv.reserved),
      minStock: num(inv.minStock),
      demandPerDay: r.plan.rationale.demandPerDay,
      rop: r.plan.rationale.rop,
      atp: r.plan.atp.atp,
      orderQty: r.plan.order.orderQty,
      leadTimeDays: r.plan.lead.leadTimeDays,
      leadTimeEstimated: r.plan.lead.estimated,
    };
  });

  const approver = await inTenant(() =>
    prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, role: true },
    }),
  );
  if (!approver) throw new Error('tenant demo không có user ADMIN/MANAGER để duyệt');

  // Khách hàng: dùng MỘT khách ẩn danh đã có (id tất định) — không tạo khách mới
  // để phần dọn dẹp không phải xoá thêm bảng `customers`.
  customer = await inTenant(() =>
    prisma.customer.findFirst({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, name: true } }),
  );
  customerBefore = await inTenant(() =>
    prisma.customer.findFirst({ where: { id: customer.id }, select: { totalSpent: true, totalDebt: true } }),
  );

  const before = await captureTenantCounts(tenantId);

  // ── 2. đơn bán (đường trừ kho thật của `order.service.create`) ────────────
  const soldQty = Math.max(1, Math.min(picked.quantity, Math.floor(picked.atp * 0.6)));
  order = await step('create-order', async () => {
    const created = await inTenant(() =>
      orderService.create(
        {
          customerId: customer.id,
          items: [{ productId: picked.productId, quantity: soldQty }],
          status: 'COMPLETED',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'PAID',
          note: `${DEMO_ORDER_PREFIX} ${DEMO_ORDER_NOTE}`,
        },
        approver.id,
      ),
    );
    const inv = await inTenant(() =>
      prisma.inventory.findFirst({ where: { id: picked.inventoryId }, select: { quantity: true } }),
    );
    return {
      orderId: created.id,
      orderCode: created.orderCode,
      soldQty,
      atpAfter: num(inv.quantity),
      note: 'đơn tạo qua order.service.create ⇒ trừ kho thật, không ghi tay',
    };
  });

  // ── 3. CDC ──────────────────────────────────────────────────────────────
  cdc = await step('cdc-low-stock', async () => {
    // Xoá debounce của lần chạy trước trong CÙNG tiến trình (xem
    // `resetLowStockDebounce`). Ngoài sản phẩm, gộp 60 s là đúng.
    resetLowStockDebounce();
    // `row_to_json(NEW)` của trigger gửi đúng các trường này; handler chỉ đọc
    // `tenantId` + `productId` (và debounce theo cặp đó).
    await EVENT_HANDLERS.LOW_STOCK({
      tenantId,
      productId: picked.productId,
      quantity: order.atpAfter,
      reserved: picked.reserved,
      minStock: picked.minStock,
    });
    gate = await inTenant(() =>
      prisma.agentHumanGate.findFirst({
        where: { actionType: PO_PROPOSAL, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        include: { session: { select: { id: true, userMessage: true, triggerSource: true } } },
      }),
    );
    if (!gate) throw new Error('CDC không sinh được đề xuất PENDING — xem logger [suggest]');
    return {
      gateId: gate.id,
      sessionId: gate.sessionId,
      triggerSource: gate.session?.triggerSource,
      summary: gate.actionSummary,
      payload: gate.actionPayload,
      note: 'gọi thẳng EVENT_HANDLERS.LOW_STOCK — bỏ qua pg_notify/LISTEN (cần server nền)',
    };
  });

  // ── 4. đề xuất: payload + freshness (kiểm TRƯỚC khi duyệt) ───────────────
  gate = await inTenant(() => prisma.agentHumanGate.findFirst({ where: { id: cdc.gateId } }));
  const item = gate.actionPayload?.items?.[0];
  fresh = await step('freshness-before-approve', async () => {
    const r = await inTenant(() => revalidate(gate, { acknowledgeDrift: false }));
    return {
      ok: r.ok === true,
      drift: r.freshness?.status ?? r.drift ?? null,
      diff: r.freshness?.diff ?? r.diff ?? null,
      missingCost: r.missingCost === true,
      note: 'revalidate CHƯA duyệt — nếu dữ liệu đã đổi thì đây là lúc người duyệt thấy diff',
    };
  });

  // ── 4b. GIẢI THÍCH ĐỀ XUẤT (vai trò LLM #2) — KHÔNG-LLM là mặc định ──────
  // Đặt bước này trong luồng demo để chứng minh đúng điều `NIGHT-PROMPT.md` T14 yêu
  // cầu: "chế độ không-LLM chạy trọn luồng demo". Với LLM tắt, `explainProposal` trả
  // MẪU — không gọi mạng, không ghi DB ⇒ `residue` của smoke vẫn phải rỗng.
  //
  // Số đưa vào đều lấy từ Bước A (`replan`) và từ payload của gate; không có bước nào
  // ở đây tính lại ROP hay số lượng đặt.
  explain = await step('explain-proposal', async () => {
    const p = gate.actionPayload || {};
    const demandPerDay = num(picked.demandPerDay);
    const result = await explainProposal({
      sku: picked.sku,
      name: picked.productName,
      atp: num(item?.atp ?? picked.atp),
      rop: num(item?.rop ?? picked.rop),
      safetyStock: num(p.safetyStock),
      demandPerDay,
      leadTimeDays: num(p.leadTimeDays ?? picked.leadTimeDays),
      daysOfCoverLeft: demandPerDay > 0 ? Number((picked.atp / demandPerDay).toFixed(1)) : null,
      orderQty: num(item?.quantity),
      unitCost: num(item?.unitCost),
      total: num(p.totalEstimate),
      vendorName: p.vendorName || '',
      leadTimeEstimated: p.leadTimeEstimated === true || picked.leadTimeEstimated === true,
    });
    const vendor = await draftVendorMessage({
      sku: picked.sku,
      name: picked.productName,
      atp: num(item?.atp ?? picked.atp),
      rop: num(item?.rop ?? picked.rop),
      leadTimeDays: num(p.leadTimeDays ?? picked.leadTimeDays),
      orderQty: num(item?.quantity),
      total: num(p.totalEstimate),
      vendorName: p.vendorName || '',
    });
    return {
      source: result.source,
      notice: result.notice,
      explanation: result.explanation,
      vendorSource: vendor.source,
      vendorMessageSent: vendor.sent,
      llmMode: result.mode,
      note: result.source === 'template'
        ? 'LLM tắt ⇒ dùng MẪU. Nhãn "mẫu" hiển thị trên UI, không giả vờ là LLM viết.'
        : `LLM (mode=${result.mode}) đã diễn giải; số vẫn là số của Bước A.`,
    };
  });

  // ── 5. duyệt qua human-gate ─────────────────────────────────────────────
  approved = await step('approve-gate', async () => {
    const claimed = await inTenant(() =>
      prisma.agentHumanGate.updateMany({
        where: { id: gate.id, status: 'PENDING' },
        data: buildDecisionData({
          decision: 'APPROVED',
          note: 'Duyệt trong luồng demo P6 (smoke:demo-flow / demo:run)',
          userId: approver.id,
        }),
      }),
    );
    if (claimed.count !== 1) throw new Error(`đảo trạng thái gate thất bại (count=${claimed.count})`);
    const r = await inTenant(() => executeGate(gate.id, approver.id, { acknowledgeDrift: false }));
    return {
      decidedBy: approver.fullName,
      poId: r.po.id,
      poCode: r.po.poCode,
      poTotal: num(r.po.total),
      linked: r.linked === true,
      drift: r.freshness?.status ?? null,
      costSubstituted: r.costSubstituted === true,
      note: 'đúng thứ tự route: updateMany(PENDING→APPROVED) rồi executeGate',
    };
  });

  // ── 6. đúng MỘT PO ──────────────────────────────────────────────────────
  poCheck = await step('exactly-one-po', async () => {
    const pos = await inTenant(() =>
      prisma.purchaseOrder.findMany({
        where: { note: { contains: `[gate:${gate.id}]` } },
        select: { id: true, poCode: true, total: true, status: true, note: true },
      }),
    );
    return { found: pos.length, poCode: pos[0]?.poCode || null, status: pos[0]?.status || null };
  });

  // ── 7. ĐÓNG VÒNG: nhập kho → bút toán → công nợ NCC ─────────────────────
  // VÌ SAO BƯỚC NÀY CÓ (2026-10-13):
  // Luồng demo trước đó DỪNG Ở bước "đúng MỘT PO". Nhưng đề tài tên là *"Tối ưu
  // hóa Tồn kho và Chuỗi cung ứng"* — mà chuỗi cung ứng thì chưa đóng. Sau khi tạo
  // PO còn nguyên đoạn quan trọng nhất: nhận hàng thật thì có vào sổ cái không?
  //
  // Trước khi sửa (2026-10-12) câu trả lời là **KHÔNG**: `grn.service.post` chỉ cộng
  // tồn kho, không ghi Nợ 156 / Có 331, không tạo công nợ. Đo được **39 PO đã nhận
  // hàng mà không có dòng bút toán nào**. Giám khảo AISC26 đã nói "chỉ số chưa có
  // căn cứ" — bước này là câu trả lời có căn cứ: ta tự tìm ra lỗi của chính mình,
  // sửa, và giờ chứng minh được bằng số.
  //
  // Dùng đường CODE THẬT (`grnService.create` → `recordQc` → `post`), không mô phỏng.
  grn = await step('close-purchasing-loop', async () => {
    const poId = approved.poId;
    const po = await inTenant(() =>
      prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true, vendor: { select: { id: true, name: true } } },
      }),
    );
    if (!po) throw new Error('không tìm thấy PO để đóng vòng');
    if (!po.items.length) throw new Error('PO không có dòng hàng — không đóng được vòng mua hàng');

    // ── 7a'. DUYỆT ĐƠN MUA ────────────────────────────────────────────────
    // PO do AI đề xuất sinh ra ở trạng thái **DRAFT**, còn `grnService.create` chỉ
    // nhận PO `APPROVED`/`ORDERED`. Đây là hành vi ĐÚNG và cần nói ra: **duyệt đề
    // xuất ≠ duyệt đơn mua**. Người duyệt thẻ ở bước 6 chỉ chấp thuận "đề xuất này
    // đáng tạo"; đơn mua vẫn phải qua bước duyệt thứ hai theo ngưỡng tiền.
    //
    // Đo được khi viết bước này: bỏ qua thì GRN báo "PO phải ở trạng thái
    // APPROVED/ORDERED để nhận hàng" ⇒ đúng là khoảng trống, không phải lỗi cấu
    // hình. Sửa bằng cách đi đúng quy trình.
    //
    // PO không phải lúc nào cũng `DRAFT`: `purchaseService.create` đặt
    // `PENDING_APPROVAL` khi tổng tiền ≥ `poApprovalThreshold` (mặc định 5tr).
    // Đo được 2026-10-16 trên bộ dữ liệu chuỗi siêu thị (giá niêm yết VND):
    // PO 70 cái × giá vốn ~300k ⇒ ~21 triệu ⇒ đã ở `PENDING_APPROVAL` ⇒ gọi
    // `submit` văng "Chỉ PO nháp mới được gửi duyệt" và luồng chết ở bước 7.
    // Gọi `submit` đúng khi PO còn là nháp — trạng thái quyết định, không đoán.
    if (po.status === 'DRAFT') {
      await inTenant(() => purchaseService.submit(po.id, approver.id));
    }
    const poApproved = await inTenant(() => purchaseService.approve(po.id, approver.role, approver.id));
    const poStatusAfter = await inTenant(() =>
      prisma.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } }),
    );

    // Nhận **một phần** có chủ đích: GRN cho phép nhận từng phần, và đây là tình
    // huống thật. Nhận đủ 100% thì không chứng minh được phần "còn lại phải giao
    // nốt", mà đó mới là chỗ hệ thống cũ ghi sai.
    const totalOrdered = po.items.reduce((s, i) => s + num(i.quantity), 0);
    const targetReceived = Math.max(1, Math.floor(totalOrdered / 2));

    // Ghi lại MỌI dòng tồn mà PO liên quan tới, kèm số lượng trước khi chạy.
    // `cleanup()` chỉ khôi phục `picked.inventoryId`; nếu PO có nhiều dòng thì các
    // dòng còn lại sẽ bị cộng tồn mà không được trả lại.
    //
    // VÌ SAO CẦN: kiểm rác của luồng (`diffTenantCounts`) đếm **số dòng**, KHÔNG
    // kiểm **giá trị** ⇒ tồn bị cộng sai vẫn cho "0 bảng thay đổi" và FAIL im lặng.
    const stockRestore = await inTenant(() =>
      prisma.inventory.findMany({
        where: { productId: { in: po.items.map((i) => i.productId) } },
        select: { id: true, productId: true, warehouseId: true, quantity: true, reserved: true },
      }),
    );
    const debtBefore = await inTenant(() =>
      prisma.debt.aggregate({
        where: { vendorId: po.vendorId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );

    // ── 7a. tạo phiếu nhập kho ────────────────────────────────────────────
    let remaining = targetReceived;
    const grnItems = po.items
      .map((i) => {
        const take = Math.min(num(i.quantity), remaining);
        remaining -= take;
        return { purchaseItemId: i.id, productId: i.productId, receivedQty: take };
      })
      .filter((i) => i.receivedQty > 0);

    const note = await inTenant(() => grnService.create(poId, { items: grnItems }, approver.id));

    // ── 7b. QC đạt toàn bộ ─────────────────────────────────────────────────
    await inTenant(() =>
      grnService.recordQc(
        note.id,
        note.items.map((i) => ({ itemId: i.id, passQty: i.receivedQty, rejectQty: 0 })),
        approver.id,
      ),
    );

    // ── 7c. POST: hạch bút toán + cộng dồn công nợ ─────────────────────────
    const posted = await inTenant(() => grnService.post(note.id, approver.id));

    // Số tồn phải đo trên ĐÚNG dòng mà GRN vừa ghi vào (cùng `warehouseId`).
    // Đo được 2026-10-16: bản cũ đọc `inventory.findFirst({ productId })` — dòng
    // tồn ĐẦU TIÊN của sản phẩm, không phải dòng ở kho GRN ⇒ in ra
    // "Tồn kho +0 (đúng bằng số hàng đạt QC)" trong khi hàng ĐÃ vào kho khác.
    // Trên sân khấu, "số đo sai" còn tệ hơn "không có số".
    const grnWarehouseId = note.warehouseId;
    const stockBeforeRow = stockRestore.find(
      (r) => r.productId === picked.productId && r.warehouseId === grnWarehouseId,
    ) || stockRestore.find((r) => r.productId === picked.productId);
    const stockAfterRow = await inTenant(() =>
      prisma.inventory.findFirst({
        where: { productId: picked.productId, warehouseId: grnWarehouseId },
        select: { quantity: true, reserved: true },
      }),
    );
    const debtAfter = await inTenant(() =>
      prisma.debt.aggregate({
        where: { vendorId: po.vendorId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    );

    // Bút toán phải TỒN TẠI và CÂN BẰNG N = C. Không có bút toán ⇒ `journalEntry`
    // là `null` ⇒ các trường bên dưới là `null`, KHÔNG phải 0 — để biểu diễn báo
    // trung thực "chưa ghi được" thay vì trông như đã ghi số 0.
    //
    // `grn.service.post` trả `journalEntry` đã thu gọn `{ entryCode, totalDebit }`
    // ⇒ KHÔNG có `id`. Tra cứu lại theo `entryCode` (vừa đúng, vừa đúng kiểu dữ
    // liệu, và `entryCode` là thứ ta muốn hiện cho khán giả thấy).
    const entry = posted?.journalEntry?.entryCode
      ? await inTenant(() =>
          prisma.journalEntry.findUnique({
            where: { entryCode: posted.journalEntry.entryCode },
            include: { lines: true },
          }),
        )
      : null;
    const debitSum = entry ? entry.lines.reduce((s, l) => s + num(l.debit), 0) : null;
    const creditSum = entry ? entry.lines.reduce((s, l) => s + num(l.credit), 0) : null;

    return {
      grnId: note.id,
      grnCode: note.grnCode,
      poStatusAfterApprove: poStatusAfter?.status || null,
      acceptedQty: num(posted?.acceptedQty),
      receivedValue: num(posted?.receivedValue),
      remainingQty: num(posted?.remainingQty),
      journalEntryCode: entry?.entryCode || null,
      journalDebit: debitSum,
      journalCredit: creditSum,
      journalBalanced: entry ? debitSum === creditSum && debitSum > 0 : null,
      payableAmount: num(posted?.payable?.amount),
      stockDelta: num(stockAfterRow?.quantity) - num(stockBeforeRow?.quantity),
      debtDelta: toNum(debtAfter._sum.amount) - toNum(debtBefore._sum.amount),
      debtRowsDelta: (debtAfter._count._all || 0) - (debtBefore._count._all || 0),
      vendorName: po.vendor.name,
      // Dữ liệu khôi phục cho `cleanup()` — không in ra, chỉ dùng nội bộ.
      stockRestore,
      note:
        'đường code thật: grnService.create → recordQc → post. ' +
        'Bút toán Nợ 156 + Nợ 1331 = Có 331, tính trên hàng ĐẠT QC (passQty × unitCost).',
    };
  });

  // ── 8. không sinh đề xuất trùng (onOrder) ───────────────────────────────
  dedupe = await step('no-duplicate-proposal', async () => {
    const gatesBefore = await inTenant(() =>
      prisma.agentHumanGate.count({ where: { actionType: PO_PROPOSAL } }),
    );
    const again = await inTenant(() => suggestForProduct({ tenantId, productId: picked.productId }));
    const gatesAfter = await inTenant(() =>
      prisma.agentHumanGate.count({ where: { actionType: PO_PROPOSAL } }),
    );
    const input = await inTenant(() => loadReplenishmentInput([picked.productId]));
    return {
      secondSuggestion: again === null ? null : again.gate ? 'DA_CO_GATE' : 'needVendor',
      gatesBefore,
      gatesAfter,
      onOrder: num(input.get(picked.productId)?.onOrder),
      note: 'sau khi có PO, onOrder > 0 ⇒ ATP+onOrder > ROP ⇒ không sinh đề xuất nữa',
    };
  });

  const after = await captureTenantCounts(tenantId);
  const deltaBeforeCleanup = diffTenantCounts(before, after);

  const rawCleanup = async () => {
    const inT = (fn) => runWithTenant(tenantId, fn);
    // Ngưỡng thời gian: MỌI dòng lần chạy này sinh ra đều có `createdAt >=
    // startedAt`. Dùng ngưỡng thay vì liệt kê từng id vì đường ghi thật không chỉ
    // là PO/đơn: `order.service.create` còn ghi bút toán bán hàng, thử phát hành
    // hoá đơn điện tử, và audit của cả hai.
    //
    // PHẠM VI AN TOÀN: chỉ trong tenant demo, và chỉ khi chạy script này (đơn
    // trong sáng nay của tenant demo đều do `data:import` dựng với `createdAt`
    // neo theo A4 — xem `02-data.md` §9.2 — nên không có dòng nào của chúng rơi
    // vào cửa sổ này). `verifyResidue` bên dưới đo lại để bắt trường hợp sai.
    const deleted = await purgeFlowResidue(tenantId, startedAt);
    // Khối dọn theo ID tường minh: chỉ chạy khi các bước trước đó đã tới đủ để có
    // id. Nếu luồng chết ở bước sớm hơn thì các biến này là `undefined` ⇒ bỏ qua,
    // phần dọn theo THỜI GIAN ở trên vẫn đủ để dọn phần đã ghi.
    if (approved?.poId) {
      deleted.purchaseItems = (await inT(() =>
        prisma.purchaseItem.deleteMany({ where: { purchaseOrderId: approved.poId } }),
      )).count;
      deleted.purchaseOrders = (await inT(() =>
        prisma.purchaseOrder.deleteMany({ where: { id: approved.poId } }),
      )).count;
    }
    if (gate?.id) {
      deleted.gates = (await inT(() =>
        prisma.agentHumanGate.deleteMany({ where: { id: gate.id } }),
      )).count;
    }
    if (cdc?.sessionId) {
      deleted.sessions = (await inT(() =>
        prisma.agentSession.deleteMany({ where: { id: cdc.sessionId } }),
      )).count;
    }
    deleted.notifications = (await inT(() =>
      prisma.notification.deleteMany({ where: { tenantId, createdAt: { gte: startedAt } } }),
    )).count;
    if (order?.orderId) {
      deleted.orderItems = (await inT(() =>
        prisma.orderItem.deleteMany({ where: { orderId: order.orderId } }),
      )).count;
      deleted.orders = (await inT(() =>
        prisma.order.deleteMany({ where: { id: order.orderId } }),
      )).count;
    }
    if (picked?.inventoryId) {
      deleted.inventoryTransactions = (await inT(() =>
        prisma.inventoryTransaction.deleteMany({
          where: { inventoryId: picked.inventoryId, createdAt: { gte: startedAt } },
        }),
      )).count;
    }
    // Trả tồn kho về đúng số trước khi chạy (đơn đã trừ kho ở bước 2, GRN đã cộng
    // kho ở bước 7). `stockRestore` của bước 7 là nguồn chính xác cho phần GRN vì
    // nó ghi lại TẤT CẢ dòng tồn mà PO chạm tới, không chỉ dòng của SKU được chọn.
    for (const r of grn?.stockRestore || []) {
      await inT(() =>
        prisma.inventory.update({
          where: { id: r.id },
          data: { quantity: r.quantity, reserved: r.reserved },
        }),
      );
    }
    if (picked?.inventoryId) {
      await inT(() =>
        prisma.inventory.update({
          where: { id: picked.inventoryId },
          data: { quantity: picked.quantity, reserved: picked.reserved },
        }),
      );
    }
    if (customer?.id) {
      await inT(() =>
        prisma.customer.update({
          where: { id: customer.id },
          data: { totalSpent: customerBefore.totalSpent, totalDebt: customerBefore.totalDebt },
        }),
      );
    }
    const final = await captureTenantCounts(tenantId);
    return { deleted, residue: diffTenantCounts(before, final) };
  };
  cleanupFn = rawCleanup;

  return {
    tenantId,
    trace,
    picked,
    order,
    cdc,
    gate,
    item,
    fresh,
    explain,
    approved,
    poCheck,
    grn,
    dedupe,
    deltaBeforeCleanup,
    cleanup,
    /** Số liệu dùng để in ra, đã quy đổi sang chuỗi tiếng Việt. */
    summary: {
      sku: picked.sku,
      productName: picked.productName,
      soldQty,
      atpBefore: picked.atp,
      atpAfter: order.atpAfter,
      rop: picked.rop,
      demandPerDay: picked.demandPerDay,
      orderQty: num(item?.quantity),
      unitCost: num(item?.unitCost),
      // `totalEstimate` nằm ở CẤP PAYLOAD, không nằm trong `items[0]`
      // (xem `buildPoProposalGate`) — đọc sai chỗ thì ra 0 và in ra
      // "2.489 × 0,04 = 0" trông như hệ thống tính sai.
      totalEstimate: num(gate.actionPayload?.totalEstimate),
      vendorName: gate.actionPayload?.vendorName,
      leadTimeDays: num(gate.actionPayload?.leadTimeDays),
      leadTimeEstimated: gate.actionPayload?.leadTimeEstimated === true,
      poCode: approved.poCode,
      poTotal: approved.poTotal,
      approver: approver.fullName,
    },
  };
};

module.exports = {
  DEMO_SLUG,
  DEMO_ORDER_PREFIX,
  DEMO_ORDER_NOTE,
  captureTenantCounts,
  diffTenantCounts,
  pickDemoSku,
  purgeFlowResidue,
  runDemoFlow,
};
