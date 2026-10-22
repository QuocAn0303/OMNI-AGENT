/**
 * scripts/smoke-rfq.js — KIỂM CHỨNG DB THẬT: RFQ VÀ SO SÁNH BÁO GIÁ
 *
 * Theo quy tắc ở `docs/aisc26/STATE.md`: unit test mock KHÔNG phải bằng chứng.
 * Ở đây có nhiều ràng buộc DB mới (CHECK, `@@unique`, khoá ngoại) chỉ kiểm chứng
 * được trên Postgres thật.
 *
 * Kịch bản:
 *   K1  Tạo RFQ 2 dòng hàng + hỏi 3 NCC
 *   K2  Báo giá NCC rẻ nhất (thiếu 1 dòng) ⇒ KHÔNG được xếp hạng
 *   K3  Báo giá NCC đắt nhất, đủ 2 dòng
 *   K4  Báo giá NCC giữa, đủ 2 dòng, báo thiếu hàng 1 phần
 *   K5  Bảng so sánh: xếp hạng đúng, rẻ nhất là NCC đầy đủ giá
 *   K6  DB chặn giá <= 0 và số lượng <= 0
 *   K7  Chốt NCC ⇒ tạo PO, RFQ chuyển AWARDED, gắn purchaseOrderId
 *   K8  PO mới đi qua ĐÚNG quy tắc duyệt của hệ thống (không phải RF-approve tự do)
 *   K9  Chốt lần 2 bị chặn (mỗi RFQ tối đa 1 PO)
 *  K10  NCC thiếu hàng ⇒ số lượng PO bằng phần NCC có, không bịa số
 *  K11  Huỷ RFQ đã chốt bị chặn
 *  K12  Teardown sạch, chạy 2 lần cho cùng kết quả
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-rfq");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const rfqService = require("../src/modules/rfq/rfq.service");

let pass = 0, fail = 0;
const TAG = "SMOKE-RFQ";
const ok = (l, c, e = "") => { console.log(`${c ? "OK  " : "FAIL"} | ${l}${e ? " -> " + e : ""}`); c ? pass++ : fail++; };

const TENANT_SLUG = "omni-demo-mo-phong";

/** Dọn rác của chính script từ lần chạy trước bị lỗi giữa chừng. */
async function purgePrevious(tenantId) {
  const n = await runWithTenant(tenantId, async () => {
    const rfqs = await prisma.rfq.findMany({ where: { note: { startsWith: TAG } }, select: { id: true } });
    if (!rfqs.length) return 0;
    const pos = await prisma.purchaseOrder.findMany({
      where: { note: { contains: TAG } }, select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const po of pos) {
        await tx.journalLine.deleteMany({ where: { entry: { source: "PURCHASE", sourceId: po.id } } });
        await tx.journalEntry.deleteMany({ where: { source: "PURCHASE", sourceId: po.id } });
        await tx.debt.deleteMany({ where: { poId: po.id } });
        await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: po.id } });
        await tx.purchaseOrder.deleteMany({ where: { id: po.id } });
      }
      const ids = rfqs.map((r) => r.id);
      await tx.rfqQuoteLine.deleteMany({ where: { quote: { rfqId: { in: ids } } } });
      await tx.rfqQuote.deleteMany({ where: { rfqId: { in: ids } } });
      await tx.rfqItem.deleteMany({ where: { rfqId: { in: ids } } });
      await tx.rfq.deleteMany({ where: { id: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { action: { in: ["CREATE_RFQ", "RECORD_RFQ_QUOTE", "DECLINE_RFQ_QUOTE", "AWARD_RFQ", "CANCEL_RFQ"] }, entity: { in: ["Rfq", "RfqQuote"] } } });
    });
    return rfqs.length;
  });
  if (n) console.log(`  (đã dọn rác lần chạy trước: ${n} RFQ)`);
}

