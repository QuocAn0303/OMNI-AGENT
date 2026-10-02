/**
 * docs/aisc26/one-off/cleanup-dev-residue.js — DỌN RÁC KIỂM THỬ TRÊN DB PHÁT TRIỂN
 *
 * DÙNG MỘT LẦN (Mốc 8). Chỉ áp dụng cho DB local.
 *
 * BA NHÓM ĐƯỢC PHÉP XOÁ (danh sách tường minh, ngoài danh sách thì HỦY):
 *
 *   A. 9 user kiểm thử + dữ liệu kéo theo
 *      - users: e2e_test_%@example.com | smoke-%@test.local, tenantId NULL,
 *        role <> SUPER_OMEGA_ULTRA_ADMIN  → đúng 9 (4 e2e + 5 smoke)
 *      - orders của 9 user đó, CHỈ khi tenantId KHÔNG tồn tại trong `tenants`
 *        và không có payments                → đúng 86
 *      - order_items của các đơn đó                              → đúng 84
 *      - admin_campaign_recipients của 9 user                    → đúng 9
 *      - refresh_tokens / notifications / audit_logs tenantId NULL của 9 user
 *      - chiến dịch "E2E Free User Promo" nếu không còn recipient nào khác
 *
 *   B. 8 tenant DBG do script debug tạo nhầm
 *      - tenants có tên 'DBG'                  → đúng 8
 *      - users + products của 8 tenant đó      → đúng 3 + 3
 *
 *   C. 38 company_settings NULL do test E2E
 *      - tenantId NULL, name LIKE 'E2E Test %', và MỌI cột khác `name`
 *        phải bằng đúng giá trị mặc định của schema → đúng 38
 *
 * DÙNG
 *   node docs/aisc26/one-off/cleanup-dev-residue.js            # dry-run
 *   node docs/aisc26/one-off/cleanup-dev-residue.js --apply    # ghi thật
 *
 * `--apply` CHỈ chạy khi số dòng dry-run khớp ĐÚNG số kỳ vọng ở trên; lệch bất
 * kỳ số nào thì hủy toàn bộ, không xoá gì.
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

const IDS = `(SELECT id FROM users
  WHERE "tenantId" IS NULL AND role::text <> 'SUPER_OMEGA_ULTRA_ADMIN'
    AND (email LIKE 'e2e\\_test\\_%@example.com' OR email LIKE 'smoke-%@test.local'))`;
const ORPHAN_ORDERS = `(SELECT id FROM orders o
  WHERE o."createdById" IN ${IDS}
    AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = o."tenantId")
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id))`;
const DBG_TENANTS = `(SELECT id FROM tenants WHERE name = 'DBG')`;

/** Số kỳ vọng đã báo ở Mốc 8. Lệch bất kỳ số nào ⇒ hủy. */
const EXPECTED = {
  users: 9,
  orders: 86,
  order_items: 84,
  campaign_recipients: 9,
  dbg_tenants: 8,
  dbg_users: 3,
  dbg_products: 3,
  company_settings: 38,
};

/**
 * ĐO THỰC TẾ TRÊN DB LOCAL (ngày 2026-10-02) — KHÁC với `EXPECTED`.
 *
 *   dbg_tenants: 7 (không phải 8)  → tôi đếm sai ở Mốc 8.
 *   ngoài ra còn 4 `categories` và 5 `vendors` trong các tenant DBG, vốn chưa
 *   được báo ở Mốc 8. Đội Mốc 8 chỉ cho phép "đúng 8 tenant + 3 user + 3
 *   product; có thêm dữ liệu liên quan nào khác thì hủy và báo" ⇒ đã hủy đúng
 *   theo luật, và chờ đội cấp lại số liệu.
 *
 * Giữ nguyên `EXPECTED` ở trên (tức là giữ trạng thái CHẶN) cho tới khi đội
 * xác nhận lại. Sửa số ở đây chính là chỗ cần đội ký, đừng tự đổi.
 */
const VERIFIED_ON_LOCAL_DB = {
  dbg_tenants: 7,
  dbg_users: 3,
  dbg_products: 3,
  dbg_categories: 4,
  dbg_vendors: 5,
};

/** Bảng có thể xoá kèm, kèm cột tham chiếu. */
const TENANT_SIDE_ALLOWED = new Set(["refresh_tokens", "notifications", "audit_logs"]);

