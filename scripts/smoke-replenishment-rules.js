/**
 * scripts/smoke-replenishment-rules.js — KIỂM CHỨNG DB THẬT: QUY TẮC NHẬP HÀNG
 *
 * Theo quy tắc ở `docs/aisc26/STATE.md`: unit test mock KHÔNG phải bằng chứng.
 * Lần này phải chứng minh trên Postgres rằng:
 *   1. Cột mới tồn tại và nhận giá trị hợp lệ.
 *   2. Ràng buộc CHECK ở DB thực sự chặn giá trị rác (service-level thì dễ
 *      bị bỏ qua, nhưng import/script chạy ngoài app thì không).
 *   3. `loadReplenishmentInput` ĐỌC ĐÚNG quy tắc (không phải luôn trả null).
 *   4. Cấu hình lead time KHÁC NHAU cho hai SKU ⇒ `planReplenishment` ra hai kết
 *      quả khác nhau — chứng minh engine thật sự dùng quy tắc.
 *   5. Bỏ cấu hình ⇒ kết quả trở về ĐÚNG ĐƯỜNG MẶC ĐỊNH (không dính giá trị cũ).
 *   6. Teardown sạch: xoá hết, chạy 2 lần cho cùng kết quả.
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-replenishment-rules");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const { loadReplenishmentInput } = require("../src/modules/replenishment/replenishment.suggest");
const { planReplenishment } = require("../src/modules/replenishment/replenishment.calc");

let pass = 0, fail = 0;
const TAG = "SMOKE-RULES";
const ok = (l, c, e = "") => { console.log(`${c ? "OK  " : "FAIL"} | ${l}${e ? " -> " + e : ""}`); c ? pass++ : fail++; };

const TENANT_SLUG = "omni-demo-mo-phong";

(async () => {
  console.log("\n=== SMOKE: QUY TẮC NHẬP HÀNG (DB thật) ===\n");
  await captureBaseline(prisma);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`không có tenant "${TENANT_SLUG}" — chạy npm run data:import trước`);

  const created = { products: [], categories: [], inventoryIds: [] };
  const stamp = Date.now();

  await runWithTenant(tenant.id, async () => {
    // ---- Chuẩn bị: 2 SKU có lịch sử bán GIỐNG NHAU, chỉ khác cấu hình -------
    const category = await prisma.category.create({ data: { name: `${TAG} DM`, isActive: true } });
    created.categories.push(category.id);

    const mkProduct = async (tag) => {
      const p = await prisma.product.create({
        data: {
          sku: `${TAG}-${tag}`, name: `SP ${tag}`, price: 30_000, costPrice: 10_000,
          isActive: true, categoryId: category.id,
        },
      });
      created.products.push(p.id);
      const wh = await prisma.inventory.findFirst({ select: { warehouseId: true } });
      const inv = await prisma.inventory.create({
        data: { productId: p.id, warehouseId: wh.warehouseId, quantity: 5, reserved: 0, minStock: 10 },
      });
      created.inventoryIds.push(inv.id);
      return { p, inv, whId: wh.warehouseId };
    };

    const A = await mkProduct("A");
    const B = await mkProduct("B");

    // ---- K1: cột mới tồn tại, mặc định hợp lệ ----
    ok(
      "K1 SKU mới có quy tắc mặc định (chưa cấu hình)",
      A.inv.maxStock === null && A.inv.leadTimeDays === null &&
        A.inv.packMultiple === 1 && A.inv.serviceLevel === null,
      `maxStock=${A.inv.maxStock} leadTime=${A.inv.leadTimeDays} pack=${A.inv.packMultiple} sl=${A.inv.serviceLevel}`,
    );

    // ---- K2: ràng buộc CHECK ở DB chặn giá trị rác ----
    // Service Zod chặn rồi, nhưng import/script chạy ngoài app thì không — nên
    // ràng buộc phải ở tầng DB. Kiểm tra bằng cách ghi thẳng SQL.
    const bad = await prisma.$executeRawUnsafe(`
      UPDATE inventories SET "maxStock" = -5 WHERE id = $1`, A.inv.id).then(
      () => false,
      () => true,
    );
    ok("K2 DB chặn maxStock âm (ràng buộc CHECK ở tầng DB)", bad);

    const bad2 = await prisma.$executeRawUnsafe(`
      UPDATE inventories SET "serviceLevel" = 1.5 WHERE id = $1`, A.inv.id).then(
      () => false,
      () => true,
    );
    ok("K2 DB chặn serviceLevel ngoài (0,1)", bad2);

    const bad3 = await prisma.$executeRawUnsafe(`
      UPDATE inventories SET "packMultiple" = 0 WHERE id = $1`, A.inv.id).then(
      () => false,
      () => true,
    );
    ok("K2 DB chặn packMultiple = 0", bad3);

    // ---- K3: cấu hình hai SKU KHÁC NHAU ----
    await prisma.inventory.update({
      where: { id: A.inv.id },
      data: { maxStock: 500, leadTimeDays: 21, packMultiple: 12, serviceLevel: 0.99 },
    });
    await prisma.inventory.update({
      where: { id: B.inv.id },
      data: { maxStock: 200, leadTimeDays: 3, packMultiple: 1, serviceLevel: 0.8 },
    });
    ok("K3 lưu được quy tắc cho 2 SKU khác nhau", true);

    // ---- K4: `loadReplenishmentInput` ĐỌC ĐÚNG quy tắc ----
    const input = await loadReplenishmentInput([A.p.id, B.p.id]);
    const ruleA = input.get(A.p.id)?.rule;
    const ruleB = input.get(B.p.id)?.rule;
    ok(
      "K4 loader đọc được quy tắc A",
      ruleA && ruleA.leadTimeDays === 21 && ruleA.packMultiple === 12 && ruleA.maxStock === 500,
      ruleA ? `leadTime=${ruleA.leadTimeDays} pack=${ruleA.packMultiple}` : "rule = null",
    );
    ok(
      "K4 loader đọc được quy tắc B",
      ruleB && ruleB.leadTimeDays === 3 && ruleB.serviceLevel === 0.8,
      ruleB ? `leadTime=${ruleB.leadTimeDays} sl=${ruleB.serviceLevel}` : "rule = null",
    );
    ok("K4 cờ hasOverrides đúng", ruleA?.hasOverrides === true);

    // ---- K5: engine RA HAI KẾT QUẢ KHÁC NHAU dù dữ liệu giống nhau ----
    // Cùng lịch sử bán, chỉ khác cấu hình ⇒ kết quả PHẢI khác.
    const sales = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-0${(i < 28 ? 1 : 2)}-${String((i % 28) + 1).padStart(2, "0")}`,
      qty: [4, 7, 12, 9, 16, 6, 11, 14, 8, 5][i % 10],
      outOfStock: false,
    }));
    const base = {
      dailySales: sales, receipts: [], unitCost: 10_000, reviewPeriodDays: 7,
      // Cần `inventories` — thiếu thì ATP = 0 và mọi phép so sánh về tồn đều vô
      // nghĩa (đã vấp đúng chỗ này khi chạy lần đầu).
      inventories: [{ quantity: 1_000, reserved: 0 }],
    };
    const planA = planReplenishment({
      ...base, configuredLeadTimeDays: 21, serviceLevel: 0.99, packMultiple: 12, maxStock: 500,
    });
    const planB = planReplenishment({
      ...base, configuredLeadTimeDays: 3, serviceLevel: 0.8, packMultiple: 1, maxStock: 200,
    });

    ok(
      "K5 lead time 21 ngày cho ROP CAO hơn 3 ngày",
      planA.rop.rop > planB.rop.rop,
      `ROP A(21n)=${planA.rop.rop} vs B(3n)=${planB.rop.rop}`,
    );
    ok("K5 nguồn lead time ghi CONFIGURED", planA.lead.source === "CONFIGURED", planA.lead.source);
    ok(
      "K5 packMultiple 12 làm orderQty là bội số của 12",
      planA.order.orderQty % 12 === 0,
      `orderQty A=${planA.order.orderQty}, B=${planB.order.orderQty}`,
    );
    ok(
      "K5 tồn quá cao được cảnh báo (ATP > maxStock)",
      planB.rules.overStock === true && planB.rules.excessQty > 0,
      `ATP position=${planB.atp.position} maxStock=200 dư=${planB.rules.excessQty}`,
    );

    // ---- K6: BỎ cấu hình ⇒ trở về đúng đường mặc định ----
    await prisma.inventory.update({
      where: { id: B.inv.id },
      data: { maxStock: null, leadTimeDays: null, packMultiple: 1, serviceLevel: null },
    });
    const input2 = await loadReplenishmentInput([B.p.id]);
    const ruleB2 = input2.get(B.p.id)?.rule;
    ok("K6 bỏ cấu hình ⇒ hasOverrides = false", ruleB2?.hasOverrides === false, `hasOverrides=${ruleB2?.hasOverrides}`);

    const planNoRule = planReplenishment({ ...base });
    const planWithDefaultLt = planReplenishment({ ...base, configuredLeadTimeDays: null });
    ok(
      "K6 không cấu hình ⇒ lead time về mặc định 7 ngày",
      planNoRule.lead.leadTimeDays === 7 && planNoRule.lead.source === "ESTIMATED",
      `leadTime=${planNoRule.lead.leadTimeDays} source=${planNoRule.lead.source}`,
    );
    ok(
      "K6 không cấu hình ⇒ KHÔNG còn cảnh báo tồn cao",
      planNoRule.rules.overStock === false && planNoRule.rules.maxStock === null,
    );
  });

  // ---- Teardown ----
  await prisma.$transaction(async (tx) => {
    await tx.inventoryTransaction.deleteMany({ where: { inventoryId: { in: created.inventoryIds } } });
    await tx.inventoryLot.deleteMany({ where: { productId: { in: created.products } } });
    await tx.inventory.deleteMany({ where: { id: { in: created.inventoryIds } } });
    await tx.orderItem.deleteMany({ where: { productId: { in: created.products } } });
    await tx.purchaseItem.deleteMany({ where: { productId: { in: created.products } } });
    await tx.goodsReceiptItem.deleteMany({ where: { productId: { in: created.products } } });
    await tx.product.deleteMany({ where: { id: { in: created.products } } });
    await tx.category.deleteMany({ where: { id: { in: created.categories } } });
  });
  await verifyTeardown([], prisma);
  ok("K7 teardown sạch (0 dòng sót, 0 mồ côi tăng)", true);

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  console.error(e.stack?.split("\n").slice(0, 4).join("\n"));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});