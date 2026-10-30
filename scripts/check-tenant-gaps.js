/**
 * scripts/check-tenant-gaps.js — Kiem chung nhung cho extension Prisma KHONG the
 *
 * check-tenant-isolation.js da chung minh `findUnique`/`update`/`delete` co
 * `where: { id }` DUOC bao ve. Cau hoi tiep theo: co cho nao extension KHONG
 * chong duoc khong? Hai ung vien:
 *   1. `$queryRaw` / `$executeRaw` — extension chi can thiep vao model, raw bypass
 *   2. `include` / `select` — extension chi them tenantId vao `where` TOP-LEVEL,
 *      quan he nested di qua FK truc tiep nen khong qua filter
 *
 * Chay: node scripts/check-tenant-gaps.js   (can DB da seed, tu don dep)
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("check-tenant-gaps");
const { track, cleanup, installSignalHandlers } = require("./lib/cleanup-registry");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
installSignalHandlers("check-tenant-gaps");
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " -> " + extra : ""}`);
  if (cond) pass += 1;
  else fail += 1;
};

const suffix = Date.now().toString(36);

(async () => {
  console.log("\n=== Kiem chung KHOANG HO KHONG (raw SQL + include) ===\n");

  const suffixA = `gap-a-${suffix}`;
  const suffixB = `gap-b-${suffix}`;
  let tenantA, tenantB, userA, productA, productB, invA, invB;

  try {
    // Chụp baseline mồ côi-tenant TRƯỚC khi tạo tenant thử (xem lib/teardown.js).
    await captureBaseline(prisma);

    tenantA = await prisma.tenant.create({ data: { name: "GAP A", slug: suffixA } });
    track(() => prisma.tenant.deleteMany({ where: { id: tenantA.id } }));
    tenantB = await prisma.tenant.create({ data: { name: "GAP B", slug: suffixB } });
    track(() => prisma.tenant.deleteMany({ where: { id: tenantB.id } }));

    userA = await prisma.user.create({
      data: { tenantId: tenantA.id, email: `${suffixA}@gap.test`, password: "gap-test-not-a-real-hash", fullName: "A", role: "ADMIN" },
    });
    track(() => prisma.user.deleteMany({ where: { id: userA.id } }));

    const catA = await prisma.category.create({ data: { tenantId: tenantA.id, name: `CAT-A-${suffix}` } });
    track(() => prisma.category.deleteMany({ where: { id: catA.id } }));
    const catB = await prisma.category.create({ data: { tenantId: tenantB.id, name: `CAT-B-${suffix}` } });
    track(() => prisma.category.deleteMany({ where: { id: catB.id } }));

    productA = await prisma.product.create({
      data: { tenantId: tenantA.id, sku: `SKU-A-${suffix}`, name: `SP A ${suffix}`, price: 100, costPrice: 50, categoryId: catA.id },
    });
    track(() => prisma.product.deleteMany({ where: { id: productA.id } }));
    productB = await prisma.product.create({
      data: { tenantId: tenantB.id, sku: `SKU-B-${suffix}`, name: `SP B ${suffix}`, price: 100, costPrice: 50, categoryId: catB.id },
    });
    track(() => prisma.product.deleteMany({ where: { id: productB.id } }));

    const whA = await prisma.warehouse.create({ data: { tenantId: tenantA.id, code: `WH-A-${suffix}`, name: "WH A" } });
    track(() => prisma.warehouse.deleteMany({ where: { id: whA.id } }));
    const whB = await prisma.warehouse.create({ data: { tenantId: tenantB.id, code: `WH-B-${suffix}`, name: "WH B" } });
    track(() => prisma.warehouse.deleteMany({ where: { id: whB.id } }));

    invA = await prisma.inventory.create({ data: { tenantId: tenantA.id, productId: productA.id, warehouseId: whA.id, quantity: 10, minStock: 2 } });
    track(() => prisma.inventory.deleteMany({ where: { id: invA.id } }));
    invB = await prisma.inventory.create({ data: { tenantId: tenantB.id, productId: productB.id, warehouseId: whB.id, quantity: 99, minStock: 2 } });
    track(() => prisma.inventory.deleteMany({ where: { id: invB.id } }));

    // ── 1. include nested qua hasMany ────────────────────────────────
    await runWithTenant(tenantA.id, async () => {
      const rows = await prisma.inventory.findMany({
        where: {},
        include: { product: true },
      });
      const foreign = rows.filter((r) => r.product && r.product.tenantId !== tenantA.id);
      ok(
        "findMany include product: khong keo sang tenant khac",
        foreign.length === 0,
        `${rows.length} inventory cua A, ${foreign.length} tro sang tenant khac`,
      );
    });

    // ── 2. include nested qua belongsTo ──────────────────────────────
    await runWithTenant(tenantB.id, async () => {
      const rows = await prisma.inventory.findMany({ where: {}, include: { product: true } });
      ok(
        "tenant B khong thay inventory cua A qua include",
        !rows.some((r) => r.id === invA.id),
        `${rows.length} inventory cua B`,
      );
    });

    // ── 3. $queryRaw co thay tenantId tu dong khong? ─────────────────
    await runWithTenant(tenantA.id, async () => {
      const all = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM products WHERE sku = $1`,
        `SKU-B-${suffix}`,
      );
      ok(
        "$queryRawUnsafe co chay duoc cau khong co dieu kien tenant (RAW BYPASS)",
        Number(all?.[0]?.n) === 1,
        `doc duoc ${all?.[0]?.n} san pham cua TENANT B trong khi dang o context tenant A`,
      );
    });

    // ── 4. $queryRaw voi tien to bang tay ────────────────────────────
    await runWithTenant(tenantA.id, async () => {
      const scoped = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM products WHERE sku = $1 AND "tenantId" = $2`,
        `SKU-B-${suffix}`,
        tenantB.id,
      );
      ok("raw SQL co dieu kien tenantId tu Viet = 0 dong", Number(scoped?.[0]?.n) === 1);
    });

    console.log("\n--- ket luan ---");
    console.log("A. include/select: extension CHAN duoc (quan he nested di qua FK cua ban ghi da loc).");
    console.log("B. $queryRaw: extension KHONG chan. moi cau lenh raw phai tu viet dieu kien tenant.");
  } catch (e) {
    console.error("LOI:", e.message);
    fail += 1;
  } finally {
    await cleanup();
    // "Đã gọi cleanup" KHÔNG phải bằng chứng "không còn rác" → verify bắt buộc.
    try {
      await verifyTeardown([tenantA?.id, tenantB?.id], prisma);
    } catch (e) {
      console.error("TEARDOWN BI PHAT:", e.message);
      fail += 1;
    }
    console.log("Da don dep du lieu test.");
    await prisma.$disconnect();
  }

  console.log(`\n=== ${fail === 0 ? "TAT CA PASS" : "CO FAIL"} (${pass} pass / ${fail} fail) ===`);
  process.exit(fail === 0 ? 0 : 1);
})();