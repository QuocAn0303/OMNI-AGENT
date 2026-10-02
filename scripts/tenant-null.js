/**
 * scripts/tenant-null.js — Quét và vá lỗi `tenantId` (NULL / MỒ CÔI / TRÙNG)
 *
 * BỐI CẢNH
 * Prisma extension chỉ gắn `tenantId` vào `data` cấp ngoài cùng. Với
 * `order.create({ data: { items: { create: [...] } } })` thì dòng `OrderItem`
 * sinh ra có `tenantId = NULL`, trong khi MỌI truy vấn đọc đều lọc `tenantId`
 * ⇒ dữ liệu đó vô hình với tenant của chính nó.
 *
 * MỐC 8 — BỔ SUNG HAI LOẠI PHÁT HIỆN
 *   1. MỒ CÔI-TENANT: hàng có `tenantId` KHÔNG tồn tại trong `tenants`.
 *      Cùng lớp lỗi với `orders.tenantId` không có khoá ngoại tới `tenants`.
 *   2. TRÙNG 1-1: tenant có nhiều hơn một dòng ở bảng thiết kế 1-1.
 *
 * MỐC 8 — SỬA LỖI CỦA CHÍNH `--backfill`
 *   Bản trước gán `tenantId` của bảng cha **kể cả khi tenant đó không tồn tại**,
 *   biến 270 dòng rác thành "đã vá" với một `tenantId` chết. Nay chỉ vá khi
 *   tenant của cha CÓ THẬT trong bảng `tenants`.
 *
 * NHÓM PHÂN LOẠI (kết quả in ra)
 *   LỖI            NULL ở bảng có bảng cha xác định được — phải bằng 0
 *   CỐ Ý           NULL là chủ ý (tài khoản cấp nền tảng) — không FAIL
 *   ĐÃ XỬ LÝ       không còn NULL
 *   MỒ CÔI-TENANT  tenantId có giá trị nhưng tenant không tồn tại — báo số
 *   TRÙNG 1-1       tenant có >1 dòng ở bảng 1-1 — phải bằng 0
 *
 * CÁCH DÙNG
 *   node scripts/tenant-null.js --scan                  # chỉ đọc (mặc định)
 *   node scripts/tenant-null.js --scan --allow-remote   # chỉ đọc, DB xa
 *   node scripts/tenant-null.js --backfill              # DRY-RUN: in câu UPDATE
 *   node scripts/tenant-null.js --backfill --apply      # GHI THẬT (chỉ DB local)
 *
 * NGUYÊN TẮC
 *   1. `--scan` chỉ đọc, transaction `READ ONLY`.
 *   2. `--backfill` mặc định dry-run; phải có `--apply` mới ghi.
 *   3. `--apply` từ chối chạy nếu DB không phải máy cục bộ.
 *   4. KHÔNG đoán: chỉ vá khi suy ra duy nhất một `tenantId` VÀ tenant đó tồn tại.
 *   5. Idempotent.
 */

require("dotenv").config();

const { parseHost, LOCAL_HOSTNAMES } = require("./lib/assert-local-db");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const MODE_BACKFILL = has("--backfill");
const MODE_SCAN = has("--scan") || !MODE_BACKFILL;
const APPLY = has("--apply");

if (MODE_SCAN && MODE_BACKFILL) {
  console.error("[tenant-null] chi chon mot che do: --scan hoac --backfill.");
  process.exit(2);
}

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const url = new URL(process.env.DATABASE_URL || "");
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432", 10),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const dbLabel = `${parseHost(process.env.DATABASE_URL)}${url.username ? " (đã che thông tin đăng nhập)" : ""}`;
const isLocalDb = () => {
  const host = parseHost(process.env.DATABASE_URL || "");
  return LOCAL_HOSTNAMES.has(host) || Boolean(host && host.endsWith(".local"));
};

const qt = (schema, table) => `"${schema}"."${table}"`;
const key = (schema, table) => `${schema}.${table}`;

