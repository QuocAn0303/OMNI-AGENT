/**
 * Smoke Phase 4 — Sales hierarchy trên DB THẬT (mục 2)
 *
 * Vì sao cần script này mà unit test chưa đủ:
 * - Migration thêm self-relation `users.reportsToId` + FK. Chỉ DB mới xác nhận được
 *   FK thật có chặn tự vòng / chéo tenant, và `ON DELETE SET NULL` có đúng như mong đợi.
 * - `getDescendantIds` chạy BFS đệ quy trên dữ liệu thật — rủi ro treo request nếu
 *   dữ liệu bẩn. Unit test mock trả sẵn, không chứng minh được truy vấn thật đúng.
 * - Thay đổi hành vi phân quyền (mục 6b) — cần xác nhận cây phẳng KHÔNG siết phạm vi,
 *   cây có dữ liệu thì CÓ siết. Đây là điều dễ làm hỏng nhất của Phase 4.
 *
 * Chạy: node scripts/smoke-crm-phase4-hierarchy.js
 * Giữ dữ liệu: -- --keep
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("smoke-crm-phase4-hierarchy");
const { captureBaseline, verifyTeardown } = require("./lib/teardown");
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const hierarchy = require("../src/modules/crm/hierarchy.service");
const { isManager, ownerScopeForTeam } = require("../src/modules/crm/scope");

let pass = 0;
let fail = 0;
const KEEP = process.argv.includes("--keep");

const check = (label, cond, extra = "") => {
  if (cond) {
    pass += 1;
    console.log(`  OK   ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}`);
const TAG = `p4hier_${Date.now()}`;
let cleanupRef = null;
// Id tenant thử đã tạo — dùng để verify không còn dòng nào sót thuộc tenant này.
const createdTenants = [];

/**
 * Dọn dẹp — gọi cả khi script lỗi.
 * Bản đầu chỉ dọn ở cuối luồng thành công; 1 lần chạy lỗi để lại 2 tenant + 6 user.
 */
