/**
 * scripts/check-tenant-null.js - Phat hien `tenantId IS NULL` tren DB dang chay
 *
 * VI SAO CO SCRIPT NAY
 * Hotfix `prisma.js` chan ghi long tao `tenantId = NULL`, nhung du lieu NULL da
 * ton tai tu truoc van con. Mot lan quet theo lo chua du de con so sanh
 * (xem `docs/aisc26/runbook-tenant-null.md`); can mot hang rao chay MOI LAN
 * de loi quay lai khong bi bo qua.
 *
 * KHONG tu sua du lieu. Script nay chi doc va bao.
 *
 * Chay: node scripts/check-tenant-null.js
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("check-tenant-null");

const prisma = require("../src/config/prisma");

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " -> " + extra : ""}`);
  if (cond) pass += 1;
  else fail += 1;
};

/**
 * Cac bang duoc phep con NULL.
 *
 * - `users`: `SUPER_OMEGA_ULTRA_ADMIN` co tinh khong thuoc tenant nao (no vong
 *   qua co ly tenant), nen NULL la hop le. Cac dong NULL khac deu la rac du
 *   lieu de nguoi xu ly - script bao nhung khong fail.
 * - `company_settings`: bang 1-1 theo tenant, khong co khoa ngoai suy duoc.
 *
 * Hai bang nay KHONG dua vao danh sach "duoc phep" o duoi; chi duoc dan vao
 * danh sach "can nguoi xem" de fail khong lang am thanh.
 */
const HUMAN_REVIEW_TABLES = new Set(["users", "company_settings"]);

(async () => {
  console.log("\n=== QUET tenantId IS NULL tren DB hien tai (chi doc) ===\n");

  const tables = await prisma.$queryRawUnsafe(`
    SELECT c.table_schema AS schema, c.table_name AS table
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.column_name = 'tenantId'
       AND t.table_type = 'BASE TABLE'
       AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY c.table_name`);

  const withNull = [];
  for (const t of tables) {
    const res = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${t.schema}"."${t.table}" WHERE "tenantId" IS NULL`,
    );
    if (res[0].n > 0) withNull.push({ table: t.table, n: res[0].n });
  }

  // Cac bang duoc xem la "sach" neu khong con NULL o bat ky bang nao khac.
  const unexpected = withNull.filter((r) => !HUMAN_REVIEW_TABLES.has(r.table));

  ok(
    "KHONG co bang nao ngoai danh sach 'can nguoi xem' bi NULL tenantId",
    unexpected.length === 0,
    unexpected.map((r) => `${r.table}=${r.n}`).join(", "),
  );

  for (const r of withNull) {
    const tag = HUMAN_REVIEW_TABLES.has(r.table) ? "[can nguoi xem]" : "[LOI]";
    console.log(`     ${tag} ${r.table}: ${r.n} dong`);
  }

  if (withNull.length > 0) {
    console.log(
      "\n     -> Chay `node scripts/tenant-null.js --backfill` de xem ke hoach va\n" +
        "        `node scripts/tenant-null.js --backfill --apply` de va (chi DB local).\n" +
        "        Runbook cho moi truong: docs/aisc26/runbook-tenant-null.md",
    );
  }

  console.log(`\n=== ${fail === 0 ? "TAT CA PASS" : "CO FAIL"} (${pass} pass / ${fail} fail) ===`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("LOI:", e.message);
  try {
    await prisma.$disconnect();
  } catch {
    /* bo qua */
  }
  process.exit(1);
});
