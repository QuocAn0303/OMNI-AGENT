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
 * ĐƯỜNG ĐI (7 bước, mỗi bước đều là đường mã sản phẩm thật)
 * ============================================================================
 *   1. chọn SKU          — công thức `planReplenishment` (KHÔNG dùng LLM)
 *   2. tạo đơn           — `order.service.create` (trừ kho thật)
 *   3. CDC               — `EVENT_HANDLERS.LOW_STOCK` (đúng hàm mà `pg_notify` gọi)
 *   4. đề xuất PENDING   — `replenishment.suggest` (tự tạo human-gate)
 *   5. kiểm tra drift    — `revalidate` CHƯA duyệt: đây là bằng chứng `freshness`
 *   6. duyệt             — `buildDecisionData` (đảo trạng thái) + `executeGate`
 *   7. chống trùng       — `suggestForProduct` lần 2 ⇒ `onOrder` đã che ⇒ không
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
const { buildDecisionData, PO_PROPOSAL } = require(`${ROOT}/src/modules/ai/agent.humangate`);

const DEMO_SLUG = 'omni-demo-mo-phong';
/** Mã đơn demo có tiền tố này ⇒ dọn lại được, không nhầm đơn sàn. */
const DEMO_ORDER_PREFIX = 'P6-DEMO-';
const DEMO_ORDER_NOTE = 'MÔ PHỎNG — đơn sinh bởi luồng demo P6 (không phải đơn thật)';
/** Số SKU ứng viên tối đa để chọn — đủ để có dữ liệu, không quét cả 500 SKU. */
const MAX_CANDIDATES = 20;

const num = (v) => Number(v || 0);

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
 * Chọn SKU có `orderQty` LỚN NHẤT (đề xuất nhìn được rõ), hoà thì theo sku tăng dần.
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
    }),
  );
  const seen = new Set();
  const uniqueProducts = [];
  for (const row of vendorLinked) {
    if (!row.product || seen.has(row.product.id)) continue;
    seen.add(row.product.id);
    uniqueProducts.push(row.product);
  }
  const candidates = [];
  for (const product of uniqueProducts.slice(0, MAX_CANDIDATES)) {
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
    candidates.push({ product, plan, atp });
    if (atp < 1) continue;
    if (plan.status !== NEED_REPLENISHMENT && plan.status !== STOCKOUT) continue;
    if (!plan.order.orderQty || plan.order.orderQty <= 0) continue;
  }
  const openKeys = await inTenant(() => findOpenProposalKeys());
  const usable = candidates
    .filter((c) => c.atp >= 1 && c.plan.order.orderQty > 0)
    .filter((c) => !openKeys.some((k) => k.startsWith(`PROPOSAL:${c.product.id}:`)))
    .sort((a, b) => b.plan.order.orderQty - a.plan.order.orderQty || a.product.sku.localeCompare(b.product.sku));
  if (!usable.length) {
    throw new Error(
      `KHÔNG có SKU nào đủ điều kiện chạy luồng demo (ứng viên ${candidates.length}). ` +
      `Kiểm tra giả định A5 (PO tiền sử) và A4 (cửa sổ ngày) trong 02-data.md §9.2.`,
    );
  }
  return { ...usable[0], candidates: candidates.length, usable: usable.length };
};

/**
 * Chạy trọn luồng. Trả về `trace` (mỗi bước có `ms` để đo trong trình diễn) và
 * `cleanup()` để trả DB về trạng thái trước.
 */
