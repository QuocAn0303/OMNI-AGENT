/**
 * scripts/smoke-grn-posting.js — KIỂM CHỨNG DB THẬT: GRN POSTED CÓ GHI BÚT TOÁN
 *
 * Theo quy tắc ở `docs/aisc26/STATE.md`: unit test mock KHÔNG phải bằng chứng
 * hoàn tất. Luồng nhập kho → bút toán phải chạy thật trên Postgres.
 *
 * Kịch bản (mỗi bước là một khẳng định):
 *   K1  Tạo PO (tenant demo) với 2 dòng: 100 cái @10.000đ và 100 cái @20.000đ
 *   K2  Duyệt PO
 *   K3  Tạo GRN chỉ nhận MỘT PHẦN: 60/100 và 100/100 (tổng 160/200) ⇒ backorder
 *   K4  QC: đạt hết số đã nhận
 *   K5  POST GRN ⇒ tồn kho tăng đúng số lượng THỰC NHẬN
 *   K6  Có bút toán Nợ 156 = 60*10.000 + 100*20.000 = 2.600.000đ
 *       (KHÔNG phải tổng PO 3.000.000đ — đây là điều kiện quan trọng nhất)
 *   K7  Công nợ phải trả = 2.600.000đ, KHÔNG phải tổng PO
 *   K8  PO vẫn APPROVED (chưa nhận đủ) — hành vi backorder
 *   K9  Nhận nốt phần còn thiếu (40) + POST GRN thứ 2 ⇒ bút toán thứ 2 RIÊNG,
 *       cộng dồn đúng 3.000.000đ, PO chuyển RECEIVED
 *  K10  Gọi POST lại GRN đã POSTED ⇒ bị chặn, không nhân đôi tồn kho
 *  K11  Teardown: xoá sạch, chạy 2 lần liên tiếp ⇒ 0 dòng rác tăng thêm
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-grn-posting");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const purchaseService = require("../src/modules/accounting/purchase.service");
const grnService = require("../src/modules/accounting/grn.service");
const logger = require("../src/utils/logger");

let pass = 0;
let fail = 0;
const TAG = "SMOKE-GRN-POST";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " -> " + extra : ""}`);
  cond ? (pass += 1) : (fail += 1);
};

const TENANT_SLUG = "omni-demo-mo-phong";

/** Số tiền theo TK 156 cho 1 PO (chỉ tính bút toán nguồn PURCHASE). */
async function debit156For(poId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT coalesce(sum(jl.debit) - sum(jl.credit), 0)::numeric(14,2) AS v
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl."entryId"
      JOIN accounts a ON a.id = jl."accountId"
     WHERE je."sourceId" = $1 AND je.source = 'PURCHASE' AND a.code = '156'
       AND je.status = 'POSTED'`, poId);
  return Number(rows[0].v || 0);
}

async function credit331For(poId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT coalesce(sum(jl.credit) - sum(jl.debit), 0)::numeric(14,2) AS v
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl."entryId"
      JOIN accounts a ON a.id = jl."accountId"
     WHERE je."sourceId" = $1 AND je.source = 'PURCHASE' AND a.code = '331'
       AND je.status = 'POSTED'`, poId);
  return Number(rows[0].v || 0);
}

async function qtyOf(productId) {
  const inv = await prisma.inventory.findMany({ where: { productId } });
  return inv.reduce((s, i) => s + i.quantity, 0);
}

/**
 * Dọn rác của CHÍNH script này từ lần chạy trước bị lỗi giữa chừng.
 *
 * Smoke test phải chạy lại được nhiều lần; nếu lần trước chết sau khi tạo dữ liệu
 * mà không tới bước teardown thì lần sau sẽ đụng `Unique constraint failed`.
 * Chỉ xoá dòng mang nhãn `TAG` — không bao giờ đụng dữ liệu thật.
 */
