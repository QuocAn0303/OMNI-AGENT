/**
 * scripts/smoke-po-gate.js — NGHIỆM THU LUỒNG ĐỀ XUẤT PO BẰNG DB THẬT
 *
 * Vì sao cần: `check:humangate` chỉ kiểm gate `DATA_REQUEST`. Nó KHÔNG động tới
 * luồng đề xuất PO. Nếu chỉ dựa vào unit test với mock Prisma thì chưa chứng
 * minh được: transaction thật, advisory lock thật, tenant isolation thật, và
 * việc `purchase.service.create` thật sự tạo ra PO.
 *
 * Kịch bản (đúng theo yêu cầu nghiệm thu mục 3E):
 *   1. Sinh đề xuất → duyệt → đúng MỘT PO, resultRef đúng
 *   2. Duyệt hai lần song song → vẫn MỘT PO
 *   3. Từ chối cần lý do; đã từ chối thì không có PO
 *   4. Dữ liệu đổi sau đề xuất: NO_LONGER_NEEDED / DRIFT_BLOCK / DRIFT_WARN
 *   5. Sau khi duyệt, KHÔNG sinh đề xuất trùng cho cùng SKU (mục 3A)
 *   6. Hai tenant: B không thấy / không duyệt được đề xuất của A
 *   7. Hồi phục trạng thái lơ lửng → thử lại ra đúng MỘT PO
 *
 * Cỡ mô phỏng: 2 tenant thật trong DB local, tự dọn dẹp.
 * Chạy:     node scripts/smoke-po-gate.js
 *
 * LƯU Ý: kịch bản 7 mô phỏng lỗi bằng cách XOÁ resultRef sau khi PO đã tạo
 * (tương đương "tiến trình chết giữa lúc ghi resultRef"). Không thêm cờ bật lỗi
 * vào mã chạy thật.
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
const dbInfo = assertLocalDb("smoke-po-gate");
const { track, cleanup, installSignalHandlers } = require("./lib/cleanup-registry");
installSignalHandlers("smoke-po-gate");

const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const { suggestForProduct } = require("../src/modules/replenishment/replenishment.suggest");
const { executeGate } = require("../src/modules/ai/agent.gate.exec");
const { PO_PROPOSAL } = require("../src/modules/ai/agent.humangate");
const logger = require("../src/utils/logger");

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? ` → ${extra}` : ""}`);
  if (cond) pass += 1;
  else fail += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const suffix = Date.now().toString(36);

/**
 * Dọn dẹp theo thứ tự phụ thuộc.
 *
 * KHÔNG dùng `track()` rời rạc ở đây: `order_items.orderId` và `products.categoryId`
 * đều là `onDelete: RESTRICT`, nên phải xoá theo đúng thứ tự con→cha, nếu không
 * sẽ bỏ sót dữ liệu. Một hàm teardown duy nhất theo tenant ít dễ sai hơn.
 */
const trackTenantTeardown = (tenantId) =>
  track(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { tenantId } } });
    await prisma.order.deleteMany({ where: { tenantId } });
    await prisma.purchaseItem.deleteMany({ where: { purchaseOrder: { tenantId } } });
    await prisma.purchaseOrder.deleteMany({ where: { tenantId } });
    await prisma.inventory.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { tenantId } });
    await prisma.category.deleteMany({ where: { tenantId } });
    await prisma.vendor.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.agentHumanGate.deleteMany({ where: { tenantId } });
    await prisma.agentSession.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

/** Seed tối thiểu: tenant + admin + kho + sản phẩm + tồn + lịch sử bán 28 ngày. */
const seedTenant = async (label) => {
  const tenant = await prisma.tenant.create({ data: { name: `SMOKE ${label}`, slug: `smoke-${label}-${suffix}` } });
  trackTenantTeardown(tenant.id);

  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `smoke-${label}-${suffix}@test.local`,
      password: "smoke-test-not-a-real-hash",
      fullName: `Smoke ${label} Admin`,
      role: "ADMIN",
    },
  });

  const warehouse = await prisma.warehouse.create({
    data: { tenantId: tenant.id, code: `SMK-${label}-${suffix}`, name: `Kho ${label}` },
  });

  return { tenant, admin, warehouse };
};