(async () => {
  console.log("\n=== SMOKE: RFQ / SO SÁNH BÁO GIÁ (DB thật) ===\n");
  await captureBaseline(prisma);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`không có tenant "${TENANT_SLUG}" — chạy npm run data:import trước`);
  await purgePrevious(tenant.id);

  const created = { products: [], categories: [], vendors: [] };
  const stamp = Date.now();

  const ctx = await runWithTenant(tenant.id, async () => {
    const category = await prisma.category.create({ data: { name: `${TAG} DM`, isActive: true } });
    created.categories.push(category.id);

    const mkProduct = async (tag, cost) => {
      const p = await prisma.product.create({
        data: { sku: `${TAG}-${tag}`, name: `SP ${tag}`, price: cost * 2, costPrice: cost, isActive: true, categoryId: category.id },
      });
      created.products.push(p.id);
      return p;
    };
    const p1 = await mkProduct("A", 10_000);
    const p2 = await mkProduct("B", 20_000);

    const mkVendor = async (tag) => {
      const v = await prisma.vendor.create({
        data: { code: `${TAG}-${tag}`, name: `NCC ${tag}`, paymentTerms: 30 },
      });
      created.vendors.push(v.id);
      return v;
    };
    const vCheap = await mkVendor("RE");
    const vMid = await mkVendor("MID");
    const vExp = await mkVendor("DX");

    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, role: { in: ["ADMIN", "MANAGER"] }, isActive: true },
      select: { id: true },
    });

    // ---- K1: tạo RFQ hỏi 3 NCC ----
    const rfq = await rfqService.create(
      {
        vendorIds: [vCheap.id, vMid.id, vExp.id],
        note: `${TAG} so sanh bao gia`,
        items: [
          { productId: p1.id, quantity: 100, unit: "cái" },
          { productId: p2.id, quantity: 50, unit: "cái" },
        ],
      },
      user.id,
    );
    created.rfqId = rfq.id;
    ok("K1 tạo RFQ 2 dòng + hỏi 3 NCC",
       rfq.items.length === 2 && rfq.quotes.length === 3,
       `${rfq.rfqCode}: ${rfq.items.length} dòng, ${rfq.quotes.length} NCC`);
    ok("K1 nói rõ CHƯA gửi cho NCC nào", rfq.requiresHumanSend === true && rfq.sentCount === 0);

    const item1 = rfq.items.find((i) => i.productId === p1.id);
    const item2 = rfq.items.find((i) => i.productId === p2.id);

    // ---- K2: NCC rẻ nhất báo THIẾU 1 dòng ⇒ không được xếp hạng ----
    await rfqService.recordQuote(rfq.id, vCheap.id, {
      lines: [{ rfqItemId: item1.id, unitCost: 9_000 }], // thiếu dòng 2
    }, user.id);

    // ---- K3 + K4: hai NCC đủ 2 dòng ----
    // vExp đắt nhất: 100×12.000 + 50×22.000 = 1.200.000 + 1.100.000 = 2.300.000
    await rfqService.recordQuote(rfq.id, vExp.id, {
      lines: [
        { rfqItemId: item1.id, unitCost: 12_000 },
        { rfqItemId: item2.id, unitCost: 22_000 },
      ],
    }, user.id);
    // vMid rẻ hơn: 100×10.500 + 50×20.000 = 1.050.000 + 1.000.000 = 2.050.000
    // nhưng báo chỉ có 40/100 cái ở dòng 1.
    await rfqService.recordQuote(rfq.id, vMid.id, {
      lines: [
        { rfqItemId: item1.id, unitCost: 10_500, availableQty: 40 },
        { rfqItemId: item2.id, unitCost: 20_000 },
      ],
    }, user.id);

    // ---- K5: bảng so sánh ----
    const cmp = await rfqService.comparison(rfq.id);
    const byId = Object.fromEntries(cmp.quotes.map((q) => [q.vendorId, q]));

    ok("K2 báo giá thiếu dòng KHÔNG được xếp hạng",
       byId[vCheap.id].incomplete === true && byId[vCheap.id].total === null &&
       !cmp.ranking.some((r) => r.quoteId === byId[vCheap.id].quoteId),
       `incomplete=${byId[vCheap.id].incomplete}, total=${byId[vCheap.id].total}`);

    ok("K5 NCC đắt nhất: tổng 2.300.000", Number(byId[vExp.id].total) === 2_300_000, String(byId[vExp.id].total));
    ok("K4 NCC giữa bị đánh dấu thiếu hàng dòng 1",
       byId[vMid.id].lines.some((l) => l.short === true),
       `availableQty=40/100, short=${byId[vMid.id].lines.find((l) => l.short)?.short}`);

    ok("K5 xếp hạng đúng: rẻ nhất xếp 1",
       cmp.ranking.length === 2 && cmp.ranking[0].vendorId === vMid.id && cmp.ranking[0].rank === 1,
       `hạng 1 = ${cmp.ranking[0]?.vendorName} (${cmp.ranking[0]?.total})`);
    ok("K5 chênh lệch so với rẻ nhất được tính",
       Number(cmp.ranking[1].total) === 2_300_000 && cmp.ranking[1].savingVsCheapestPct > 10,
       `chênh ${cmp.ranking[1].savingVsCheapestPct}%`);
    ok("K5 có câu cảnh báo giá rẻ ≠ phù hợp", typeof cmp.caveat === "string" && cmp.caveat.includes("KHÔNG đồng nghĩa phù hợp"));

    // ---- K6: DB chặn giá rác ----
    const quoteExp = cmp.quotes.find((q) => q.vendorId === vExp.id).quoteId;
    const chonGiaAm = await prisma.$executeRawUnsafe(
      `INSERT INTO rfq_quote_lines (id, "tenantId", "quoteId", "rfqItemId", "unitCost") VALUES (gen_random_uuid()::text, $1, $2, $3, -1)`,
      tenant.id, quoteExp, item1.id,
    ).then(() => false, () => true);
    ok("K6 DB chặn unitCost âm (CHECK constraint)", chonGiaAm);

    const chonQty0 = await prisma.$executeRawUnsafe(
      `INSERT INTO rfq_items (id, "tenantId", "rfqId", "quantity", "sortOrder") VALUES (gen_random_uuid()::text, $1, $2, 0, 9)`,
      tenant.id, rfq.id,
    ).then(() => false, () => true);
    ok("K6 DB chặn quantity = 0 (CHECK constraint)", chonQty0);

    const trungNcc = await prisma.$executeRawUnsafe(
      `INSERT INTO rfq_quotes (id, "tenantId", "rfqId", "vendorId", status, "createdAt", "updatedAt")
       SELECT gen_random_uuid()::text, $1, $2, $3, 'PENDING', now(), now()
       FROM rfq_quotes WHERE "rfqId" = $2 LIMIT 1`,
      tenant.id, rfq.id, vMid.id,
    ).then(() => false, () => true);
    ok("K6 DB chặn 2 báo giá của cùng 1 NCC (@@unique)", trungNcc);

    // ---- K7 + K10: chốt NCC thiếu hàng ⇒ PO lấy đúng phần NCC có ----
    const awarded = await rfqService.award(rfq.id, vMid.id, user.id);
    created.poId = awarded.purchaseOrder.id;
    ok("K7 chốt NCC tạo được PO", !!awarded.purchaseOrder?.id, `${awarded.purchaseOrder.poCode} total=${awarded.purchaseOrder.total}`);

    const rfqAfter = await prisma.rfq.findUnique({ where: { id: rfq.id }, select: { status: true, awardedVendorId: true, purchaseOrderId: true, awardedAt: true } });
    ok("K7 RFQ chuyển AWARDED và gắn PO",
       rfqAfter.status === "AWARDED" && rfqAfter.awardedVendorId === vMid.id && rfqAfter.purchaseOrderId === awarded.purchaseOrder.id);

    const poItems = await prisma.purchaseItem.findMany({
      where: { purchaseOrderId: awarded.purchaseOrder.id },
      include: { product: { select: { sku: true } } },
      orderBy: { unitCost: "asc" },
    });
    // Dòng 1: NCC chỉ có 40/100 ⇒ đặt 40, KHÔNG đặt đủ 100 rồi ghi sổ.
    const line1 = poItems.find((i) => i.product.sku === `${TAG}-A`);
    const line2 = poItems.find((i) => i.product.sku === `${TAG}-B`);
    ok("K10 số lượng PO = phần NCC thực sự có (40/100), không bịa số",
       line1.quantity === 40 && line2.quantity === 50,
       `A: ${line1.quantity}/100, B: ${line2.quantity}/50`);
    // `unitCost` là Decimal trong Prisma ⇒ so sánh phải ép về số, `===` với số
    // JS luôn false. Đã vấp đúng chỗ này.
    ok("K10 giá trên PO lấy từ báo giá",
       Number(line1.unitCost) === 10_500 && Number(line2.unitCost) === 20_000,
       `${line1.unitCost} / ${line2.unitCost}`);

    // ---- K8: PO đi qua đúng quy tắc duyệt của hệ thống ----
    ok("K8 PO có trạng thái hợp lệ do purchaseService quyết định",
       ["DRAFT", "PENDING", "PENDING_APPROVAL", "APPROVED"].includes(awarded.purchaseOrder.status),
       `status=${awarded.purchaseOrder.status}`);
    ok("K8 PO ghi nguồn RFQ trong note", String(awarded.purchaseOrder.note || "").includes(rfq.rfqCode),
       String(awarded.purchaseOrder.note));

    // ---- K9: chốt lần 2 bị chặn ----
    let chonLai = false;
    try {
      await rfqService.award(rfq.id, vExp.id, user.id);
    } catch {
      chonLai = true;
    }
    ok("K9 không chốt lại NCC khác cho RFQ đã chốt", chonLai);

    // ---- K11: huỷ RFQ đã chốt bị chặn ----
    let huy = false;
    try {
      await rfqService.cancel(rfq.id, user.id, "test");
    } catch {
      huy = true;
    }
    ok("K11 không huỷ được RFQ đã chốt thành PO", huy);

    return { rfq, po: awarded.purchaseOrder };
  });

  // ---- Teardown ----
  await prisma.$transaction(async (tx) => {
    const rfqIds = [created.rfqId];
    await tx.journalLine.deleteMany({ where: { entry: { source: "PURCHASE", sourceId: ctx.po.id } } });
    await tx.journalEntry.deleteMany({ where: { source: "PURCHASE", sourceId: ctx.po.id } });
    await tx.debt.deleteMany({ where: { poId: ctx.po.id } });
    await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: ctx.po.id } });
    await tx.purchaseOrder.deleteMany({ where: { id: ctx.po.id } });
    await tx.rfqQuoteLine.deleteMany({ where: { quote: { rfqId: { in: rfqIds } } } });
    await tx.rfqQuote.deleteMany({ where: { rfqId: { in: rfqIds } } });
    await tx.rfqItem.deleteMany({ where: { rfqId: { in: rfqIds } } });
    await tx.rfq.deleteMany({ where: { id: { in: rfqIds } } });
    await tx.product.deleteMany({ where: { id: { in: created.products } } });
    await tx.category.deleteMany({ where: { id: { in: created.categories } } });
    await tx.vendor.updateMany({ where: { id: { in: created.vendors } }, data: { totalDebt: 0 } });
    await tx.vendor.deleteMany({ where: { id: { in: created.vendors } } });
    await tx.auditLog.deleteMany({
      where: { action: { in: ["CREATE_RFQ", "RECORD_RFQ_QUOTE", "DECLINE_RFQ_QUOTE", "AWARD_RFQ", "CANCEL_RFQ"] } },
    });
  });
  await verifyTeardown([], prisma);
  ok("K12 teardown sạch (0 dòng sót, 0 mồ côi tăng)", true);

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  console.error((e.stack || "").split("\n").slice(1, 4).join("\n"));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});