const cleanup = async () => {
  cleanupRef = cleanup;
  if (KEEP) {
    console.log("  --keep: giữ dữ liệu để debug.");
    return;
  }
  try {
    hierarchy._resetCacheForTest();
    // `hierarchy.setReportsTo` ghi audit log cho mỗi lần đổi cây quản lý. Xoá
    // TRƯỚC tenant/user vì `audit_logs` không có FK tới `tenants` (134/139 bảng
    // scoped không có khoá ngoại tới `tenants`) ⇒ xoá tenant đi thì 6 dòng log
    // thành MỒ CÔI-TENANT. Đây là nguồn rò thật, đo được: 6 dòng mỗi lần chạy.
    const da = await prisma.auditLog.deleteMany({ where: { tenantId: { in: createdTenants } } });
    const du = await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    const dt = await prisma.tenant.deleteMany({ where: { slug: { startsWith: TAG } } });
    const left = await prisma.tenant.count({ where: { slug: { startsWith: TAG } } });
    const leftUser = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    console.log(`  audit_log xoá=${da.count} · user xoá=${du.count} tenant xoá=${dt.count} · còn sót tenant=${left} user=${leftUser}`);
    if (left || leftUser) {
      fail += 1;
      console.log("  FAIL dọn dẹp chưa sạch");
    } else {
      pass += 1;
      console.log("  OK   dọn dẹp sạch, không sót dữ liệu test");
    }
  } catch (e) {
    fail += 1;
    console.log(`  FAIL dọn dẹp lỗi — ${e.message.split("\n")[0]}`);
  }

  // Verify dùng chung: bắt cả bảng ngoài danh sách trên bị rò, và bắt
  // mồ côi-tenant tăng thêm so với baseline lúc bắt đầu.
  try {
    await verifyTeardown(createdTenants, prisma);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL ${e.message}`);
  }
};

(async () => {
  cleanupRef = cleanup;
  // Baseline mồ côi-tenant TRƯỚC khi seed (xem scripts/lib/teardown.js).
  await captureBaseline(prisma);
  section("1. Tạo user thật (2 tenant, cây 3 tầng)");
  const t1 = await prisma.tenant.create({ data: { name: `${TAG}-t1`, slug: TAG, isActive: true } });
  const t2 = await prisma.tenant.create({ data: { name: `${TAG}-t2`, slug: `${TAG}_2`, isActive: true } });
  createdTenants.push(t1.id, t2.id);

  const mkUser = (tenantId, key, role = "CASHIER") =>
    prisma.user.create({
      data: {
        tenantId, email: `${TAG}-${key}@x.vn`, password: "smoke-test-not-a-real-hash",
        fullName: `${TAG}-${key}`, role, isActive: true,
      },
    });

  // Cây: boss → mgr → staff1, staff2   (tenant 1)
  const boss = await mkUser(t1.id, "boss", "ADMIN");
  const mgr = await mkUser(t1.id, "mgr", "MANAGER");
  const staff1 = await mkUser(t1.id, "staff1");
  const staff2 = await mkUser(t1.id, "staff2");
  // Tenant 2: người cùng tên vai trò để test rò tenant
  const bossOther = await mkUser(t2.id, "boss2", "ADMIN");
  const staffOther = await mkUser(t2.id, "staffX");

  const all1 = [boss, mgr, staff1, staff2];
  console.log(`  tenant1: ${all1.length} user · tenant2: ${bossOther.id ? 2 : 0} user`);

  // ---------------------------------------------------------------- cây phẳng
  section("2. CÂY PHẲNG — phải GIỮ NGUYÊN hành vi Phase 2/3");
  hierarchy._resetCacheForTest();
  const flatTeam = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(boss));
  check("cây phẳng → getTeamUserIds trả null (KHÔNG siết phạm vi)", flatTeam === null, `${flatTeam}`);
  check(
    "ownerScopeForTeam(null) → lùi về phạm vi toàn tenant",
    Object.keys(ownerScopeForTeam(boss, "leadOwnerId", null)).length === 0,
    JSON.stringify(ownerScopeForTeam(boss, "leadOwnerId", null)),
  );
  const flatScope = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(boss));
  check("gọi lần 2 vẫn null (cache đúng)", flatScope === null);

  // ---------------------------------------------------------------- dựng cây
  section("3. Dựng cây báo cáo");
  const setR = async (uid, managerId) =>
    runWithTenant(t1.id, () => hierarchy.setReportsTo(uid, managerId, boss));

  await setR(mgr.id, boss.id);
  check("gán mgr → boss thành công", true);

  const s1 = await setR(staff1.id, mgr.id);
  check("gán staff1 → mgr thành công", s1.reportsToId === mgr.id, `${s1.reportsToId}`);
  await setR(staff2.id, mgr.id);

  // Xác nhận đã LƯU thật vào DB
  const bossDb = await prisma.user.findUnique({ where: { id: boss.id }, select: { reportsToId: true } });
  check("reportsToId lưu đúng vào DB", bossDb.reportsToId === null);
  const mgrDb = await prisma.user.findUnique({ where: { id: mgr.id }, select: { reportsToId: true } });
  check("mgr.reportsToId = boss trong DB", mgrDb.reportsToId === boss.id);

  // ---------------------------------------------------------------- đệ quy
  section("4. getDescendantIds — BFS nhiều tầng trên DB thật");
  hierarchy._resetCacheForTest();
  const descBoss = await runWithTenant(t1.id, () => hierarchy.getDescendantIds(boss.id));
  const descMgr = await runWithTenant(t1.id, () => hierarchy.getDescendantIds(mgr.id));
  check("boss thấy 3 bậc dưới (mgr, staff1, staff2)", descBoss.size === 3, `${descBoss.size}`);
  check("mgr thấy 2 bậc dưới", descMgr.size === 2, `${descMgr.size}`);
  check("boss KHÔNG nằm trong tập bậc dưới của chính mình", !descBoss.has(boss.id));
  check("bậc dưới không chứa user của tenant khác", !descBoss.has(staffOther.id));

  section("5. getTeamUserIds — siết phạm vi khi CÓ cây");
  const teamBoss = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(boss));
  check("boss có cây → [boss + 3 bậc dưới]", teamBoss.length === 4, `${teamBoss.length}`);
  const teamStaff = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(staff1));
  check("CASHIER → chỉ chính mình", teamStaff.length === 1 && teamStaff[0] === staff1.id);

  check(
    "ownerScopeForTeam(1 người) → giữ dạng scalar (không đổi hợp đồng)",
    ownerScopeForTeam(staff1, "leadOwnerId", teamStaff).leadOwnerId === staff1.id,
    JSON.stringify(ownerScopeForTeam(staff1, "leadOwnerId", teamStaff)),
  );
  check(
    "ownerScopeForTeam(4 người) → dùng { in: [...] }",
    Array.isArray(ownerScopeForTeam(boss, "leadOwnerId", teamBoss).leadOwnerId.in),
    JSON.stringify(ownerScopeForTeam(boss, "leadOwnerId", teamBoss).leadOwnerId),
  );

  // ---------------------------------------------------------------- getTree
  section("6. getTree — dựng cây lồng nhau");
  const tree = await runWithTenant(t1.id, () => hierarchy.getTree(boss));
  const rootNode = tree.roots.find((r) => r.id === boss.id);
  check("boss là gốc cây", Boolean(rootNode));
  const mgrNode = rootNode?.children?.find((c) => c.id === mgr.id);
  check("mgr là con của boss", Boolean(mgrNode));
  check("staff1/2 là cháu của boss", (mgrNode?.children || []).length === 2);
  check("totals.users đếm đủ 4 user của tenant", tree.totals.users === 4, `${tree.totals.users}`);

  // ---------------------------------------------------------------- chặn vòng
  section("7. Chống vòng lặp + chặn cross-tenant (FK thật)");
  const selfAssign = await runWithTenant(t1.id, () =>
    hierarchy.setReportsTo(boss.id, boss.id, boss).then(() => null).catch((e) => e.status),
  );
  check("tự gán mình → 400", selfAssign === 400, `${selfAssign}`);

  const cycle = await runWithTenant(t1.id, () =>
    hierarchy.setReportsTo(boss.id, staff1.id, boss).then(() => null).catch((e) => e.status),
  );
  check("gán boss làm trưởng của staff1 (tạo vòng boss→mgr→staff1) → 400", cycle === 400, `${cycle}`);

  const bossAfter = await prisma.user.findUnique({ where: { id: boss.id }, select: { reportsToId: true } });
  check("cây KHÔNG bị hỏng sau khi thử tạo vòng", bossAfter.reportsToId === null);

  // Cross-tenant: service tra manager qua client ĐÃ tenant-scope nên KHÔNG thấy
  // user tenant khác → trả 404 chứ không phải 400. 404 ở đây là ĐÚNG và tốt hơn:
  // không lộ ra sự tồn tại của user bên tenant khác. Check 400 trong service là
  // defense in depth cho trường hợp bypass tenant-scoping (SUPER_OMEGA).
  const crossTenant = await runWithTenant(t1.id, () =>
    hierarchy.setReportsTo(staff1.id, bossOther.id, boss).then(() => null).catch((e) => e.status),
  );
  check(
    "gán quản lý khác tenant → bị chặn (404: tenant-scoping không thấy)",
    crossTenant === 404 || crossTenant === 400,
    `status=${crossTenant}`,
  );

  // Ghi rõ giới hạn: DB KHÔNG có ràng buộc chéo tenant (CHECK không so sánh
  // cross-row được). Việc chặn nằm ở service + tenant-scoping. Test này tồn tại
  // để ghi nhận điều đó, không phải để khẳng định DB chặn được.
  const crossTenantDb = await runWithTenant(t2.id, async () =>
    prisma.user.update({
      where: { id: staffOther.id },
      data: { reportsToId: boss.id },
    }).then(() => "CREATED").catch((e) => e.code),
  );
  console.log(
    `  GHI NHẬN: DB cho phép chéo tenant (code=${crossTenantDb}) — CHECK constraint không so sánh` +
    " cross-row được, chống chéo tenant thuộc tầng service. Đây là giới hạn đã biết.",
  );
  // Dọn lại để không làm bẩn các bước sau
  await prisma.user.update({ where: { id: staffOther.id }, data: { reportsToId: null } });

  // ---------------------------------------------------------------- FK thật
  section("8. FK + CHECK users.reportsToId");
  // CHECK constraint thật (migration 20261001140000) — dữ liệu bẩn tồn tại thì
  // service chặn, nhưng nếu có bug bypass service thì DB vẫn phải chặn.
  const selfFk = await runWithTenant(t1.id, () =>
    prisma.user.update({ where: { id: staff1.id }, data: { reportsToId: staff1.id } })
      .then(() => "CREATED").catch((e) => e.code),
  );
  check("DB chặn reportsToId tự trỏ chính nó (CHECK constraint)", selfFk !== "CREATED", `code=${selfFk}`);
  const missingFk = await runWithTenant(t1.id, () =>
    prisma.user.update({ where: { id: staff1.id }, data: { reportsToId: "khong-ton-tai" } })
      .then(() => "CREATED").catch((e) => e.code),
  );
  check("DB chặn reportsToId không tồn tại (P2003)", missingFk === "P2003", `code=${missingFk}`);

// ---------------------------------------------------------------- cache
  section("9. Cache — đổi cây thì cache phải hết hiệu lực");
  // Bộ dữ liệu lúc đây: boss → mgr → {staff1, staff2}
  hierarchy._resetCacheForTest();
  const before = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(boss));
  check("trước khi đổi cây: boss thấy 3 bậc dưới", Array.isArray(before) && before.length === 4, `${JSON.stringify(before)}`);

  // Bỏ mgr ra khỏi cây → staff1/staff2 mồ côi, boss KHÔNG còn bậc dưới nào
  const clearMgr = await runWithTenant(t1.id, () => hierarchy.setReportsTo(mgr.id, null, boss));
  check("bỏ quản lý của mgr (mgr thành gốc)", clearMgr.reportsToId === null);

  const afterClear = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(boss));
  check(
    "SAU khi đổi cây: boss KHÔNG còn bậc dưới → null (cache cũ đã bị xoá)",
    afterClear === null,
    `${JSON.stringify(afterClear)}`,
  );

  // Cache cũ trả 4 người; nếu không invalidate, lần gọi sau vẫn ra 4 → test này bắt được.
  hierarchy._resetCacheForTest();
  const rebuilt = await runWithTenant(t1.id, () => hierarchy.setReportsTo(mgr.id, boss.id, boss));
  check("dựng lại cây", rebuilt.reportsToId === boss.id);
  const reCheck = await runWithTenant(t1.id, () => hierarchy.getTeamUserIds(boss));
  check("sau khi dựng lại: boss thấy lại 3 bậc dưới", Array.isArray(reCheck) && reCheck.length === 4, `${JSON.stringify(reCheck)}`);

  // ---------------------------------------------------------------- delete
  section("10. ON DELETE SET NULL — xoá quản lý không xoá cả cây");
  const toDelete = await runWithTenant(t1.id, () => hierarchy.setReportsTo(staff2.id, staff1.id, boss));
  check("gán staff2 → staff1", toDelete.reportsToId === staff1.id);

  await runWithTenant(t1.id, () => prisma.user.delete({ where: { id: staff1.id } }));
  const staff2After = await prisma.user.findUnique({ where: { id: staff2.id }, select: { reportsToId: true } });
  check("xoá staff1 → staff2.reportsToId = NULL thay vì mất row", staff2After !== null && staff2After.reportsToId === null, `${JSON.stringify(staff2After)}`);

  // ---------------------------------------------------------------- quyền
  section("11. Phân quyền — CASHIER không sửa được cây");
  const cashierDenied = await runWithTenant(t1.id, () =>
    hierarchy.setReportsTo(staffOther.id, boss.id, staff2).then(() => null).catch((e) => e.status),
  );
  check("CASHIER sửa cây → 403", cashierDenied === 403, `${cashierDenied}`);
  check("isManager(MANAGER) = true", isManager({ role: "MANAGER" }) === true);
  check("isManager(CASHIER) = false", isManager({ role: "CASHIER" }) === false);

  // ---------------------------------------------------------------- dọn dẹp
  section("12. Dọn dẹp");
  await cleanup();

  console.log(`\n--- Kết quả: ${pass} pass / ${fail} fail ---`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("SMOKE ERROR:", e.message);
  console.error(e.stack?.split("\n").slice(0, 8).join("\n"));
  // Dọn dẹp VẪN phải chạy khi script lỗi — nếu không, dữ liệu rác sót lại và các
  // smoke script sau đọc nhầm.
  try { if (cleanupRef) await cleanupRef(); } catch (ce) { console.error("cleanup lỗi:", ce.message); }
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});