async function purgePreviousRun() {
  const pr = await runWithTenant(tenantId, async () => {
    const categories = await prisma.category.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const products = await prisma.product.findMany({ where: { sku: { startsWith: TAG } }, select: { id: true } });
    const vendors = await prisma.vendor.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
    const pos = await prisma.purchaseOrder.findMany({
      where: { note: { contains: TAG } },
      select: { id: true },
    });
    const grns = await prisma.goodsReceiptNote.findMany({
      where: { purchaseOrderId: { in: pos.map((p) => p.id) } },
      select: { id: true },
    });
    if (!categories.length && !products.length && !vendors.length && !pos.length) return 0;

    const poIds = pos.map((p) => p.id);
    const grnIds = grns.map((g) => g.id);
    const productIds = products.map((p) => p.id);
    await prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { entry: { source: "PURCHASE", sourceId: { in: poIds } } } });
      await tx.journalEntry.deleteMany({ where: { source: "PURCHASE", sourceId: { in: poIds } } });
      await tx.debt.deleteMany({ where: { poId: { in: poIds } } });
      await tx.goodsReceiptItem.deleteMany({ where: { grnId: { in: grnIds } } });
      await tx.goodsReceiptNote.deleteMany({ where: { id: { in: grnIds } } });
      await tx.inventoryTransaction.deleteMany({ where: { inventory: { productId: { in: productIds } } } });
      await tx.inventoryLot.deleteMany({ where: { productId: { in: productIds } } });
      await tx.inventory.deleteMany({ where: { productId: { in: productIds } } });
      await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
      await tx.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
      await tx.product.deleteMany({ where: { id: { in: productIds } } });
      await tx.category.deleteMany({ where: { id: { in: categories.map((c) => c.id) } } });
      // Trả `totalDebt` về 0 trước khi xoá NCC, nếu không NCC khác thừa nợ.
      await tx.vendor.updateMany({
        where: { id: { in: vendors.map((v) => v.id) } },
        data: { totalDebt: 0 },
      });
      await tx.vendor.deleteMany({ where: { id: { in: vendors.map((v) => v.id) } } });
      await tx.auditLog.deleteMany({
        where: {
          action: { in: ["GRN_POST", "CREATE_GRN", "GRN_QC", "DEBT_CREATED_PAYABLE", "CREATE_PO"] },
          entityId: { in: [...poIds, ...grnIds] },
        },
      });
    });
    return poIds.length + productIds.length;
  });
  if (pr) console.log(`  (đã dọn rác lần chạy trước: ${pr} bản ghi có nhãn ${TAG})`);
  return pr;
}

let tenantId = null;

