/**
 * docs/aisc26/one-off/cleanup-dev-residue.js — DỌN RÁC KIỂM THỬ TRÊN DB PHÁT TRIỂN
 *
 * DÙNG MỘT LẦN (Mốc 9). CHỈ áp dụng cho DB local.
 *
 * BỐN NHÓM ĐƯỢC PHÉP XOÁ — danh sách tường minh, ngoài danh sách thì HỦY.
 *
 *   A. 9 user kiểm thử + dữ liệu kéo theo
 *      users: e2e_test_%@example.com | smoke-%@test.local, tenantId NULL,
 *             role <> SUPER_OMEGA_ULTRA_ADMIN
 *      orders của 9 user đó, CHỈ khi tenant KHÔNG tồn tại và không có payments
 *      order_items của các đơn đó
 *      admin_campaign_recipients của 9 user (+ chiến dịch E2E Free User Promo
 *             nếu không còn recipient nào khác)
 *      refresh_tokens / notifications / audit_logs của 9 user (tenantId NULL hoặc
 *             mồ côi) — căn cứ là điều kiện thuộc đúng 9 user, KHÔNG phải số cứng
 *
 *   B. 7 tenant `DBG` do script debug tạo nhầm trong ngày
 *      (+ 3 user, 3 product, 4 category, 5 vendor) — mọi dòng phải có
 *      `createdAt` trong ngày hôm nay
 *
 *   C. 38 company_settings NULL do test E2E (tên `E2E Test %`, mọi cột khác
 *      `name` bằng đúng giá trị mặc định của schema)
 *
 *   D. Mồ côi-tenant còn lại: warehouses 36, audit_logs 69, products 3,
 *      categories 3 — mỗi dòng có `tenantId` KHÔNG tồn tại, và KHÔNG có dòng
 *      nào của tenant còn tồn tại tham chiếu tới (kiểm bằng metadata, không đoán)
 *
 * CHỐT CHẶN
 *   - Số dòng dry-run phải khớp ĐÚNG `EXPECTED` (cấp bởi quyet-dinh-moc-9.md).
 *   - Phép trừ 281 − 170 = 111 phải khớp tổng nhóm D.
 *   - Snapshot 2 tenant thật (CANDORY SCENT, Á đù) trước/sau phải GIỐNG HỆT.
 *   - `audit_logs` NULL toàn DB không được vượt 124.
 *   - Mọi thao tác trong MỘT transaction; sai bất kỳ điều kiện nào ⇒ rollback.
 *
 * DÙNG
 *   node docs/aisc26/one-off/cleanup-dev-residue.js            # dry-run
 *   node docs/aisc26/one-off/cleanup-dev-residue.js --apply    # ghi thật
 */

require("dotenv").config();
const path = require("path");
const { assertLocalDb } = require(path.join(__dirname, "..", "..", "..", "scripts", "lib", "assert-local-db"));
assertLocalDb("cleanup-dev-residue");

const { Client } = require("pg");
const url = new URL(process.env.DATABASE_URL);
const db = new Client({
  host: url.hostname,
  port: +url.port || 5432,
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});

const APPLY = process.argv.includes("--apply");

/**
 * Số kỳ vọng — nguồn: quyet-dinh-moc-9.md, ngày 2026-10-02.
 * Sửa ở đây là chỗ cần đội ký, đừng tự đổi để cho khớp.
 */
const EXPECTED = {
  // Nhóm A
  users: 9,
  orders: 86,
  order_items: 84,
  campaign_recipients: 9,
  // Nhóm B
  dbg_tenants: 7,
  dbg_users: 3,
  dbg_products: 3,
  dbg_categories: 4,
  dbg_vendors: 5,
  // Nhóm C
  company_settings: 38,
  // Nhóm D
  d_warehouses: 36,
  d_audit_logs: 69,
  d_products: 3,
  d_categories: 3,
};

/** Tổng mồ côi-tenant trước khi dọn; phép trừ này phải khớp (điều kiện dừng). */
const ORPHAN_TOTAL_BEFORE = 281;
/** 281 − (86 orders + 84 order_items) = 111. */
const ORPHAN_GROUP_D_EXPECTED = 111;

/** Ngưỡng trần `audit_logs` NULL toàn DB (điều kiện dừng). */
const AUDIT_LOGS_NULL_CEILING = 124;

/** Tenant thật — snapshot của họ phải không đổi. */
const REAL_TENANT_NAMES = ["CANDORY SCENT", "Á đù"];