const runDemoFlow = async ({ tenantId, onEvent = () => {} } = {}) => {
  const trace = [];
  const inTenant = (fn) => runWithTenant(tenantId, fn);
  const step = async (name, fn) => {
    const t0 = Date.now();
    const data = await fn();
    const ms = Date.now() - t0;
    trace.push({ step: name, ms, ...data });
    onEvent({ step: name, ms, ...data });
    return data;
  };
  const startedAt = new Date();

  // ── 1. chọn SKU ─────────────────────────────────────────────────────────
  const picked = await step('pick-sku', async () => {
    const r = await pickDemoSku(tenantId);
    const inv = await inTenant(() =>
      prisma.inventory.findFirst({
        where: { productId: r.product.id },
        select: { id: true, quantity: true, reserved: true, minStock: true },
      }),
    );
    return {
      sku: r.product.sku,
      productName: r.product.name,
      productId: r.product.id,
      candidates: r.candidates,
      usable: r.usable,
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
  const customer = await inTenant(() =>
    prisma.customer.findFirst({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, name: true } }),
  );
  const customerBefore = await inTenant(() =>
    prisma.customer.findFirst({ where: { id: customer.id }, select: { totalSpent: true, totalDebt: true } }),
  );

  const before = await captureTenantCounts(tenantId);

  // ── 2. đơn bán (đường trừ kho thật của `order.service.create`) ────────────
  const soldQty = Math.max(1, Math.min(picked.quantity, Math.floor(picked.atp * 0.6)));
  const order = await step('create-order', async () => {
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
  const cdc = await step('cdc-low-stock', async () => {
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
    const gate = await inTenant(() =>
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
  const gate = await inTenant(() => prisma.agentHumanGate.findFirst({ where: { id: cdc.gateId } }));
  const item = gate.actionPayload?.items?.[0];
  const fresh = await step('freshness-before-approve', async () => {
    const r = await inTenant(() => revalidate(gate, { acknowledgeDrift: false }));
    return {
      ok: r.ok === true,
      drift: r.freshness?.status ?? r.drift ?? null,
      diff: r.freshness?.diff ?? r.diff ?? null,
      missingCost: r.missingCost === true,
      note: 'revalidate CHƯA duyệt — nếu dữ liệu đã đổi thì đây là lúc người duyệt thấy diff',
    };
  });

  // ── 5. duyệt qua human-gate ─────────────────────────────────────────────
  const approved = await step('approve-gate', async () => {
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
  const poCheck = await step('exactly-one-po', async () => {
    const pos = await inTenant(() =>
      prisma.purchaseOrder.findMany({
        where: { note: { contains: `[gate:${gate.id}]` } },
        select: { id: true, poCode: true, total: true, status: true, note: true },
      }),
    );
    return { found: pos.length, poCode: pos[0]?.poCode || null, status: pos[0]?.status || null };
  });

  // ── 7. không sinh đề xuất trùng (onOrder) ───────────────────────────────
  const dedupe = await step('no-duplicate-proposal', async () => {
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

  const cleanup = async () => {
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
    const since = startedAt;
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
    const freshOrderIds = (await inT(() =>
      prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { id: true } }),
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
    deleted.orders = (await inT(() =>
      prisma.order.deleteMany({ where: { createdAt: { gte: since } } }),
    )).count;
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
    deleted.purchaseItems = (await inT(() =>
      prisma.purchaseItem.deleteMany({ where: { purchaseOrderId: approved.poId } }),
    )).count;
    deleted.purchaseOrders = (await inT(() =>
      prisma.purchaseOrder.deleteMany({ where: { id: approved.poId } }),
    )).count;
    deleted.gates = (await inT(() =>
      prisma.agentHumanGate.deleteMany({ where: { id: gate.id } }),
    )).count;
    deleted.sessions = (await inT(() =>
      prisma.agentSession.deleteMany({ where: { id: cdc.sessionId } }),
    )).count;
    deleted.notifications = (await inT(() =>
      prisma.notification.deleteMany({ where: { tenantId, createdAt: { gte: startedAt } } }),
    )).count;
    deleted.orderItems = (await inT(() =>
      prisma.orderItem.deleteMany({ where: { orderId: order.orderId } }),
    )).count;
    deleted.orders = (await inT(() =>
      prisma.order.deleteMany({ where: { id: order.orderId } }),
    )).count;
    deleted.inventoryTransactions = (await inT(() =>
      prisma.inventoryTransaction.deleteMany({
        where: { inventoryId: picked.inventoryId, createdAt: { gte: startedAt } },
      }),
    )).count;
    // Trả tồn kho về đúng số trước khi chạy (đơn đã trừ kho ở bước 2).
    await inT(() =>
      prisma.inventory.update({
        where: { id: picked.inventoryId },
        data: { quantity: picked.quantity, reserved: picked.reserved },
      }),
    );
    await inT(() =>
      prisma.customer.update({
        where: { id: customer.id },
        data: { totalSpent: customerBefore.totalSpent, totalDebt: customerBefore.totalDebt },
      }),
    );
    const final = await captureTenantCounts(tenantId);
    return { deleted, residue: diffTenantCounts(before, final) };
  };

  return {
    tenantId,
    trace,
    picked,
    order,
    cdc,
    gate,
    item,
    fresh,
    approved,
    poCheck,
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
  runDemoFlow,
};