/**
 * Bảng 1-1 theo tenant: mỗi tenant đúng MỘT dòng.
 *
 * Liệt kê tường minh kèm lý do, KHÔNG đoán bằng tỉ lệ số dòng — cách đo đó
 * chính là thứ đã giấu bug 36 dòng `company_settings` của CANDORY SCENT.
 * Mỗi bảng thêm vào đây đều phải kèm lý do thiết kế 1-1.
 */
const ONE_TO_ONE_TABLES = new Set([
  // Mỗi tenant có đúng một bộ cài đặt công ty. Bảng này KHÔNG có khoá ngoại
  // tới `tenants` (xem báo cáo Mốc 8) — chính vì vậy trùng dòng không bị chặn.
  "company_settings",
]);

/** Bảng được phép có NULL vì lý do CHỦ Ý (không tính là LỖI). */
const INTENTIONAL_NULL = new Set([
  // `SUPER_OMEGA_ULTRA_ADMIN` cố ý không thuộc tenant nào (đi vòng qua cách ly
  // tenant). Vì vậy `users.tenantId` KHÔNG được ép NOT NULL ở Vòng 2.
  "users",
]);

// ── Thu thập metadata ────────────────────────────────────────────────────────

const listTenantTables = (client) =>
  client.$queryRawUnsafe(`
    SELECT c.table_schema AS schema, c.table_name AS table
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.column_name = 'tenantId'
       AND t.table_type = 'BASE TABLE'
       AND c.table_schema NOT IN ('pg_catalog','information_schema')
     ORDER BY c.table_schema, c.table_name`);

const listPrimaryKeys = (client) =>
  client.$queryRawUnsafe(`
    SELECT tc.table_schema AS schema, tc.table_name AS table, kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema NOT IN ('pg_catalog','information_schema')`);

const listForeignKeys = (client) =>
  client.$queryRawUnsafe(`
    SELECT tc.table_schema   AS child_schema,
           tc.table_name    AS child_table,
           kcu.column_name  AS child_column,
           ccu.table_schema AS parent_schema,
           ccu.table_name  AS parent_table,
           ccu.column_name AS parent_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema NOT IN ('pg_catalog','information_schema')`);

const loadContext = async (client) => {
  const tables = await listTenantTables(client);
  const fks = await listForeignKeys(client);
  const pks = await listPrimaryKeys(client);

  const tenantTables = new Set(tables.map((t) => key(t.schema, t.table)));
  const pkColumns = new Map();
  for (const pk of pks) {
    const k = key(pk.schema, pk.table);
    pkColumns.set(k, [...(pkColumns.get(k) || []), pk.column]);
  }
  const tenants = await client.$queryRawUnsafe(`SELECT id FROM tenants`);
  return { tables, fks, pkColumns, tenantTables, tenantIds: new Set(tenants.map((t) => t.id)) };
};

// ── Phân tích ────────────────────────────────────────────────────────────────

const planFor = (table, ctx) => {
  const pkColumns = ctx.pkColumns.get(key(table.schema, table.table)) || [];

  if (pkColumns.includes("tenantId")) {
    return { strategy: "none", parents: [], reason: '"tenantId" là một phần của khoá chính của chính bảng này' };
  }

  const childFks = ctx.fks.filter((fk) => fk.child_schema === table.schema && fk.child_table === table.table);
  const tenantPointing = childFks.filter((fk) => fk.child_column === "tenantId");
  const candidates = childFks.filter(
    (fk) =>
      fk.child_column !== "tenantId" &&
      !(fk.parent_schema === table.schema && fk.parent_table === table.table),
  );
  const parents = candidates.filter((fk) => ctx.tenantTables.has(key(fk.parent_schema, fk.parent_table)));

  if (parents.length === 0) {
    const reason = tenantPointing.length
      ? `"tenantId" là khóa ngoại trỏ tới ${tenantPointing[0].parent_table} (bảng cha không mang tenantId), nên không có nguồn để suy`
      : "không có khóa ngoại nào trỏ tới bảng có cột tenantId";
    return { strategy: "none", parents: [], reason };
  }
  if (pkColumns.length !== 1) {
    return { strategy: "none", parents: [], reason: `khóa chính gồm ${pkColumns.length} cột, không ghép được` };
  }
  return parents.length === 1
    ? { strategy: "single", parents, pk: pkColumns[0] }
    : { strategy: "agree", parents, pk: pkColumns[0] };
};