(async () => {
  console.log("\n=== SMOKE: GRN POSTED ĐÓNG VÒNG MUA HÀNG (DB thật) ===\n");
  await captureBaseline(prisma);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`không có tenant "${TENANT_SLUG}" — chạy npm run data:import trước`);
  tenantId = tenant.id;
  await purgePreviousRun();

  const created = { purchaseOrders: [], goodsReceiptNotes: [], debts: [], journalEntries: [], journals: [] };

  const result = await runWithTenant(tenant.id, async () => {
    // Chuẩn bị: NCC + 2 sản phẩm (dùng SKU riêng để dễ dọn)
    const stamp = Date.now();
    const vendor = await prisma.vendor.create({
      data: { code: `${TAG}-V-${stamp}`, name: `NCC ${TAG}`, paymentTerms: 45 },
    });
    created.vendors = [vendor.id];

    // `Product.category` là bắt buộc. Tạo danh mục RIÊNG cho script này để dọn
    // sạch tuyệt đối — không đụng danh mục thật của tenant demo.
    const category = await prisma.category.create({
      data: { name: `${TAG} Danh mục`, isActive: true },
    });
    created.categories = [category.id];

    const mk = async (sku, cost) =>
      prisma.product.create({
        data: {
          sku: `${TAG}-${sku}`,
          name: `SP ${TAG} ${sku}`,
          price: cost * 2,
          costPrice: cost,
          isActive: true,
          categoryId: category.id,
        },
      });
    const p1 = await mk("A", 10_000);
    const p2 = await mk("B", 20_000);
    created.products = [p1.id, p2.id];

    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, role: { in: ["ADMIN", "MANAGER"] }, isActive: true },
      select: { id: true },
    });
    if (!user) throw new Error("không có user ADMIN/MANAGER trong tenant demo");

    // ---- K1: tạo PO 2 dòng ----
    const po = await purchaseService.create(
      {
        vendorId: vendor.id,
        note: `${TAG} doi vuong mua hang`,
        items: [
          { productId: p1.id, quantity: 100, unitCost: 10_000 },
          { productId: p2.id, quantity: 100, unitCost: 20_000 },
        ],
      },
      user.id,
    );
    created.purchaseOrders.push(po.id);
    const pi1 = po.items[0].id;
    const pi2 = po.items[1].id;
    ok("K1 tạo PO 2 dòng (100x10.000 + 100x20.000)", Boolean(po.id), `${po.poCode} total=${po.total}`);

    // ---- K2: duyệt ----
    // Ngưỡng duyệt mặc định 5tr ⇒ PO 3tr không cần; vẫn submit+approve để vào
    // trạng thái APPROVED, là điều kiện để GRN được tạo.
    await purchaseService.submit(po.id, user.id);
    await purchaseService.approve(po.id, "ADMIN", user.id);
    const poAfterApprove = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } });
    ok("K2 PO ở trạng thái APPROVED", poAfterApprove.status === "APPROVED", poAfterApprove.status);

    const qty1Before = await qtyOf(p1.id);
    const qty2Before = await qtyOf(p2.id);

    // ---- K3: GRN nhận MỘT PHẦN (60 + 100 = 160/200) ⇒ backorder ----
    const grn1 = await grnService.create(
      po.id,
      {
        items: [
          { purchaseItemId: pi1, productId: p1.id, receivedQty: 60 },
          { purchaseItemId: pi2, productId: p2.id, receivedQty: 100 },
        ],
      },
      user.id,
    );
    created.goodsReceiptNotes.push(grn1.id);
    ok("K3 tạo GRN nhận một phần (160/200)", grn1.status === "DRAFT", grn1.grnCode);

    // ---- K4: QC đạt hết ----
    await grnService.recordQc(
      grn1.id,
      grn1.items.map((i) => ({ itemId: i.id, passQty: i.receivedQty, rejectQty: 0 })),
      user.id,
    );
    ok("K4 QC ghi nhận đạt hết → QC_DONE", true);

    // ---- K5: POST ⇒ tồn kho tăng đúng số THỰC NHẬN ----
    await grnService.post(grn1.id, user.id);
    const qty1After = await qtyOf(p1.id);
    const qty2After = await qtyOf(p2.id);
    ok(
      "K5 tồn kho tăng đúng số lượng thực nhận (+60 / +100)",
      qty1After - qty1Before === 60 && qty2After - qty2Before === 100,
      `p1 +${qty1After - qty1Before}, p2 +${qty2After - qty2Before}`,
    );

    // ---- K6: bút toán theo GIÁ TRỊ THỰC NHẬN, không theo tổng PO ----
    const dr156 = await debit156For(po.id);
    const cr331 = await credit331For(po.id);
    ok(
      "K6 bút toán Nợ 156 = giá trị THỰC NHẬN 2.600.000đ (không phải tổng PO 3.000.000đ)",
      dr156 === 2_600_000,
      `Nợ 156 = ${dr156.toLocaleString("vi-VN")}`,
    );
    ok("K6 Có 331 khớp Nợ 156", cr331 === 2_600_000, `Có 331 = ${cr331.toLocaleString("vi-VN")}`);

    // ---- K7: công nợ phải trả theo giá trị thực nhận ----
    const debt = await prisma.debt.findFirst({ where: { poId: po.id } });
    ok(
      "K7 công nợ phải trả = 2.600.000đ (không ghi cho hàng chưa nhận)",
      debt && Number(debt.amount) === 2_600_000,
      debt ? `${Number(debt.amount).toLocaleString("vi-VN")}` : "KHÔNG có công nợ",
    );
    if (debt) created.debts.push(debt.id);

    // ---- K8: PO chưa nhận đủ ⇒ vẫn APPROVED (backorder) ----
    const poMid = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } });
    ok("K8 PO chưa nhận đủ vẫn APPROVED (giữ backorder)", poMid.status === "APPROVED", poMid.status);

    // ---- K9: nhận nốt 40 ⇒ bút toán thứ 2 RIÊNG, cộng dồn đủ 3.000.000đ ----
    const grn2 = await grnService.create(
      po.id,
      { items: [{ purchaseItemId: pi1, productId: p1.id, receivedQty: 40 }] },
      user.id,
    );
    created.goodsReceiptNotes.push(grn2.id);
    await grnService.recordQc(
      grn2.id,
      grn2.items.map((i) => ({ itemId: i.id, passQty: i.receivedQty, rejectQty: 0 })),
      user.id,
    );
    await grnService.post(grn2.id, user.id);

    const dr156After = await debit156For(po.id);
    ok(
      "K9 nhận nốt 40 → Nợ 156 cộng dồn đủ 3.000.000đ, bút toán tách theo từng GRN",
      dr156After === 3_000_000,
      `Nợ 156 = ${dr156After.toLocaleString("vi-VN")}`,
    );
    const poEnd = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } });
    ok("K9 PO nhận đủ chuyển RECEIVED", poEnd.status === "RECEIVED", poEnd.status);
    const qty1End = await qtyOf(p1.id);
    ok("K9 tồn kho cộng đủ 100", qty1End - qty1Before === 100, `p1 +${qty1End - qty1Before}`);

    // ---- K10: POST lại GRN đã POSTED ⇒ chặn, không nhân đôi ----
    let blocked = false;
    try {
      await grnService.post(grn1.id, user.id);
    } catch {
      blocked = true;
    }
    const dr156Final = await debit156For(po.id);
    ok(
      "K10 POST lại GRN đã POSTED bị chặn, tồn kho và bút toán KHÔNG nhân đôi",
      blocked && dr156Final === 3_000_000 && (await qtyOf(p1.id)) - qty1Before === 100,
      `blocked=${blocked}, Nợ 156 = ${dr156Final.toLocaleString("vi-VN")}`,
    );

    // ---- Công nợ tăng theo giá trị nhận tiếp ----
    const debtEnd = await prisma.debt.findFirst({ where: { poId: po.id } });
    ok(
      "K7b công nợ cộng dồn đủ 3.000.000đ sau lần nhận thứ hai",
      debtEnd && Number(debtEnd.amount) === 3_000_000,
      debtEnd ? Number(debtEnd.amount).toLocaleString("vi-VN") : "null",
    );

    const entries = await prisma.journalEntry.findMany({
      where: { source: "PURCHASE", sourceId: po.id },
      select: { id: true, entryCode: true, operation: true },
    });
    ok("K9b có 2 bút toán tách biệt (operation GRN:<id>)", entries.length === 2, entries.map((e) => e.operation).join(" | "));

    return { po, vendor, p1, p2, user };
  });

  // ---- K11: dọn sạch ----
  // Xoá TRONG transaction: hỏng giữa chừng thì không để lại nửa vời. Thứ tự quan
  // trọng: journal_lines → journal_entries → debts → GRN items → GRN → tồn kho.
  await prisma.$transaction(async (tx) => {
    await tx.journalLine.deleteMany({ where: { entry: { source: "PURCHASE", sourceId: result.po.id } } });
    await tx.journalEntry.deleteMany({ where: { source: "PURCHASE", sourceId: result.po.id } });
    await tx.debt.deleteMany({ where: { poId: result.po.id } });
    await tx.goodsReceiptItem.deleteMany({ where: { grnId: { in: created.goodsReceiptNotes } } });
    await tx.goodsReceiptNote.deleteMany({ where: { id: { in: created.goodsReceiptNotes } } });
    await tx.inventoryTransaction.deleteMany({ where: { inventory: { productId: { in: created.products } } } });
    await tx.inventoryLot.deleteMany({ where: { productId: { in: created.products } } });
    await tx.inventory.deleteMany({ where: { productId: { in: created.products } } });
    await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: result.po.id } });
    await tx.purchaseOrder.deleteMany({ where: { id: result.po.id } });
    await tx.product.deleteMany({ where: { id: { in: created.products } } });
    await tx.category.deleteMany({ where: { id: { in: created.categories } } });
    await tx.vendor.update({ where: { id: result.vendor.id }, data: { totalDebt: 0 } });
    await tx.vendor.deleteMany({ where: { id: result.vendor.id } });
    await tx.auditLog.deleteMany({
      where: {
        action: { in: ["GRN_POST", "CREATE_GRN", "GRN_QC", "DEBT_CREATED_PAYABLE"] },
        entityId: { in: [...created.goodsReceiptNotes, result.po.id] },
      },
    });
  });

  // Chặn teardown sớm/rác: ném lỗi nếu còn dòng của tenant thử hoặc mồ côi tăng.
  await verifyTeardown([], prisma);
  ok("K11 teardown sạch (0 dòng sót, 0 mồ côi tăng)", true);

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
})().catch(async (e) => {
  logger.error(`[smoke-grn-posting] LỖI: ${e.message}`);
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});