const IDS = `(SELECT id FROM users
  WHERE "tenantId" IS NULL AND role::text <> 'SUPER_OMEGA_ULTRA_ADMIN'
    AND (email LIKE 'e2e\\_test\\_%@example.com' OR email LIKE 'smoke-%@test.local'))`;
const ORPHAN_ORDERS = `(SELECT id FROM orders o
  WHERE o."createdById" IN ${IDS}
    AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = o."tenantId")
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id))`;
const DBG_TENANTS = `(SELECT id FROM tenants WHERE name = 'DBG')`;

/** Điều kiện "mồ côi-tenant", theo alias của bảng đang truy vấn. */
const orph = (a) =>
  `${a ? a + "." : ""}"tenantId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = ${a ? a + "." : ""}"tenantId")`;

const CS_WHERE = `
      "tenantId" IS NULL
      AND name LIKE 'E2E Test %'
      AND address IS NULL AND phone IS NULL AND email IS NULL AND "taxCode" IS NULL
      AND logo IS NULL AND industry IS NULL AND currency = 'VND'
      AND "onboardingDone" = false AND "onboardingStep" = 0
      AND "businessTemplate" IS NULL AND "demoSeeded" = false
      AND "accountingMode"::text = 'FULL_VAS'
      AND "poApprovalThreshold" IS NULL AND "leadRoundRobinCursor" = 0
      AND "beginnerMode" = true`;

/** Bảng tham chiếu tới một bảng, lấy từ metadata. */
const fksReferencing = async (table) =>
  (
    await db.query(
      `SELECT tc.table_name AS t, kcu.column_name AS c
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND ccu.table_name = $1`,
      [table],
    )
  ).rows;

/**
 * Có dòng nào thuộc tenant CÒN TỒN TẠI tham chiếu tới các dòng mồ côi không?
 * Dùng metadata quan hệ, không đoán.
 */
const referencedBySurvivingTenant = async (table, whereSql) => {
  const fks = await fksReferencing(table);
  for (const fk of fks) {
    const n = (
      await db.query(
        `SELECT count(*)::int AS n
           FROM "${fk.t}" x
          WHERE x."${fk.c}" IN (SELECT id FROM "${table}" WHERE ${whereSql})
            AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = x."tenantId")`,
      )
    ).rows[0].n;
    if (n > 0) return `${fk.t}.${fk.c}=${n}`;
  }
  return null;
};

/** Snapshot số dòng theo bảng cho N tenant thật. */
const snapshotRealTenants = async () => {
  const ids = (
    await db.query(`SELECT id, name FROM tenants WHERE name = ANY($1::text[])`, [REAL_TENANT_NAMES])
  ).rows;
  const idList = ids.map((r) => `'${r.id}'`).join(",");
  const tables = (
    await db.query(`
      SELECT DISTINCT c.table_name AS t
        FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       WHERE c.column_name = 'tenantId' AND tb.table_type = 'BASE TABLE'
         AND c.table_schema = 'public' ORDER BY 1`)
  ).rows.map((r) => r.t);

  const snap = {};
  for (const t of tables) {
    snap[t] = (await db.query(`SELECT count(*)::int AS n FROM "${t}" WHERE "tenantId" IN (${idList})`)).rows[0].n;
  }
  snap.__tenants = ids.map((r) => r.name).sort().join("|");
  return snap;
};

const diffSnapshots = (a, b) =>
  Object.keys({ ...a, ...b })
    .filter((k) => a[k] !== b[k])
    .map((k) => `${k}: ${a[k]} -> ${b[k]}`);

