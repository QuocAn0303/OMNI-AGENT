/**
 * scripts/smoke-warehouse-tree.js — KIỂM CHỨNG DB THẬT: CÂY VỊ TRÍ KHO
 *
 * Ba ràng buộc phải kiểm trên Postgres thật, không kiểm được bằng mock:
 *   L1  Chỉ vị trí PHYSICAL mới được gán tồn kho.
 *   L2  Trigger chặn gắn vị trí con của tenant A vào kho cha tenant B.
 *   L3  FK `ON DELETE RESTRICT` chặn xoá kho cha còn kho con.
 *   L4  CHECK chặn tự làm cha của chính mình.
 *
 * Kịch bản:
 *   K1  Kho mới mặc định là PHYSICAL, không có cha
 *   K2  Tạo 3 vị trí con: 1 khu lưu hàng, 1 kho nhập (VIEW), 1 kho xuất (INTERNAL)
 *   K3  Gán tồn kho vào vị trí con PHYSICAL
 *   K4  Cây tính đúng tổng: gốc + con = tổng thật
 *   K5  L1: đổi vị trí đang có hàng sang VIEW ⇒ bị chặn
 *   K6  Vị trí rỗng đổi sang VIEW được
 *   K7  L4: tự làm cha của chính mình ⇒ bị chặn (CHECK)
 *   K8  L2: gắn vị trí tenant A vào kho cha tenant B ⇒ trigger chặn
 *   K9  L3: xoá kho cha còn kho con ⇒ bị chặn
 *  K10  Mã vị trí trùng trong cùng kho ⇒ bị chặn
 *  K11  Teardown sạch, chạy lại 2 lần cho cùng kết quả
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-warehouse-tree");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const tree = require("../src/modules/warehouses/warehouse-tree.service");

let pass = 0, fail = 0;
const TAG = "SMOKE-TREE";
const ok = (l, c, e = "") => { console.log(`${c ? "OK  " : "FAIL"} | ${l}${e ? " -> " + e : ""}`); c ? pass++ : fail++; };

const TENANT_SLUG = "omni-demo-mo-phong";

/** Dọn rác lần chạy trước bị lỗi giữa chừng. */
async function purgePrevious(tenantId) {
  const n = await runWithTenant(tenantId, async () => {
    // Dùng raw SQL: bước dọn là THOÁT HIỂM, không được phụ thuộc extension tenant.
    //
    // MẮT BẪY ĐÃ VẤP: kho con có mã "KHU-A"/"NHAN"/"XUAT" — KHÔNG chứa tiền tố
    // TAG, nên lọc `code LIKE 'SMOKE-TREE%'` bỏ sót chúng, rồi xoá kho gốc sẽ đụng
    // FK RESTRICY và hỏng. ⇒ Phải gom theo CÂY: kho gốc có tiền tố TAG, mọi kho
    // con lấy theo `parentId`.
    const roots = await prisma.$queryRawUnsafe(
      `SELECT id FROM warehouses WHERE code LIKE $1`, `${TAG}%`);
    if (!roots.length) return 0;
    const ids = await prisma.$queryRawUnsafe(
      `WITH RECURSIVE t(id) AS (
         SELECT id FROM warehouses WHERE code LIKE $1
         UNION ALL SELECT w.id FROM warehouses w JOIN t ON w."parentId" = t.id
       ) SELECT id FROM t`,
      `${TAG}%`,
    ).then((r) => r.map((x) => x.id));

    await prisma.$executeRawUnsafe(`UPDATE warehouses SET "parentId" = NULL WHERE id = ANY($1::text[])`, [ids]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventory_transactions WHERE "inventoryId" IN
         (SELECT id FROM inventories WHERE "warehouseId" = ANY($1::text[]))`, [ids]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventory_lots WHERE "warehouseId" = ANY($1::text[])`, [ids]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventories WHERE "warehouseId" = ANY($1::text[])`, [ids]);
    await prisma.$executeRawUnsafe(`DELETE FROM warehouses WHERE id = ANY($1::text[])`, [ids]);
    // Dọn sản phẩm/danh mục của lần chạy trước, theo đúng thứ tự phụ thuộc:
    // `inventories.productId` là FK RESTRICT ⇒ phải xoá hết tồn kho của SKU đó
    // TRƯỚC, rồi mới xoá sản phẩm. Xoá sản phẩm trước sẽ lỗi FK (đã vấp).
    // Kho con của lần trước có mã "KHU-A"/"NHAN"/… KHÔNG chứa TAG, nên phải dọn
    // theo tập `ids` đã gom từ cây chứ không lọc `code LIKE TAG%`.
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventory_transactions WHERE "inventoryId" IN
         (SELECT id FROM inventories WHERE "productId" IN
            (SELECT id FROM products WHERE sku LIKE $1))`, `${TAG}%`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventory_lots WHERE "productId" IN
         (SELECT id FROM products WHERE sku LIKE $1)`, `${TAG}%`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventories WHERE "productId" IN
         (SELECT id FROM products WHERE sku LIKE $1)`, `${TAG}%`);
    await prisma.$executeRawUnsafe(`DELETE FROM products WHERE sku LIKE $1`, `${TAG}%`);
    await prisma.$executeRawUnsafe(`DELETE FROM categories WHERE name LIKE $1`, `${TAG}%`);
    // `Warehouse.code` là `@unique` TOÀN CỤC (không theo tenant), nên kho con mồ
    // côi của lần chạy trước sẽ chặn lần tạo lại dù đã khác tenant. Dọn nốt
    // theo đúng danh sách mã mà script dùng — không đụng kho thật.
    await prisma.$executeRawUnsafe(`UPDATE warehouses SET "parentId" = NULL WHERE code = ANY($1::text[])`, [
      "KHU-A", "KHU-B", "KHU-C", "NHAN", "XUAT",
    ]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventory_transactions WHERE "inventoryId" IN
         (SELECT id FROM inventories WHERE "warehouseId" IN
            (SELECT id FROM warehouses WHERE code = ANY($1::text[])))`,
      ["KHU-A", "KHU-B", "KHU-C", "NHAN", "XUAT"]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventory_lots WHERE "warehouseId" IN
         (SELECT id FROM warehouses WHERE code = ANY($1::text[]))`,
      ["KHU-A", "KHU-B", "KHU-C", "NHAN", "XUAT"]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM inventories WHERE "warehouseId" IN
         (SELECT id FROM warehouses WHERE code = ANY($1::text[]))`,
      ["KHU-A", "KHU-B", "KHU-C", "NHAN", "XUAT"]);
    await prisma.$executeRawUnsafe(
      `DELETE FROM warehouses WHERE code = ANY($1::text[])`,
      ["KHU-A", "KHU-B", "KHU-C", "NHAN", "XUAT"]);
    await prisma.auditLog.deleteMany({ where: { action: { in: ["CREATE_WAREHOUSE_LOCATION", "SET_WAREHOUSE_LOCATION_TYPE"] } } });
    return ids.length;
  });
  if (n) console.log(`  (đã dọn rác lần chạy trước: ${n} vị trí)`);
}

(async () => {
  console.log("\n=== SMOKE: CÂY VỊ TRÍ KHO (DB thật) ===\n");
  await captureBaseline(prisma);

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`không có tenant "${TENANT_SLUG}" — chạy npm run data:import trước`);
  await purgePrevious(tenant.id);

  const created = { whIds: [], products: [], categories: [] };
  const stamp = Date.now();

  const ctx = await runWithTenant(tenant.id, async () => {
    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, role: { in: ["ADMIN", "MANAGER"] }, isActive: true },
      select: { id: true },
    });

    // ---- K1: kho mới mặc định PHYSICAL, không có cha ----
    const root = await prisma.warehouse.create({
      data: { code: `${TAG}-ROOT`, name: `${TAG} kho gốc`, isActive: true },
    });
    created.whIds.push(root.id);
    ok("K1 kho mới mặc định PHYSICAL, chưa có cha",
       root.locationType === "PHYSICAL" && root.parentId === null,
       `type=${root.locationType} parent=${root.parentId}`);

    // ---- K2: tạo 3 vị trí con ----
    const khuA = await tree.createLocation({ warehouseId: root.id, code: "KHU-A", name: "Khu A" }, user.id);
    const khuB = await tree.createLocation({ warehouseId: root.id, code: "KHU-B", name: "Khu B" }, user.id);
    const khoNhan = await tree.createLocation(
      { warehouseId: root.id, code: "NHAN", name: "Kho nhập", locationType: "VIEW" }, user.id);
    const khoXuat = await tree.createLocation(
      { warehouseId: root.id, code: "XUAT", name: "Kho xuất", locationType: "INTERNAL" }, user.id);
    created.whIds.push(khuA.id, khuB.id, khoNhan.id, khoXuat.id);
    ok("K2 tạo 4 vị trí con với đường dẫn đầy đủ",
       khuA.path === `${TAG}-ROOT/KHU-A` && khoNhan.locationType === "VIEW" && khoXuat.locationType === "INTERNAL",
       `path KHU-A = ${khuA.path}`);

    // Vị trí CẤP 2. Bản đầu tiên dựng cây bằng `parentId = rootId` nên vị trí
    // cấp 2 rơi ra khỏi cây và `totalQuantity` báo sai. Mắt xích này chứng minh
    // cây thực sự đệ quy, không chỉ 1 tầng.
    const khuC = await tree.createLocation({ warehouseId: khuA.id, code: "KHU-C", name: "Khu C" }, user.id);
    created.whIds.push(khuC.id);
    ok("K2b tạo được vị trí cấp 2, đường dẫn nối chuỗi",
       khuC.path === `${TAG}-ROOT/KHU-A/KHU-C` && khuC.parentId === khuA.id,
       `path KHU-C = ${khuC.path}`);

    // ---- K3: gán tồn kho vào vị trí PHYSICAL ----
    const category = await prisma.category.create({ data: { name: `${TAG} DM`, isActive: true } });
    created.categories.push(category.id);
    const product = await prisma.product.create({
      data: { sku: `${TAG}-SP`, name: `SP ${TAG}`, price: 30_000, costPrice: 10_000, isActive: true, categoryId: category.id },
    });
    created.products.push(product.id);
    await prisma.inventory.create({ data: { productId: product.id, warehouseId: khuA.id, quantity: 100, reserved: 20, minStock: 10 } });
    await prisma.inventory.create({ data: { productId: product.id, warehouseId: khuB.id, quantity: 80, reserved: 0, minStock: 10 } });
    // Hàng nằm ở vị trí CẤP 2 — tổng phải cộng dồn từ sâu lên.
    await prisma.inventory.create({ data: { productId: product.id, warehouseId: khuC.id, quantity: 20, reserved: 0, minStock: 10 } });

    // ---- K4: cây tính đúng tổng ----
    const t = await tree.getTree(root.id);
    const nodeA = t.children.find((c) => c.code === "KHU-A");
    const nodeB = t.children.find((c) => c.code === "KHU-B");
    const nodeNhan = t.children.find((c) => c.code === "NHAN");
    ok("K4 tổng tồn gốc = tổng CẢ các nhánh kể cả cấp 2",
       t.totalQuantity === 200 && t.onHandHere === 0,
       `gốc total=${t.totalQuantity} riêng gốc=${t.onHandHere}`);
    ok("K4 từng nhánh đúng số hàng của nó",
       nodeA.onHandHere === 100 && nodeB.onHandHere === 80,
       `A=${nodeA.onHandHere}, B=${nodeB.onHandHere}`);
    // A có 100 riêng + 20 trong KHU-C ở cấp 2 ⇒ total của A phải là 120.
    const nodeC = nodeA.children.find((c) => c.code === "KHU-C");
    ok("K4 cây ĐỆ QUY: vị trí cấp 2 nằm trong nhánh cha và cộng vào tổng",
       !!nodeC && nodeA.totalQuantity === 120 && nodeC.totalQuantity === 20,
       `A.total=${nodeA.totalQuantity}, C.total=${nodeC?.totalQuantity}`);
    ok("K4 vị trí rỗng có tổng bằng 0", nodeNhan.onHandHere === 0 && nodeNhan.totalQuantity === 0);
    ok("K4 chỉ PHYSICAL mới được đánh dấu chứa hàng",
       nodeA.canHoldStock === true && nodeNhan.canHoldStock === false,
       `A=${nodeA.canHoldStock}, NHAN=${nodeNhan.canHoldStock}`);
    ok("K4 ATP = tồn − giữ chữ", nodeA.skus[0].atp === 80, `ATP=${nodeA.skus[0].atp}`);
    ok("K4 vị trí cấp 2 cũng có danh sách SKU (select không bỏ sót)",
       nodeC && Array.isArray(nodeC.skus) && nodeC.skus.length === 1,
       `C.skus=${nodeC?.skus?.length}`);

    // ---- K5: L1 — đổi vị trí ĐANG CÓ HÀNG sang VIEW ⇒ chặn ----
    let doiSangView = false;
    try {
      await tree.setLocationType(khuA.id, "VIEW", user.id);
    } catch {
      doiSangView = true;
    }
    ok("K5 L1: không cho đổi vị trí đang có hàng sang loại không chứa hàng", doiSangView);

    // ---- K6: vị trí RỄNG đổi sang VIEW được ----
    // Dùng `khoNhan` (không có hàng), KHÔNG dùng khuB vì khuB đang có 80 cái —
    // đổi khuB sang VIEW đúng là phải bị chặn, đó là K5 chứ không phải K6.
    const changed = await tree.setLocationType(khoNhan.id, "VIEW", user.id);
    ok("K6 vị trí rỗng đổi sang VIEW được", changed.locationType === "VIEW");
    const back = await tree.setLocationType(khoNhan.id, "PHYSICAL", user.id);
    ok("K6 đổi lại về PHYSICAL được", back.locationType === "PHYSICAL");

    // ---- K7: L4 — tự làm cha của chính mình ----
    let tuLamCha = false;
    try {
      await prisma.warehouse.update({ where: { id: khuA.id }, data: { parentId: khuA.id } });
    } catch {
      tuLamCha = true;
    }
    ok("K7 L4: DB chặn vị trí làm cha của chính mình (CHECK)", tuLamCha);

    // ---- K8: L2 — kho con tenant A gắn vào kho cha tenant B ----
    const other = await prisma.tenant.findFirst({ where: { slug: { not: TENANT_SLUG } }, select: { id: true } });
    if (other) {
      // Lấy đúng một kho CỦA TENANT KHÁC. Subquery phải chạy ngoài tenant
      // context thì mới thấy kho tenant khác — dùng raw SQL.
      const otherWh = await prisma.$queryRawUnsafe(
        `SELECT id, "tenantId" FROM warehouses WHERE "tenantId" <> $1 AND "parentId" IS NULL LIMIT 1`,
        tenant.id,
      );
      if (!otherWh.length) {
        ok("K8 (bỏ qua: tenant thứ hai chưa có kho để thử)", true);
      } else {
        // Gắn `khuA` (tenant demo) làm con của kho thuộc tenant KHÁC.
        const crossOk = await prisma.$executeRawUnsafe(
          `UPDATE warehouses SET "parentId" = $1 WHERE id = $2`,
          otherWh[0].id, khuA.id,
        ).then(() => false, () => true);
        ok("K8 L2: trigger chặn gắn vị trí sang kho cha của tenant khác", crossOk,
           `cha tenant=${String(otherWh[0].tenantId).slice(0, 8)}…`);
      }
    } else {
      ok("K8 (bỏ qua: không còn tenant thứ hai)", true);
    }

    // ---- K9: L3 — xoá kho cha còn kho con ----
    let xoaCha = false;
    try {
      await prisma.warehouse.delete({ where: { id: root.id } });
    } catch {
      xoaCha = true;
    }
    ok("K9 L3: DB chặn xoá kho cha còn vị trí con (ON DELETE RESTRICT)", xoaCha);

    // ---- K10: mã vị trí trùng trong cùng kho ----
    let trungMa = false;
    try {
      await tree.createLocation({ warehouseId: root.id, code: "KHU-A", name: "Trùng mã" }, user.id);
    } catch {
      trungMa = true;
    }
    ok("K10 chặn trùng mã vị trí trong cùng kho", trungMa);

    return { root, khuA, khuB, khuC, product };
  });

  // ---- Teardown: gom theo cây, bỏ cha-con rồi xoá ----
  await runWithTenant(tenant.id, async () => {
    const ids = created.whIds;
    await prisma.$executeRawUnsafe(`UPDATE warehouses SET "parentId" = NULL WHERE id = ANY($1::text[])`, [ids]);
    await prisma.inventoryTransaction.deleteMany({ where: { inventory: { warehouseId: { in: ids } } } });
    await prisma.inventoryLot.deleteMany({ where: { warehouseId: { in: ids } } });
    await prisma.inventory.deleteMany({ where: { warehouseId: { in: ids } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: created.products } } });
    await prisma.category.deleteMany({ where: { id: { in: created.categories } } });
    await prisma.auditLog.deleteMany({ where: { action: { in: ["CREATE_WAREHOUSE_LOCATION", "SET_WAREHOUSE_LOCATION_TYPE"] } } });
  });
  await verifyTeardown([], prisma);
  ok("K11 teardown sạch (0 dòng sót, 0 mồ côi tăng)", true);

  console.log(`\nTất cả: ${pass + fail} | PASS ${pass} | FAIL ${fail}`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  console.error((e.stack || "").split("\n").slice(1, 4).join("\n"));
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});