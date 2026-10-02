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
 * Bảng 1-1 theo tenant — mỗi tenant đúng MỘT dòng. Liệt kê tường minh kèm
 * lý do; đo bằng tỉ lệ số dòng chính là thứ đã giấu bug 36 dòng settings.
 */
const ONE_TO_ONE_TABLES = new Set(["company_settings"]);

/**
 * Ngoại lệ TƯỜNG MINH có điều kiện + trần — xem `scripts/lib/tenant-null-exceptions.js`.
 * Dùng ngoại lệ thay vì danh sách "bảng nào được phép NULL", vì danh sách bảng
 * biến một sự cố thành quy tắc vĩnh viễn và không phát hiện được lỗi mới.
 */
const { classifyNullRows } = require("./lib/tenant-null-exceptions");

(async () => {
  console.log("\n=== QUET CHAT LUONG tenantId tren DB hien tai (chi doc) ===\n");

  const tables = await prisma.$queryRawUnsafe(`
    SELECT c.table_schema AS schema, c.table_name AS table
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.column_name = 'tenantId'
       AND t.table_type = 'BASE TABLE'
       AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY c.table_name`);

  const rows = [];
  for (const t of tables) {
    const n = (
      await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${t.schema}"."${t.table}" WHERE "tenantId" IS NULL`,
      )
    )[0].n;
    const orphan = (
      await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${t.schema}"."${t.table}" c
          WHERE c."tenantId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = c."tenantId")`,
      )
    )[0].n;
    const dup = ONE_TO_ONE_TABLES.has(t.table)
      ? (
          await prisma.$queryRawUnsafe(
            `SELECT count(*)::int AS n FROM (
                SELECT "tenantId" FROM "${t.schema}"."${t.table}"
                 WHERE "tenantId" IS NOT NULL GROUP BY "tenantId" HAVING count(*) > 1) d`,
          )
        )[0].n
      : 0;
    if (n > 0 || orphan > 0 || dup > 0) {
      const cls = await classifyNullRows(prisma, t.schema, t.table, n);
      rows.push({ table: t.table, n, orphan, dup, covered: cls.covered, overCap: cls.overCap, ex: cls.exception });
    }
  }

  // Dòng NULL chưa được ngoại lệ bao phủ ⇒ LỖI thật.
  const errors = rows.filter((r) => r.n - r.covered > 0);
  // Ngoại lệ vượt trần = dữ liệu MỚI sinh, không phải ngoại lệ cũ ⇒ báo động.
  const overCaps = rows.filter((r) => r.overCap > 0);
  const orphans = rows.filter((r) => r.orphan > 0);
  const dups = rows.filter((r) => r.dup > 0);

  for (const r of rows) {
    const g = r.dup > 0
      ? "TRUNG 1-1"
      : r.orphan > 0
        ? "MO COI-TENANT"
        : r.n - r.covered === 0
          ? r.n > 0
            ? "CO Y (ngoai le)"
            : "DA XU LY"
          : "LOI";
    console.log(
      `     [${g}] ${r.table}: NULL=${r.n} ngoaiLe=${r.covered}/${r.ex ? r.ex.cap : 0} ` +
        `vuotTran=${r.overCap} mo-coi=${r.orphan} trung=${r.dup}`,
    );
  }

  ok(
    "LOI: khong co dong NULL tenantId nao CHUA duoc ngoai le bao phu",
    errors.length === 0,
    errors.map((r) => `${r.table}=${r.n - r.covered}`).join(", "),
  );
  ok("NGOAI LE khong vuot tran da ghi", overCaps.length === 0, overCaps.map((r) => `${r.table}=+${r.overCap}`).join(", "));
  ok("TRUNG 1-1: moi tenant chi co MOT dong o bang 1-1", dups.length === 0, dups.map((r) => `${r.table}=${r.dup} tenant`).join(", "));

  const orphanTotal = orphans.reduce((s, r) => s + r.orphan, 0);
  ok("MO COI-TENANT: bao cao so dong (khong fail)", true, `${orphanTotal} dong o ${orphans.length} bang`);

  if (errors.length || dups.length) {
    console.log(
      "\n     -> Backfill: node scripts/tenant-null.js --backfill (dry-run mac dinh)\n" +
        "        Runbook moi truong: docs/aisc26/runbook-tenant-null.md",
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