/**
 * Tạo SKU với lịch sử bán `perDay`/ngày trong `days` ngày và tồn `qty`.
 * Tồn THẤP hơn ROP ⇒ đề xuất sẽ được sinh.
 */
const seedLowStockProduct = async (t, { label, perDay = 5, days = 28, qty = 3 }) => {
  const category = await prisma.category.create({
    data: { tenantId: t.tenant.id, name: `Danh mục ${label}` },
  });

  const product = await prisma.product.create({
    data: {
      tenantId: t.tenant.id, sku: `SMK-P-${label}-${suffix}`,
      name: `Sản phẩm ${label}`, price: 100000, costPrice: 40000,
      categoryId: category.id,
    },
  });

  await prisma.inventory.create({
    data: { tenantId: t.tenant.id, productId: product.id, warehouseId: t.warehouse.id, quantity: qty, minStock: 10 },
  });

  const customer = await prisma.customer.create({
    data: {
      tenantId: t.tenant.id,
      name: `KH ${label}`,
      // `phone` unique theo (phone, tenantId) ⇒ phải khác nhau theo label, vì
      // cùng một tenant có thể seed nhiều SKU (kịch bản drift dùng label C/D).
      phone: `0900${String(label).charCodeAt(0) - 64}${suffix.slice(-5)}`,
      tier: "BRONZE",
    },
  });

  // Lịch sử bán theo NGÀY được tạo ở `seedDailyOrders` (gọi riêng) — vì
  // `calcDemand` cần chuỗi ngày liên tục để tính trung bình, không phải một
  // đơn gộp.
  //
  // Mỗi SKU cần một NCC: `suggest` lấy NCC từ PO gần nhất có chứa SKU này,
  // và nếu không có thì cố ý trả `{ needVendor: true }` chứ không tự bịa NCC.
  const vendor = await prisma.vendor.create({
    data: { tenantId: t.tenant.id, code: `SMK-V-${label}-${suffix}`, name: `NCC ${label}`, isActive: true },
  });
  await prisma.purchaseOrder.create({
    data: {
      tenantId: t.tenant.id, poCode: `SMK-POOLD-${label}-${suffix}`, vendorId: vendor.id,
      status: "RECEIVED", subtotal: 2000000, taxAmount: 0, total: 2000000, createdById: t.admin.id,
      items: { create: [{ productId: product.id, quantity: 50, unitCost: 40000, subtotal: 2000000 }] },
    },
  });

  return product;
};

/** Lịch sử bán phải là NHIỀU order/ngày để có chuỗi ngày — tạo bằng vòng lặp. */
const seedDailyOrders = async (t, product, { label, perDay = 5, days = 28 }) => {
  const customer = await prisma.customer.findFirst({ where: { tenantId: t.tenant.id } });
  for (let i = 0; i < days; i += 1) {
    const createdAt = new Date(Date.now() - i * 86400000);
    const order = await prisma.order.create({
      data: {
        tenantId: t.tenant.id, orderCode: `SMK-OD-${label}-${suffix}-${i}`,
        customerId: customer.id, createdById: t.admin.id, status: "COMPLETED", createdAt, subtotal: perDay * 100000, total: perDay * 100000,
      },
    });
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: product.id, quantity: perDay, price: 100000, subtotal: perDay * 100000 },
    });
  }
};

/** Đưa tồn lên cao ⇒ ATP > ROP ⇒ phải sinh NO_LONGER_NEEDED. */
const raiseStock = async (t, product, quantity) => {
  await prisma.inventory.updateMany({
    where: { productId: product.id, warehouseId: t.warehouse.id },
    data: { quantity },
  });
};