const run = async () => {
  console.log(`\n=== DỌN RÁC KIỂM THỬ (${APPLY ? "--apply: GHI THẬT" : "dry-run"}) ===\n`);
  await db.connect();
  const problems = [];
  const counts = {};
  const q = async (sql) => (await db.query(sql)).rows;

  try {
    await db.query("BEGIN");

    // ── A. user + dữ liệu kéo theo ────────────────────────────────────────
    const users = await q(`SELECT count(*)::int AS n FROM users WHERE id IN ${IDS}`);
    counts.users = users[0].n;
    const byPat = await q(`
      SELECT count(*) FILTER (WHERE email LIKE 'e2e\\_test\\_%@example.com')::int AS e2e,
             count(*) FILTER (WHERE email LIKE 'smoke-%@test.local')::int AS smoke
        FROM users WHERE id IN ${IDS}`);
    if (byPat[0].e2e !== 4 || byPat[0].smoke !== 5) {
      problems.push(`phân bố e2e/smoke = ${byPat[0].e2e}/${byPat[0].smoke}, dự kiến 4/5`);
    }

    const orders = await q(`SELECT count(*)::int AS n FROM orders WHERE id IN ${ORPHAN_ORDERS}`);
    counts.orders = orders[0].n;

    // Đơn của 9 user mà tenant CÒN TỒN TẠI hoặc có payments ⇒ hủy.
    const riskyOrders = await q(`
      SELECT count(*)::int AS n FROM orders
       WHERE "createdById" IN ${IDS} AND id NOT IN ${ORPHAN_ORDERS}`);
    if (riskyOrders[0].n > 0) {
      problems.push(`có ${riskyOrders[0].n} đơn của user rác mà tenant còn tồn tại hoặc có payments — không xoá`);
    }

    const items = await q(`SELECT count(*)::int AS n FROM order_items WHERE "orderId" IN ${ORPHAN_ORDERS}`);
    counts.order_items = items[0].n;

    const recip = await q(
      `SELECT count(*)::int AS n FROM admin_campaign_recipients WHERE "userId" IN ${IDS}`,
    );
    counts.campaign_recipients = recip[0].n;

    // Các bảng khác tham chiếu tới 9 user mà chưa nằm trong danh sách cho phép.
    const refs = await q(`
      SELECT tc.table_name AS t, kcu.column_name AS c
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'users' AND tc.table_schema = 'public'`);
    const refCounts = {};
    for (const r of refs) {
      const n = await q(
        `SELECT count(*)::int AS n FROM "${r.t}" WHERE "${r.c}" IN ${IDS}`,
      );
      if (n[0].n > 0) {
        refCounts[r.t] = n[0].n;
        if (!TENANT_SIDE_ALLOWED.has(r.t) && r.t !== "admin_campaign_recipients" && r.t !== "orders") {
          problems.push(`bảng "${r.t}" tham chiếu user rác ${n[0].n} dòng nhưng không nằm trong danh sách cho phép`);
        }
      }
    }

    // ── B. tenant DBG ──────────────────────────────────────────────────────
    const dbgT = await q(`SELECT count(*)::int AS n FROM tenants WHERE id IN ${DBG_TENANTS}`);
    counts.dbg_tenants = dbgT[0].n;
    const dbgU = await q(`SELECT count(*)::int AS n FROM users WHERE "tenantId" IN ${DBG_TENANTS}`);
    counts.dbg_users = dbgU[0].n;
    const dbgP = await q(`SELECT count(*)::int AS n FROM products WHERE "tenantId" IN ${DBG_TENANTS}`);
    counts.dbg_products = dbgP[0].n;
    const dbgC = await q(`SELECT count(*)::int AS n FROM categories WHERE "tenantId" IN ${DBG_TENANTS}`);
    counts.dbg_categories = dbgC[0].n;
    const dbgV = await q(`SELECT count(*)::int AS n FROM vendors WHERE "tenantId" IN ${DBG_TENANTS}`);
    counts.dbg_vendors = dbgV[0].n;

    const dbgOther = [];
    for (const t of [
      "orders", "order_items", "inventories", "categories", "customers", "vendors",
      "invoices", "payments", "audit_logs", "journal_entries", "warehouses", "company_settings",
    ]) {
      const n = await q(`SELECT count(*)::int AS n FROM ${t} WHERE "tenantId" IN ${DBG_TENANTS}`);
      if (n[0].n > 0) dbgOther.push(`${t}=${n[0].n}`);
    }
    if (dbgOther.length) problems.push(`tenant DBG còn dữ liệu ở bảng khác: ${dbgOther.join(", ")}`);

    // ── C. company_settings NULL ───────────────────────────────────────────
    const csWhere = `
      "tenantId" IS NULL
      AND name LIKE 'E2E Test %'
      AND address IS NULL AND phone IS NULL AND email IS NULL AND "taxCode" IS NULL
      AND logo IS NULL AND industry IS NULL AND currency = 'VND'
      AND "onboardingDone" = false AND "onboardingStep" = 0
      AND "businessTemplate" IS NULL AND "demoSeeded" = false
      AND "accountingMode"::text = 'FULL_VAS'
      AND "poApprovalThreshold" IS NULL AND "leadRoundRobinCursor" = 0
      AND "beginnerMode" = true`;
    const cs = await q(`SELECT count(*)::int AS n FROM company_settings WHERE ${csWhere}`);
    counts.company_settings = cs[0].n;
    const csAll = await q(`SELECT count(*)::int AS n FROM company_settings WHERE "tenantId" IS NULL`);
    if (csAll[0].n !== counts.company_settings) {
      problems.push(
        `còn ${csAll[0].n - counts.company_settings} dòng company_settings NULL không khớp mẫu rác — không xoá`,
      );
    }

    console.log("Số dòng dry-run (đối chiếu số kỳ vọng ở trên):");
    for (const [k, v] of Object.entries(counts)) {
      const exp = EXPECTED[k];
      const okMark = exp === undefined ? "  (không đặt kỳ vọng)" : exp === v ? "  ✓" : `  ✗ KỲ VỌNG ${exp}`;
      console.log(`  ${k.padEnd(20)} ${String(v).padEnd(7)}${okMark}`);
    }
    if (Object.keys(refCounts).length) {
      console.log("\nDòng phụ thuộc của 9 user (sẽ xoá kèm):");
      for (const [t, n] of Object.entries(refCounts)) console.log(`  ${t.padEnd(30)} ${n}`);
    }

    const mismatch = Object.entries(EXPECTED).filter(([k, v]) => counts[k] !== v);
    if (mismatch.length) {
      for (const [k, v] of mismatch) problems.push(`${k}: dry-run ${counts[k]} ≠ kỳ vọng ${v}`);
    }
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

    // ── Xoá theo thứ tự phụ thuộc ─────────────────────────────────────────
    const del = async (sql) => (await db.query(sql)).rowCount;
    const log = [];

    log.push(["order_items (A)", await del(`DELETE FROM order_items WHERE "orderId" IN ${ORPHAN_ORDERS}`)]);
    log.push(["orders (A)", await del(`DELETE FROM orders WHERE id IN ${ORPHAN_ORDERS}`)]);

    log.push(["admin_campaign_recipients (A)", await del(`DELETE FROM admin_campaign_recipients WHERE "userId" IN ${IDS}`)]);
    // Chiến dịch E2E Free User Promo chỉ xoá nếu không còn recipient nào khác.
    const camp = await q(
      `SELECT c.id, c.name FROM admin_campaigns c
        WHERE NOT EXISTS (SELECT 1 FROM admin_campaign_recipients r WHERE r."campaignId" = c.id)`,
    );
    const e2eCamp = camp.filter((c) => /E2E Free User Promo/i.test(c.name));
    if (e2eCamp.length) {
      log.push([`admin_campaigns "${e2eCamp[0].name}"`, await del(`DELETE FROM admin_campaigns WHERE id = '${e2eCamp[0].id}'`)]);
    } else {
      log.push(["admin_campaigns (không xoá: còn recipient khác)", 0]);
    }

    for (const t of ["refresh_tokens", "notifications", "audit_logs"]) {
      log.push([`${t} (A)`, await del(`DELETE FROM "${t}" WHERE "userId" IN ${IDS} AND "tenantId" IS NULL`)]);
    }
    log.push(["users (A)", await del(`DELETE FROM users WHERE id IN ${IDS}`)]);

    log.push(["company_settings (C)", await del(`DELETE FROM company_settings WHERE ${csWhere}`)]);

    log.push(["products (B)", await del(`DELETE FROM products WHERE "tenantId" IN ${DBG_TENANTS}`)]);
    log.push(["users (B)", await del(`DELETE FROM users WHERE "tenantId" IN ${DBG_TENANTS}`)]);
    log.push(["tenants (B)", await del(`DELETE FROM tenants WHERE id IN ${DBG_TENANTS}`)]);

    console.log("\nĐã xoá:");
    for (const [t, n] of log) console.log(`  ${t.padEnd(42)} ${n}`);

    await db.query("COMMIT");
    return { aborted: false, deleted: true };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("LỖI (đã rollback):", e.message);
    return { aborted: true, error: e };
  } finally {
    await db.end();
  }
};

run().then((r) => process.exit(r.aborted ? 1 : 0));