const run = async () => {
  console.log(`\n=== DỌN RÁC KIỂM THỬ (${APPLY ? "--apply: GHI THẬT" : "dry-run"}) ===\n`);
  await db.connect();
  const problems = [];
  const counts = {};
  const notes = [];
  const q = async (sql, params) => (await db.query(sql, params)).rows;

  try {
    await db.query("BEGIN");

    // ── Nhóm A ────────────────────────────────────────────────────────────
    counts.users = (await q(`SELECT count(*)::int AS n FROM users WHERE id IN ${IDS}`))[0].n;
    const byPat = (
      await q(`SELECT count(*) FILTER (WHERE email LIKE 'e2e\\_test\\_%@example.com')::int AS e2e,
                      count(*) FILTER (WHERE email LIKE 'smoke-%@test.local')::int AS smoke
                 FROM users WHERE id IN ${IDS}`)
    )[0];
    if (byPat.e2e !== 4 || byPat.smoke !== 5) problems.push(`phân bố e2e/smoke ${byPat.e2e}/${byPat.smoke} ≠ 4/5`);

    counts.orders = (await q(`SELECT count(*)::int AS n FROM orders WHERE id IN ${ORPHAN_ORDERS}`))[0].n;
    const risky = (await q(`SELECT count(*)::int AS n FROM orders WHERE "createdById" IN ${IDS} AND id NOT IN ${ORPHAN_ORDERS}`))[0].n;
    if (risky > 0) problems.push(`có ${risky} đơn của user rác mà tenant còn tồn tại hoặc có payments — không xoá`);

    counts.order_items = (await q(`SELECT count(*)::int AS n FROM order_items WHERE "orderId" IN ${ORPHAN_ORDERS}`))[0].n;
    counts.campaign_recipients = (
      await q(`SELECT count(*)::int AS n FROM admin_campaign_recipients WHERE "userId" IN ${IDS}`)
    )[0].n;

    // Dòng phụ thuộc của 9 user: điều kiện là thuộc 9 user, không phải số cứng.
    const userDeps = {};
    for (const t of ["refresh_tokens", "notifications", "audit_logs"]) {
      const n = (
        await q(
          `SELECT count(*)::int AS n FROM "${t}"
            WHERE "userId" IN ${IDS} AND ("tenantId" IS NULL OR NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = "${t}"."tenantId"))`,
        )
      )[0].n;
      if (n > 0) userDeps[t] = n;
    }
    notes.push(["Dòng phụ thuộc của 9 user", userDeps]);

    // ── Nhóm B ────────────────────────────────────────────────────────────
    counts.dbg_tenants = (await q(`SELECT count(*)::int AS n FROM tenants WHERE id IN ${DBG_TENANTS}`))[0].n;
    counts.dbg_users = (await q(`SELECT count(*)::int AS n FROM users WHERE "tenantId" IN ${DBG_TENANTS}`))[0].n;
    counts.dbg_products = (await q(`SELECT count(*)::int AS n FROM products WHERE "tenantId" IN ${DBG_TENANTS}`))[0].n;
    counts.dbg_categories = (await q(`SELECT count(*)::int AS n FROM categories WHERE "tenantId" IN ${DBG_TENANTS}`))[0].n;
    counts.dbg_vendors = (await q(`SELECT count(*)::int AS n FROM vendors WHERE "tenantId" IN ${DBG_TENANTS}`))[0].n;

    // Điều kiện: mọi dòng nhóm B phải tạo trong ngày hôm nay.
    const today = (await q(`SELECT (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d`))[0].d;
    for (const t of ["users", "products", "categories", "vendors"]) {
      const old = (
        await q(
          `SELECT count(*)::int AS n FROM "${t}"
            WHERE "tenantId" IN ${DBG_TENANTS}
              AND ("createdAt" IS NULL OR ("createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> $1)`,
          [today],
        )
      )[0].n;
      if (old > 0) problems.push(`${t} của tenant DBG có ${old} dòng KHÔNG tạo hôm nay (${today}) — hủy`);
    }
    const oldTenants = (
      await q(
        `SELECT count(*)::int AS n FROM tenants
          WHERE name = 'DBG' AND ("createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> $1`,
        [today],
      )
    )[0].n;
    if (oldTenants > 0) problems.push(`có ${oldTenants} tenant DBG không tạo hôm nay — hủy`);

    const dbgOther = [];
    for (const t of ["orders", "order_items", "inventories", "warehouses", "customers", "invoices", "payments", "company_settings"]) {
      const n = (await q(`SELECT count(*)::int AS n FROM ${t} WHERE "tenantId" IN ${DBG_TENANTS}`))[0].n;
      if (n > 0) dbgOther.push(`${t}=${n}`);
    }
    if (dbgOther.length) problems.push(`tenant DBG còn dữ liệu ở bảng khác: ${dbgOther.join(", ")}`);

    // ── Nhóm C ────────────────────────────────────────────────────────────
    counts.company_settings = (await q(`SELECT count(*)::int AS n FROM company_settings WHERE ${CS_WHERE}`))[0].n;
    const csAll = (await q(`SELECT count(*)::int AS n FROM company_settings WHERE "tenantId" IS NULL`))[0].n;
    if (csAll !== counts.company_settings) {
      problems.push(`còn ${csAll - counts.company_settings} dòng company_settings NULL không khớp mẫu rác — không xoá`);
    }

    // ── Nhóm D ────────────────────────────────────────────────────────────
    const ORPH = orph("c");
    counts.d_warehouses = (await q(`SELECT count(*)::int AS n FROM warehouses c WHERE ${ORPH}`))[0].n;
    counts.d_audit_logs = (await q(`SELECT count(*)::int AS n FROM audit_logs c WHERE ${ORPH}`))[0].n;
    counts.d_products = (await q(`SELECT count(*)::int AS n FROM products c WHERE ${ORPH}`))[0].n;
    counts.d_categories = (await q(`SELECT count(*)::int AS n FROM categories c WHERE ${ORPH}`))[0].n;

    for (const [t, key] of [["warehouses", "d_warehouses"], ["audit_logs", "d_audit_logs"], ["products", "d_products"], ["categories", "d_categories"]]) {
      const ref = await referencedBySurvivingTenant(t, orph(""));
      if (ref) problems.push(`dòng mồ côi ở ${t} bị tenant còn tồn tại tham chiếu (${ref}) — không xoá`);
      if (counts[key] === 0) problems.push(`${t}: không có dòng mồ côi nào, không khớp mô tả nhóm D`);
    }

    // Phép trừ bắt buộc
    const groupD = counts.d_warehouses + counts.d_audit_logs + counts.d_products + counts.d_categories;
    const orphanBefore = (await q(`SELECT count(*)::int AS n FROM audit_logs c WHERE ${ORPH}`))[0].n;
    const orphanTotal = await totalOrphans();
    if (orphanTotal !== ORPHAN_TOTAL_BEFORE) problems.push(`tổng mồ côi-tenant ${orphanTotal} ≠ ${ORPHAN_TOTAL_BEFORE} trước khi dọn`);
    if (ORPHAN_TOTAL_BEFORE - (counts.orders + counts.order_items) !== ORPHAN_GROUP_D_EXPECTED) {
      problems.push(`phép trừ 281 − (${counts.orders}+${counts.order_items}) ≠ ${ORPHAN_GROUP_D_EXPECTED}`);
    }
    if (groupD !== ORPHAN_GROUP_D_EXPECTED) problems.push(`tổng nhóm D ${groupD} ≠ ${ORPHAN_GROUP_D_EXPECTED}`);
    notes.push(["Tổng mồ côi-tenant trước dọn", orphanTotal]);
    notes.push(["Tổng nhóm D", groupD]);
    void orphanBefore;

    // ── Trần audit_logs NULL ──────────────────────────────────────────────
    const auditNull = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE "tenantId" IS NULL`))[0].n;
    if (auditNull > AUDIT_LOGS_NULL_CEILING) problems.push(`audit_logs NULL = ${auditNull} > trần ${AUDIT_LOGS_NULL_CEILING}`);
    notes.push(["audit_logs NULL toàn DB (trước)", auditNull]);

    // ── In số liệu ────────────────────────────────────────────────────────
    console.log("Số dòng dry-run:");
    for (const [k, v] of Object.entries(counts)) {
      console.log(`  ${k.padEnd(20)} ${String(v).padEnd(7)}${EXPECTED[k] === v ? "  ✓" : `  ✗ KỲ VỌNG ${EXPECTED[k]}`}`);
    }
    console.log("");
    for (const [label, val] of notes) console.log(`  ${label}: ${JSON.stringify(val)}`);

    const mismatch = Object.entries(EXPECTED).filter(([k, v]) => counts[k] !== v);
    for (const [k, v] of mismatch) problems.push(`${k}: dry-run ${counts[k]} ≠ kỳ vọng ${v}`);

    if (problems.length) {
      console.log("\nHỦY TOÀN BỘ THAO TÁC:");
      for (const p of problems) console.log(`  - ${p}`);
      await db.query("ROLLBACK");
      return { aborted: true };
    }

    if (!APPLY) {
      console.log("\nDRY-RUN — chưa xoá gì. Thêm --apply để ghi.");
      await db.query("ROLLBACK");
      return { aborted: false };
    }

    // ── Snapshot 2 tenant thật TRƯỚC khi xoá ─────────────────────────────
    const before = await snapshotRealTenants();
    console.log(`\nSnapshot 2 tenant thật TRƯỚC: ${REAL_TENANT_NAMES.join(" + ")}`);

    const del = async (sql) => (await db.query(sql)).rowCount;
    const log = [];

    // Thứ tự phụ thuộc: con -> cha.
    log.push(["order_items (A)", await del(`DELETE FROM order_items WHERE "orderId" IN ${ORPHAN_ORDERS}`)]);
    log.push(["orders (A)", await del(`DELETE FROM orders WHERE id IN ${ORPHAN_ORDERS}`)]);
    log.push(["admin_campaign_recipients (A)", await del(`DELETE FROM admin_campaign_recipients WHERE "userId" IN ${IDS}`)]);

    const camp = await q(`SELECT c.id, c.name FROM admin_campaigns c
      WHERE NOT EXISTS (SELECT 1 FROM admin_campaign_recipients r WHERE r."campaignId" = c.id)`);
    const e2e = camp.filter((c) => /E2E Free User Promo/i.test(c.name));
    if (e2e.length) log.push([`admin_campaigns "${e2e[0].name}"`, await del(`DELETE FROM admin_campaigns WHERE id = '${e2e[0].id}'`)]);
    else log.push(["admin_campaigns (giữ: còn recipient khác)", 0]);

    for (const t of ["refresh_tokens", "notifications", "audit_logs"]) {
      log.push([
        `${t} (A)`,
        await del(
          `DELETE FROM "${t}" WHERE "userId" IN ${IDS} AND ("tenantId" IS NULL OR NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = "${t}"."tenantId"))`,
        ),
      ]);
    }
    log.push(["users (A)", await del(`DELETE FROM users WHERE id IN ${IDS}`)]);

    log.push(["company_settings (C)", await del(`DELETE FROM company_settings WHERE ${CS_WHERE}`)]);

    // Nhóm D — xoá mồ côi-tenant, con trước.
    log.push(["warehouses (D)", await del(`DELETE FROM warehouses c WHERE ${ORPH}`)]);
    log.push(["products (D)", await del(`DELETE FROM products c WHERE ${ORPH}`)]);
    log.push(["categories (D)", await del(`DELETE FROM categories c WHERE ${ORPH}`)]);
    log.push(["audit_logs (D)", await del(`DELETE FROM audit_logs c WHERE ${ORPH}`)]);

    // Nhóm B — con trước cha.
    log.push(["products (B)", await del(`DELETE FROM products WHERE "tenantId" IN ${DBG_TENANTS}`)]);
    log.push(["categories (B)", await del(`DELETE FROM categories WHERE "tenantId" IN ${DBG_TENANTS}`)]);
    log.push(["vendors (B)", await del(`DELETE FROM vendors WHERE "tenantId" IN ${DBG_TENANTS}`)]);
    log.push(["users (B)", await del(`DELETE FROM users WHERE "tenantId" IN ${DBG_TENANTS}`)]);
    log.push(["tenants (B)", await del(`DELETE FROM tenants WHERE id IN ${DBG_TENANTS}`)]);

    console.log("\nĐã xoá:");
    for (const [t, n] of log) console.log(`  ${t.padEnd(40)} ${n}`);

    // ── Snapshot SAU + so sánh ────────────────────────────────────────────
    const after = await snapshotRealTenants();
    const diff = diffSnapshots(before, after);
    console.log("\nSnapshot 2 tenant thật SAU: so với trước");
    if (diff.length === 0) console.log("  GIỐNG HỆT — không bảng nào của tenant thật bị đổi.");
    else {
      console.log("  KHÁC — rollback toàn bộ:");
      for (const d of diff) console.log(`    ${d}`);
      await db.query("ROLLBACK");
      return { aborted: true, snapshotDiff: diff };
    }

    await db.query("COMMIT");
    return { aborted: false, deleted: true, snapshot: before };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("LỖI (đã rollback):", e.message);
    return { aborted: true, error: e };
  } finally {
    await db.end();
  }
};

/** Tổng số dòng mồ côi-tenant trên mọi bảng scoped. */
async function totalOrphans() {
  const tables = (
    await db.query(`
      SELECT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       WHERE c.column_name = 'tenantId' AND tb.table_type = 'BASE TABLE'
         AND c.table_schema = 'public'`)
  ).rows.map((r) => r.t);
  let total = 0;
  for (const t of tables) {
    const n = (
      await db.query(
        `SELECT count(*)::int AS n FROM "${t}" c
          WHERE c."tenantId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = c."tenantId")`,
      )
    ).rows[0].n;
    total += n;
  }
  return total;
}

run().then((r) => process.exit(r.aborted ? 1 : 0));