const countNull = async (client, table) => {
  const r = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${qt(table.schema, table.table)} WHERE "tenantId" IS NULL`,
  );
  return r[0].n;
};

/** tenantId có giá trị nhưng tenant KHÔNG tồn tại. */
const countOrphan = async (client, table) => {
  const r = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${qt(table.schema, table.table)} c
      WHERE c."tenantId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = c."tenantId")`,
  );
  return r[0].n;
};

/** Tenant nào có nhiều hơn một dòng ở bảng 1-1. */
const countDuplicates = async (client, table) => {
  const r = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM (
        SELECT "tenantId" FROM ${qt(table.schema, table.table)}
         WHERE "tenantId" IS NOT NULL
         GROUP BY "tenantId" HAVING count(*) > 1) d`,
  );
  return r[0].n;
};

/** Bảng scoped nào KHÔNG có khoá ngoại nào trỏ tới `tenants`. */
const tablesWithoutTenantFk = (ctx) =>
  ctx.tables.filter(
    (t) =>
      !ctx.fks.some(
        (fk) => fk.child_schema === t.schema && fk.child_table === t.table && fk.parent_table === "tenants",
      ),
  );

const analyse = async (client) => {
  const ctx = await loadContext(client);
  const rows = [];
  for (const t of ctx.tables) {
    const name = t.table;
    rows.push({
      ...t,
      table: name,
      nullCount: await countNull(client, t),
      orphanCount: await countOrphan(client, t),
      dupCount: ONE_TO_ONE_TABLES.has(name) ? await countDuplicates(client, t) : 0,
      ...planFor(t, ctx),
    });
  }
  return { rows, ctx };
};

// ── SQL backfill (chỉ vá khi tenant CÓ THẬT) ─────────────────────────────────

/** Điều kiện tenant của cha phải tồn tại — chống "vá" bằng tenant đã xoá. */
const EXISTS_TENANT = (alias) => `EXISTS (SELECT 1 FROM tenants _t WHERE _t.id = ${alias}."tenantId")`;

const sqlSingle = (row, parent) =>
  `UPDATE ${qt(row.schema, row.table)} c\n` +
  `   SET "tenantId" = p."tenantId"\n` +
  `  FROM ${qt(parent.parent_schema, parent.parent_table)} p\n` +
  ` WHERE p."${parent.parent_column}" = c."${parent.child_column}"\n` +
  `   AND c."tenantId" IS NULL\n` +
  `   AND p."tenantId" IS NOT NULL\n` +
  `   AND ${EXISTS_TENANT("p")}`;

const sourceSql = (row) => {
  const parts = row.parents.map(
    (p) =>
      `      SELECT c."${row.pk}" AS pk, pp."tenantId" AS v\n` +
      `        FROM ${qt(row.schema, row.table)} c\n` +
      `        LEFT JOIN ${qt(p.parent_schema, p.parent_table)} pp\n` +
      `          ON pp."${p.parent_column}" = c."${p.child_column}"\n` +
      `       WHERE c."tenantId" IS NULL`,
  );
  const existsParts = row.parents.map((p) =>
    `           WHEN pp."tenantId" IS NOT NULL AND EXISTS (SELECT 1 FROM tenants _t WHERE _t.id = pp."tenantId") THEN 1`,
  );
  const valid = row.parents.length === 1 ? existsParts[0] : existsParts.join("\n         ");
  return (
    `(\n` +
    `    SELECT pk, min(v) AS "tenantId", count(v) AS n_set,\n` +
    `           count(DISTINCT v) AS n_distinct,\n` +
    `           sum(CASE\n${valid}\n         ELSE 0 END) AS n_valid_tenant\n` +
    `      FROM (\n${parts.join("\n      UNION ALL\n")}\n` +
    `      ) all_parents\n` +
    `     GROUP BY pk\n` +
    `  ) src`
  );
};

const agreePredicate = (row) =>
  `src.n_set = ${row.parents.length}\n   AND src.n_valid_tenant = ${row.parents.length}\n` +
  `   AND src.n_distinct = 1\n   AND src."tenantId" IS NOT NULL`;

const sqlFor = (row) => (row.strategy === "single" ? sqlSingle(row, row.parents[0]) : agreeUpdate(row));

function agreeUpdate(row) {
  return (
    `UPDATE ${qt(row.schema, row.table)} c\n` +
    `   SET "tenantId" = src."tenantId"\n` +
    `  FROM ${sourceSql(row)}\n` +
    ` WHERE c."${row.pk}" = src.pk\n   AND ${agreePredicate(row)}`
  );
}

const countWouldUpdate = async (client, row) => {
  const sql =
    row.strategy === "single"
      ? (() => {
          const p = row.parents[0];
          return (
            `SELECT count(*)::int AS n FROM ${qt(row.schema, row.table)} c ` +
            `JOIN ${qt(p.parent_schema, p.parent_table)} p ON p."${p.parent_column}" = c."${p.child_column}" ` +
            `WHERE c."tenantId" IS NULL AND p."tenantId" IS NOT NULL AND ${EXISTS_TENANT("p")}`
          );
        })()
      : `SELECT count(*)::int AS n FROM ${sourceSql(row)} WHERE ${agreePredicate(row)}`;
  try {
    const r = await client.$queryRawUnsafe(sql);
    return r[0].n;
  } catch (e) {
    console.error(`[tenant-null] không đếm được ${row.schema}.${row.table}: ${e.message}`);
    console.error(sql);
    throw e;
  }
};

// ── In kết quả ───────────────────────────────────────────────────────────────

const describePlan = (row) => {
  if (row.strategy === "none") return `KHÔNG VÁ (${row.reason})`;
  if (row.strategy === "single") {
    const p = row.parents[0];
    return `suy từ ${p.parent_table}.${p.parent_column}`;
  }
  return `suy khi ${row.parents.length} cha thống nhất + tenant tồn tại`;
};

const group = (row) => {
  if (row.dupCount > 0) return "TRÙNG 1-1";
  if (row.nullCount === 0 && row.orphanCount === 0) return "ĐÃ XỬ LÝ";
  if (row.orphanCount > 0) return "MỒ CÔI-TENANT";
  if (row.nullCount === 0) return "ĐÃ XỬ LÝ";
  if (INTENTIONAL_NULL.has(row.table)) return "CỐ Ý";
  return row.strategy === "none" ? "CỐ Ý" : "LỖI";
};

const printScan = (rows, ctx) => {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n=== QUÉT CHẤT LƯỢNG tenantId — DB: ${dbLabel} ===`);
  console.log(`Tenant còn tồn tại trong DB: ${ctx.tenantIds.size}\n`);
  console.log(`${pad("bảng", 32)} ${pad("NULL", 8)} ${pad("mồ côi", 8)} ${pad("trùng", 7)} nhóm`);
  console.log("-".repeat(96));

  const summary = {};
  for (const r of rows.filter((x) => x.nullCount > 0 || x.orphanCount > 0 || x.dupCount > 0)) {
    const g = group(r);
    summary[g] = (summary[g] || 0) + 1;
    console.log(
      `${pad(r.table, 32)} ${pad(r.nullCount, 8)} ${pad(r.orphanCount, 8)} ${pad(r.dupCount, 7)} ${g}`,
    );
    if (g === "LỖI") console.log(`${" ".repeat(55)}-> ${describePlan(r)}`);
  }
  console.log("-".repeat(96));

  const totals = rows.reduce(
    (a, r) => {
      a.null += r.nullCount;
      a.orphan += r.orphanCount;
      a.dup += r.dupCount;
      return a;
    },
    { null: 0, orphan: 0, dup: 0 },
  );
  const err = rows.filter((r) => group(r) === "LỖI").reduce((s, r) => s + r.nullCount, 0);
  const dupRows = rows.filter((r) => group(r) === "TRÙNG 1-1").reduce((s, r) => s + r.dupCount, 0);

  console.log(`TỔNG NULL: ${totals.null} | MỒ CÔI-TENANT: ${totals.orphan} | TRÙNG 1-1: ${totals.dup}`);
  console.log(`  LỖI (phải = 0): ${err} | TRÙNG 1-1 (phải = 0): ${dupRows}`);
  console.log(`  CỐ Ý / ĐÃ XỬ LÝ: ${summary["CỐ Ý"] || 0} / ${summary["ĐÃ XỬ LÝ"] || 0} bảng`);

  const noFk = tablesWithoutTenantFk(ctx);
  console.log(`\nBảng scoped KHÔNG có khoá ngoại tới 'tenants': ${noFk.length}/${ctx.tables.length}`);
  console.log("  " + noFk.map((t) => t.table).join(", "));

  const blocked = rows.filter((r) => r.nullCount > 0 && r.strategy === "none");
  if (blocked.length) {
    console.log("\nKhông tự vá, cần người xử lý:");
    for (const r of blocked) console.log(`  ${r.table}: ${r.nullCount} dòng — ${r.reason}`);
  }
  console.log("");
  return { totals, err, dupRows };
};

