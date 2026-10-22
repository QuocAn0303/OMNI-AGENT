/**
 * scripts/diag-order-timing.js — ĐO xem bước `create-order` mất thời gian ở đâu
 *
 * VÌ SAO CÓ: `npm run demo:run` in ra `· create-order 19157 ms`. 19 giây chết
 * trên sân khấu là mất người nghe. Đo từng phần thay vì đoán.
 *
 * Chỉ đọc + ghi 1 đơn rồi dọn lại — dùng `order.service.create` đúng đường mã
 * luồng demo, và gọi lại chính nó để so sánh lần 1 (kết nối lạnh) vs lần 2.
 *
 * `npm run diag:order-timing`
 */
require('dotenv').config();
const { assertLocalDb } = require('./lib/assert-local-db');
assertLocalDb('diag-order-timing');

const prisma = require('../src/config/prisma');
const { runWithTenant } = require('../src/config/tenantContext');
const orderService = require('../src/modules/orders/order.service');
const { listScopedTables } = require('./lib/teardown');

const DEMO_SLUG = 'omni-demo-mo-phong';
const ms = (t0) => `${Date.now() - t0} ms`;
const stamp = () => `[diag] ${new Date().toISOString().slice(11, 19)}`;

/** Đếm số dòng mỗi bảng scoped của tenant — giống hệt cách luồng demo đo rác. */
const countTenant = async (tenantId) => {
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

(async () => {
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (!tenant) throw new Error(`không có tenant ${DEMO_SLUG} — chạy npm run demo:setup trước`);
  const tenantId = tenant.id;
  const inT = (fn) => runWithTenant(tenantId, fn);

  const startedAt = new Date();
  const before = await countTenant(tenantId);
  const since = startedAt;
  const user = await inT(() => prisma.user.findFirst({
    where: { tenantId, role: { in: ['ADMIN', 'MANAGER', 'CASHIER'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true },
  }));
  // Chọn SKU theo TỒN KHO, không chọn SKU đầu tiên — nếu không đơn 572 đơn vị sẽ
// bị chặn bởi quy tắc "không đủ số lượng có thể bán" và ta đo nhầm thứ khác.
  const inv = await inT(() => prisma.inventory.findFirst({
    where: { quantity: { gte: 600 } },
    orderBy: { quantity: 'desc' },
    select: { id: true, productId: true, quantity: true, reserved: true, product: { select: { sku: true, price: true } } },
  }));
  const product = inv?.product;
  const touchedInventoryIds = inv ? [inv.id] : [];
  if (!user || !product) throw new Error('thiếu user, hoặc không có SKU nào còn ≥ 600 đơn vị');
  const unitPrice = Number(product.price ?? 1);
  console.log(`${stamp()} user=${user.role} sku=${product.sku} tồn=${inv.quantity} giá=${unitPrice}`);

  // Chụp tồn trước khi chạy — bản chẩn đoán đầu chỉ đếm SỐ DÒNG nên không phát
  // hiện được việc tồn bị trừ sai. Giờ khôi phục được.
  const stockSnapshot = await inT(() => prisma.inventory.findMany({
    where: { id: { in: touchedInventoryIds } },
    select: { id: true, quantity: true, reserved: true },
  }));

  // Một đơn tối giản: 1 dòng, 1 sản phẩm.
  //
  // THAM SỐ `qty` CỐ Ý THAY ĐỔI: giả thuyết cần kiểm là "số lượng bán lớn làm
  // `order.service.create` chậm". Luồng demo bán ~572 đơn vị, bản chẩn đoán đầu
  // bán 1 và chỉ mất 300–400 ms — trong khi `demo:run` in ra 19157 ms.
  const makePayload = (n, qty) => ({
    customerId: null,
    items: [{ productId: inv.productId, quantity: qty, unitPrice }],
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    note: `DIAG-ORDER-TIMING-${n}`,
  });

  const timings = [];
  const orderIds = [];
  // [nhãn, số lượng] — cùng SKU, chỉ khác số lượng.
  const CASES = [['qty=1', 1], ['qty=572', 572], ['qty=1 (lại)', 1]];
  for (let i = 0; i < CASES.length; i += 1) {
    const [label, qty] = CASES[i];
    let t0 = Date.now();
    const order = await inT(() => orderService.create(makePayload(i + 1, qty), user.id));
    orderIds.push(order.id);
    const took = Date.now() - t0;
    timings.push({ label, qty, total: took });
    console.log(`${stamp()} ${label.padEnd(12)} tạo đơn ${String(took).padStart(6)} ms · ${order.orderCode || order.id}`);
  }

  console.log('\n── KẾT QUẢ ──');
  for (const t of timings) console.log(`  ${t.label.padEnd(14)} ${String(t.total).padStart(6)} ms`);
  const [c1, c2, c3] = timings;
  console.log(
    c2.total > c1.total * 3 && c3.total < c2.total / 3
      ? `\n  ⇒ SỐ LƯỢNG là nguyên nhân. ${c2.label} chậm ${Math.round(c2.total / c1.total)}× so với`
        + `\n    ${c1.label}, còn ${c3.label} nhanh lại ⇒ KHÔNG phải chi phí kết nối lạnh.`
      : `\n  ⇒ SỐ LƯỢNG không phải nguyên nhân. Cần đào sâu chỗ khác.`,
  );

  // ── Dọn ────────────────────────────────────────────────────────────────
  //
  // KHÔNG ĐỦ nếu chỉ xoá `orders`. `order.service.create` còn ghi ra chuỗi
  // bảng khác — đo được ở bản chẩn đoán đầu: `audit_logs +12`,
  // `electronic_invoices +3`, `inventory_transactions +3`, `journal_entries +3`,
  // `journal_lines +12`. Xoá đơn mà bỏ các bảng đó là để rác.
  //
  // VÀ CŨNG KHÔNG ĐỦ NẾU DỌN MỘT LẦN. `autoIssueForOrder` và
  // `generateInvoice` được gọi kiểu `.catch(() => {})` — KHÔNG await — nên chúng
  // vẫn đang ghi *sau* khi `create` đã trả về. Đo được: dọn một lần còn sót
  // `audit_logs +1` và `electronic_invoices +1`. Vì vậy: chờ việc nền lắng
  // xuống, rồi dọn HAI vòng.
  //
  // Cách dọn: CỬA SỔ THỜI GIAN từ `startedAt` (mọi thứ do lần chạy này sinh ra
  // đều có `createdAt >= startedAt`), giống `purgeFlowResidue` của luồng demo.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const purge = async () => {
    const inT2 = (fn) => runWithTenant(tenantId, fn);
    const freshEntries = await inT2(() => prisma.journalEntry.findMany({
      where: { createdAt: { gte: since } }, select: { id: true },
    })).then((r) => r.map((e) => e.id));

    // Con trước cha, đúng thứ tự phụ thuộc FK.
    if (freshEntries.length) {
      await inT2(() => prisma.journalLine.deleteMany({ where: { entryId: { in: freshEntries } } }));
    }
    await inT2(() => prisma.journalEntry.deleteMany({ where: { createdAt: { gte: since } } }));
    await inT2(() => prisma.electronicInvoice.deleteMany({ where: { createdAt: { gte: since } } }));
    await inT2(() => prisma.auditLog.deleteMany({ where: { createdAt: { gte: since } } }));
    await inT2(() => prisma.debt.deleteMany({ where: { createdAt: { gte: since } } }));
    await inT2(() => prisma.inventoryTransaction.deleteMany({
      where: { inventoryId: { in: touchedInventoryIds }, createdAt: { gte: since } },
    }));
    // Trả tồn về đúng số trước khi chạy — chỉ đếm SỐ DÒNG thì không bắt được
    // việc tồn bị trừ sai mà vẫn ra "0 bảng thay đổi".
    for (const snap of stockSnapshot) {
      await inT2(() => prisma.inventory.update({
        where: { id: snap.id }, data: { quantity: snap.quantity, reserved: snap.reserved },
      }));
    }
    const itemIds = await inT2(() => prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } }, select: { id: true },
    })).then((r) => r.map((i) => i.id));
    if (itemIds.length) {
      await inT2(() => prisma.kdsTicket.deleteMany({ where: { orderItemId: { in: itemIds } } }));
      await inT2(() => prisma.orderItemModifier.deleteMany({ where: { orderItemId: { in: itemIds } } }));
    }
    await inT2(() => prisma.invoice.deleteMany({ where: { createdAt: { gte: since } } }));
    await inT2(() => prisma.payment.deleteMany({ where: { createdAt: { gte: since } } }));
    await inT2(() => prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }));
    await inT2(() => prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
  };

  console.log('\n[demo] chờ việc nền lắng xuống rồi dọn…');
  await sleep(3000);   // đủ cho einvoice/invoice ghi nốt
  await purge();
  await sleep(1500);   // bắt những ghi muộn hơn
  await purge();

  const after = await countTenant(tenantId);
  const num = (v) => Number(v || 0);
  const changed = Object.keys(after).filter((t) => num(before[t]) !== num(after[t]));
  console.log(`[demo] rác: ${changed.length ? changed.map((t) => `${t} ${before[t]}→${after[t]}`).join(', ') : '0 bảng thay đổi ✓'}`);
  if (changed.length) {
    console.log('  ⚠️ CÒN RÁC — KHÔNG chạy lại liên tiếp nhiều lần. Báo lại, đừng tự xoá tay.');
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('LỖI:', e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});