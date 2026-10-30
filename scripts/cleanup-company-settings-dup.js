/**
 * scripts/cleanup-company-settings-dup.js — DỌN DÒNG company_settings TRÙNG 1-1
 *
 * Bối cảnh (đo trên DB phát triển): tenant demo `CANDORY SCENT` có 36 dòng
 * `company_settings` cho một tenant thiết kế 1-1. 35 dòng tên
 * `E2E Test <timestamp>` là rác kiểm thử; dòng còn lại (tạo 02/06) là dòng gốc
 * và CŨNG LÀ dòng mà `findFirst()` không `orderBy` đang trả về ⇒ giữ nó thì
 * hành vi không đổi.
 *
 * Đã làm trước khi xoá: `pg_dump` ngoài repo + xuất 35 dòng ra file JSON.
 *
 * Điều kiện hủy (sai bất kỳ điều nào ⇒ rollback toàn bộ):
 *   - tổng số dòng không phải 36
 *   - số dòng tên `E2E Test <timestamp>` không phải 35
 *   - dòng giữ lại cũng tên `E2E Test` (không biết dòng nào đúng)
 *   - snapshot các tenant thật trước/sau lệch
 *
 * Dùng `slug` (ASCII) thay cho `name`: so khớp tên tiếng Việt dễ hỏng do khác
 * biệt encoding giữa PowerShell và Node.
 *
 * Dùng: node scripts/cleanup-company-settings-dup.js [--apply]
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("cleanup-company-settings-dup");

const { Client } = require("pg");
const APPLY = process.argv.includes("--apply");
const EXPECT_TOTAL = 36;
const EXPECT_E2E = 35;
const REAL_TENANT_SLUGS = ["candory-scent", "a-u"];

const u = new URL(process.env.DATABASE_URL || "");
const db = new Client({
  host: u.hostname,
  port: parseInt(u.port || "5432", 10),
  database: u.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
});

const scopedTables = async () =>
  (
    await db.query(`
      SELECT DISTINCT c.table_name AS t FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       WHERE c.column_name = 'tenantId' AND tb.table_type = 'BASE TABLE'
         AND c.table_schema = 'public' ORDER BY 1`)
  ).rows.map((r) => r.t);

/**
 * Số dòng theo bảng cho các tenant thật.
 *
 * `EXCLUDE` là bảng CHÍNH ĐỊNH sửa trong việc này: so sánh nó trước/sau sẽ luôn
 * lệch và chặn oan. Việc của nó được báo riêng bên dưới, không gộp vào so sánh.
 */
const EXCLUDE = new Set(["company_settings"]);
const snapshot = async (ids) => {
  const tables = await scopedTables();
  const snap = {};
  for (const t of tables) {
    if (EXCLUDE.has(t)) continue;
    const r = await db.query(`SELECT count(*)::int AS n FROM "${t}" WHERE "tenantId" = ANY($1::text[])`, [ids]);
    snap[t] = r.rows[0].n;
  }
  return snap;
};

const main = async () => {
  console.log(`\n=== DON company_settings TRUNG (${APPLY ? "--apply" : "dry-run"}) ===`);
  const problems = [];
  await db.connect();

  try {
    const all = (await db.query(`SELECT id, name, slug FROM tenants`)).rows;
    const real = all.filter((t) => REAL_TENANT_SLUGS.includes(t.slug));
    if (real.length !== REAL_TENANT_SLUGS.length) {
      problems.push(`thieu tenant that: can ${REAL_TENANT_SLUGS.length}, co ${real.length}`);
    }
    const cand = all.find((t) => t.slug === "candory-scent");
    if (!cand) {
      console.log("HUY: khong tim thay tenant slug candory-scent.");
      await db.end();
      process.exit(1);
    }

    const rows = (
      await db.query(`SELECT id, name, "createdAt" FROM company_settings WHERE "tenantId" = $1 ORDER BY "createdAt" ASC`, [cand.id])
    ).rows;

    if (rows.length !== EXPECT_TOTAL) problems.push(`tong dong ${rows.length} != ${EXPECT_TOTAL}`);
    const canonical = rows[0];
    const trash = rows.slice(1);
    const isE2e = trash.filter((r) => /^E2E Test \d+$/.test(r.name));
    if (isE2e.length !== EXPECT_E2E) problems.push(`dong ten "E2E Test <ts>" = ${isE2e.length} != ${EXPECT_E2E}`);
    if (canonical && /^E2E Test/.test(canonical.name)) {
      problems.push("dong giu lai cung la rac E2E - khong biet dong nao dung");
    }

    console.log(`tenant: ${cand.name} (${cand.id.slice(0, 8)})`);
    if (canonical) console.log(`giu: "${canonical.name}" tao luc ${String(canonical.createdAt).slice(0, 19)}`);
    console.log(`xoa: ${trash.length} dong`);
    console.log(`tat ca dong xoa deu ten "E2E Test <timestamp>": ${trash.length > 0 && trash.every((r) => /^E2E Test \d+$/.test(r.name))}`);

    if (problems.length) {
      console.log("\nHUY TOAN BO:");
      for (const p of problems) console.log(`  - ${p}`);
      await db.end();
      process.exit(1);
    }

    if (!APPLY) {
      console.log("\nDRY-RUN - chua xoa gi.");
      await db.end();
      return;
    }

    const ids = real.map((t) => t.id);
    await db.query("BEGIN");
    const before = await snapshot(ids);
    const csBefore = (
      await db.query(`SELECT count(*)::int AS n FROM company_settings WHERE "tenantId" = ANY($1::text[])`, [ids])
    ).rows[0].n;
    const del = await db.query(
      `DELETE FROM company_settings WHERE "tenantId" = $1 AND name LIKE 'E2E Test %' AND id <> $2`,
      [cand.id, canonical.id],
    );
    const csAfter = (
      await db.query(`SELECT count(*)::int AS n FROM company_settings WHERE "tenantId" = ANY($1::text[])`, [ids])
    ).rows[0].n;
    const after = await snapshot(ids);
    const diff = Object.keys(after).filter((k) => after[k] !== before[k]);
    console.log(`\nda xoa ${del.rowCount} dong`);
    console.log(
      `company_settings cua ${real.length} tenant that: ${csBefore} -> ${csAfter} ` +
        "(bang duoc phep sua, bao rieng)",
    );
    console.log(`snapshot cac bang KHAC: ${diff.length === 0 ? "GIONG HET" : "LECH: " + diff.join(", ")}`);
    if (diff.length) throw new Error(`snapshot lech: ${diff.join(", ")} - rollback toan bo`);
    await db.query("COMMIT");
    console.log("\nXong.");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("LOI (da rollback):", e.message);
    await db.end();
    process.exit(1);
  }
  await db.end();
};

main();