// ── Chạy ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`DB: ${dbLabel}`);
  console.log(`Chế độ: ${MODE_SCAN ? "--scan (chỉ đọc)" : `--backfill${APPLY ? " --apply (GHI THẬT)" : " (dry-run)"}`}`);

  if (MODE_SCAN) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const { rows, ctx } = await analyse(tx);
      printScan(rows, ctx);
    });
    await prisma.$disconnect();
    return;
  }

  if (APPLY && !isLocalDb()) {
    console.error(
      "[tenant-null] TU CHOI CHAY --apply: DATABASE_URL không trỏ về máy cục bộ.\n" +
        "Script sẽ GHI hàng loạt vào DB. Trên môi trường khác chỉ chạy --backfill (dry-run).",
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const { rows } = await analyse(prisma);
  const targets = rows.filter((r) => r.nullCount > 0 && r.strategy !== "none");

  console.log("\n--- Kế hoạch vá ---");
  let total = 0;
  const plan = [];
  for (const row of targets) {
    const n = await countWouldUpdate(prisma, row);
    const unresolved = row.nullCount - n;
    if (n > 0) {
      total += n;
      plan.push({ row, n });
      console.log(`\n${row.table}: ${n} dòng — ${describePlan(row)}`);
      console.log(`${sqlFor(row)};`);
    }
    if (unresolved > 0) {
      console.log(`  ! ${unresolved} dòng KHÔNG vá được (cha NULL, cha thuộc tenant đã xoá, hoặc các cha không thống nhất).`);
    }
  }
  console.log(`\nTỔNG sẽ cập nhật: ${total} dòng`);

  if (!APPLY) {
    console.log("\nDRY-RUN — chưa ghi gì. Thêm --apply để ghi (chỉ DB local).");
    await prisma.$disconnect();
    return;
  }

  console.log("\n>>> GHI THẬT...");
  let applied = 0;
  for (const { row, n } of plan) {
    const res = await prisma.$executeRawUnsafe(sqlFor(row));
    applied += res;
    console.log(`  ${row.table}: yêu cầu ${n}, ghi ${res}`);
  }
  console.log(`\nĐã cập nhật ${applied} dòng.`);
  await prisma.$disconnect();
};

main().catch(async (e) => {
  console.error("[tenant-null] LỖI:", e.message);
  try {
    await prisma.$disconnect();
  } catch {
    /* bỏ qua */
  }
  process.exit(1);
});