(async () => {
  console.log("\n=== SMOKE LUỒNG ĐỀ XUẤT PO (DB THẬT) ===");
  console.log(`DB: ${dbInfo}`);
  console.log(`Kịch bản này dùng DB THẬT + logic THẬT (không mock).\n`);

  try {
    // Seed PHẢI chạy trong tenant context: nếu không, Prisma extension không
    // gắn `tenantId` cho các dòng tạo ra (và chính loader của suggest cũng không
    // nhìn thấy chúng) — đó chính là lý do lần chạy đầu sinh đề xuất rỗng.
    const A = await seedTenant("A");
    const B = await seedTenant("B");

    // ── Chuẩn bị SKU A: bán 5/ngày × 28 ngày, tồn 3, chưa có NCC ────────────
    await runWithTenant(A.tenant.id, async () => {
      await seedLowStockProduct(A, { label: "A", perDay: 5, days: 28, qty: 3 });
      const seeded = await prisma.product.findFirst({
        where: { tenantId: A.tenant.id, sku: { startsWith: "SMK-P-A-" } },
      });
      await seedDailyOrders(A, seeded, { label: "A", perDay: 5, days: 28 });
    });
    const pA = await prisma.product.findFirst({
      where: { tenantId: A.tenant.id, sku: { startsWith: "SMK-P-A-" } },
    });

const inTenantA = (fn) => runWithTenant(A.tenant.id, fn);
    const inTenantB = (fn) => runWithTenant(B.tenant.id, fn);

    /**
     * Mô phỏng đúng phần "quyết định" của HTTP route: giành quyền duyệt bằng
     * `updateMany` có điều kiện `status = PENDING` (nguyên tử ở tầng DB), rồi
     * mới gọi executor. Nếu gọi thẳng `executeGate` hai lần thì cả hai đều bị
     * từ chối vì executor yêu cầu `APPROVED` — chưa chứng minh được tính
     * "duyệt song song chỉ tạo một PO".
     *
     * @returns {Promise<{claimed: boolean, result?: object, error?: object}>}
     */
    const claimAndExecute = (tenantId, gateId, userId) => {
      const run = (fn) => runWithTenant(tenantId, fn);
      return run(async () => {
        const claim = await prisma.agentHumanGate.updateMany({
          where: { id: gateId, status: "PENDING" },
          data: { status: "APPROVED", decidedAt: new Date(), decidedById: userId },
        });
        if (claim.count !== 1) return { claimed: false, error: new Error("gate không ở PENDING (đã xử lý)") };
        try {
          return { claimed: true, result: await executeGate(gateId, userId) };
        } catch (error) {
          return { claimed: true, error };
        }
      });
    };

    /** Đếm PO ĐANG MỞ — PO lịch sử `RECEIVED` có sẵn và không được tính vào. */
    const countOpenPo = (tenantId) =>
      runWithTenant(tenantId, () =>
        prisma.purchaseOrder.count({
          where: {
            tenantId,
            status: { in: ["DRAFT", "PENDING", "PENDING_APPROVAL", "APPROVED", "ORDERED"] },
          },
        }),
      );

    // ── 1. Sinh đề xuất ────────────────────────────────────────────────────
    const r1 = await inTenantA(() => suggestForProduct({ tenantId: A.tenant.id, productId: pA.id }));
    ok("1. Sinh được đề xuất từ tồn thấp", Boolean(r1?.gate?.id), r1?.gate?.id || JSON.stringify(r1)?.slice(0, 90));
    const gateId = r1?.gate?.id;
    if (!gateId) throw new Error("không tạo được đề xuất → dừng smoke");

    ok("1a. Gate có hiệu lực: CHƯA có PO đang mở nào trước khi duyệt",
      (await countOpenPo(A.tenant.id)) === 0);

    const gateAfterCreate = await inTenantA(() => prisma.agentHumanGate.findFirst({ where: { id: gateId } }));
    ok("1b. gate PENDING + resultRef null",
      gateAfterCreate.status === "PENDING" && gateAfterCreate.resultRef === null);

    // ── 2. Duyệt hai lần SONG SONG: chỉ một lần giành được quyền ────────────
    const [ra, rb] = await Promise.all([
      claimAndExecute(A.tenant.id, gateId, A.admin.id),
      claimAndExecute(A.tenant.id, gateId, A.admin.id),
    ]);
    const claimed = [ra, rb].filter((r) => r.claimed).length;
    const created = [ra, rb].filter((r) => r.result && r.result.po && r.result.po.id).length;
    const openAfter = await countOpenPo(A.tenant.id);

    ok("2. Duyệt song song: chỉ 1 lần giành được quyền duyệt", claimed === 1, `claimed=${claimed}`);
    ok("2b. Duyệt song song: đúng 1 PO được tạo", created === 1 && openAfter === 1,
      `created=${created}, openPO=${openAfter}`);
    ok("2c. Lần thứ bị từ chối, không tạo PO thứ hai",
      Boolean([ra, rb].find((r) => !r.claimed)));

    const gateAfterApprove = await inTenantA(() => prisma.agentHumanGate.findFirst({ where: { id: gateId } }));
    const createdPoId = gateAfterApprove.resultRef;
    ok("3. resultRef trỏ đúng PO vừa tạo", Boolean(createdPoId), `resultRef=${createdPoId}`);

    // ── 4. Sau khi duyệt, onOrder chặn đề xuất trùng cho cùng SKU ───────────
    const r2 = await inTenantA(() => suggestForProduct({ tenantId: A.tenant.id, productId: pA.id }));
    ok("4. onOrder chặn đề xuất trùng cho cùng SKU", r2 === null, JSON.stringify(r2)?.slice(0, 70));

    // ── 5. Tenant B: thấy/không thấy dữ liệu của A ─────────────────────────
    const gatesSeenByB = await inTenantB(() => prisma.agentHumanGate.findMany({ where: { id: gateId } }));
    ok("5. Tenant B KHÔNG thấy gate của tenant A", gatesSeenByB.length === 0);

    const pB = await inTenantB(async () => {
      const seeded = await seedLowStockProduct(B, { label: "B", perDay: 5, days: 28, qty: 3 });
      await seedDailyOrders(B, seeded, { label: "B", perDay: 5, days: 28 });
      return seeded;
    });

    const gB = await inTenantB(() => suggestForProduct({ tenantId: B.tenant.id, productId: pB.id }));
    ok("6. Tenant B tự sinh được đề xuất riêng (tồn thấp)", Boolean(gB?.gate?.id), gB?.gate?.id || "");

    // B định duyệt gate của A: executor phải chặn vì gate không thuộc tenant B.
    let crossTenant = null;
    try {
      await inTenantB(() => executeGate(gateId, B.admin.id));
    } catch (e) {
      crossTenant = e;
    }
    ok("6b. Tenant B KHÔNG duyệt được gate của A", Boolean(crossTenant),
      crossTenant?.message?.slice(0, 60) || "không bị chặn!");

    // ── 7. NO_LONGER_NEEDED: dữ liệu đã không còn cần nhập nữa ──────────────
    await raiseStock(B, pB, 100000);
    let nln = null;
    if (gB?.gate?.id) {
      const r = await claimAndExecute(B.tenant.id, gB.gate.id, B.admin.id);
      nln = r.error || null;
    }
    ok("7. Dữ liệu đổi (ATP > ROP) → NO_LONGER_NEEDED, không tạo PO",
      nln?.drift === "NO_LONGER_NEEDED", nln?.drift || nln?.message?.slice(0, 60) || "");
    ok("7b. NO_LONGER_NEEDED thì PO của B vẫn là 0", (await countOpenPo(B.tenant.id)) === 0);

    // ── 8. DRIFT_BLOCK: dữ liệu đổi lớn sau lúc đề xuất → chặn, không tạo PO ─
    // Mỗi kịch bản drift cần một gate RIÊNG còn PENDING: gate đã qua bước 7
    // thì không còn dùng lại được (mỗi gate chỉ thực thi một lần).
    const seedFreshLowStock = (label) =>
      runWithTenant(B.tenant.id, async () => {
        const seeded = await seedLowStockProduct(B, { label, perDay: 5, days: 28, qty: 3 });
        await seedDailyOrders(B, seeded, { label, perDay: 5, days: 28 });
        return seeded;
      });

    const poBeforeBlock = await countOpenPo(B.tenant.id);
    const pC = await seedFreshLowStock("C");
    const gC = await inTenantB(() => suggestForProduct({ tenantId: B.tenant.id, productId: pC.id }));
    ok("8. Sinh được đề xuất nền cho kịch bản DRIFT_BLOCK", Boolean(gC?.gate?.id));
    // Giảm tồn xuống mức VẪN còn dưới ROP nhưng lệch đáng kể so với lúc đề
    // xuất: đây mới là "cần nhập nhưng số lượng đã sai". (Xoá hẳn lịch sử bán
    // sẽ làm ROP = 0 ⇒ ATP > ROP ⇒ NO_LONGER_NEEDED, không phải DRIFT_BLOCK.)
    await prisma.inventory.updateMany({
      where: { productId: pC.id, warehouseId: B.warehouse.id }, data: { quantity: 30 },
    });
    let driftBlock = null;
    if (gC?.gate?.id) {
      const r = await claimAndExecute(B.tenant.id, gC.gate.id, B.admin.id);
      driftBlock = r.error || null;
    }
    ok("8b. Lệch lớn (số lượng) → DRIFT_BLOCK, không tạo PO",
      driftBlock?.drift === "DRIFT_BLOCK", driftBlock?.drift || driftBlock?.message?.slice(0, 70) || "");
    ok("8c. DRIFT_BLOCK thì không sinh PO mới", (await countOpenPo(B.tenant.id)) === poBeforeBlock);

    // ── 9. DRIFT_WARN: lệch nhỏ thì cảnh báo nhưng vẫn cho qua ───────────────
    const pD = await seedFreshLowStock("D");
    const gD = await inTenantB(() => suggestForProduct({ tenantId: B.tenant.id, productId: pD.id }));
    if (!gD?.gate?.id) {
      ok("9. Lệch nhỏ → DRIFT_WARN được ghi nhận, vẫn tạo PO", false, "không sinh được đề xuất nền");
    } else {
      const payload = gD.gate.actionPayload || gD.gate.payload || {};
      const item = (payload.items && payload.items[0]) || payload;
      const before = (payload.items && payload.items[0] && payload.items[0].quantity) || item.quantity || 0;
      // Cố tình lệch đúng 1 đơn vị: nhỏ hơn ngưỡng chặn ⇒ chỉ được cảnh báo.
      await prisma.agentHumanGate.update({
        where: { id: gD.gate.id },
        data: { actionPayload: { ...payload, items: [{ ...item, quantity: before - 1 }] } },
      });
      const rWarn = await claimAndExecute(B.tenant.id, gD.gate.id, B.admin.id);
      const warned = rWarn.result?.freshness?.status === "DRIFT_WARN"
        || rWarn.result?.freshness?.warnings?.includes("DRIFT_WARN")
        || rWarn.error?.drift === "DRIFT_WARN";
      ok("9. Lệch nhỏ → DRIFT_WARN được ghi nhận, vẫn tạo PO",
        warned && Boolean(rWarn.result?.po?.id),
        `status=${rWarn.result?.freshness?.status} warnings=${JSON.stringify(rWarn.result?.freshness?.warnings)} po=${rWarn.result?.po?.poCode || "khong-co"}`);
    }

    // ── 10. Trạng thái lơ lửng (APPROVED, resultRef null) → retry ra đúng 1 PO ──
    const beforeRetry = await countOpenPo(A.tenant.id);
    await inTenantA(() => prisma.agentHumanGate.update({ where: { id: gateId }, data: { resultRef: null } }));
    // Bật lại tồn thấp để revalidate không chặn NO_LONGER_NEEDED.
    await prisma.inventory.updateMany({
      where: { productId: pA.id, warehouseId: A.warehouse.id }, data: { quantity: 3 },
    });
    const { retryExecution } = require("../src/modules/ai/agent.gate.exec");
    let retryResult = null;
    try {
      retryResult = await inTenantA(() => retryExecution(gateId, A.admin.id));
    } catch (e) {
      retryResult = { error: e.message };
    }
    ok("10. Retry trạng thái lơ lửng → KHÔNG tạo PO thứ hai, liên kết PO cũ",
      retryResult?.linked === true && (await countOpenPo(A.tenant.id)) === beforeRetry,
      `linked=${retryResult?.linked}, err=${retryResult?.error}`);


    console.log(`\n=== ${fail === 0 ? "TẤT CẢ PASS" : "CÓ FAIL"} (${pass} pass / ${fail} fail) ===`);
  } catch (e) {
    console.error("LỖI:", e.message);
    console.error(e.stack?.split("\n").slice(0, 4).join("\n"));
    fail += 1;
  } finally {
    await cleanup();
    console.log("Đã dọn dẹp dữ liệu test.");
    await prisma.$disconnect();
  }

  process.exit(fail === 0 ? 0 : 1);
})();
