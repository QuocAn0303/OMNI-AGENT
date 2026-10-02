/**
 * scripts/tenant-null.js — Quét và vá dữ liệu `tenantId IS NULL`
 *
 * BỐI CẢNH
 * Prisma extension chỉ gắn `tenantId` vào `data` cấp ngoài cùng. Với
 * `order.create({ data: { items: { create: [...] } } })` thì dòng `OrderItem`
 * sinh ra có `tenantId = NULL`, trong khi MỌI truy vấn đọc đều lọc `tenantId`
 * ⇒ dữ liệu đó vô hình với tenant của chính nó (báo cáo, đề xuất nhập hàng...).
 * Đo trên DB phát triển: 84/242 dòng `order_items` bị NULL.
 *
 * CÁCH DÙNG
 *   node scripts/tenant-null.js --scan                  # chỉ đọc (mặc định)
 *   node scripts/tenant-null.js --scan --allow-remote   # chỉ đọc, cho phép DB xa
 *   node scripts/tenant-null.js --backfill              # DRY-RUN: in câu UPDATE
 *   node scripts/tenant-null.js --backfill --apply      # GHI THẬT (chỉ DB local)
 *
 * NGUYÊN TẮC
 *   1. `--scan` chỉ đọc, chạy trong transaction `READ ONLY`; `--allow-remote` chỉ
 *      có tác dụng ở chế độ này.
 *   2. `--backfill` mặc định là dry-run; phải có `--apply` mới ghi.
 *   3. `--apply` từ chối chạy nếu DB không phải máy cục bộ (cùng chốt chặn với
 *      `check:tenant`). Trên môi trường khác, script chỉ in câu SQL.
 *   4. KHÔNG đoán. Một hàng chỉ được vá khi suy ra được duy nhất một `tenantId`:
 *      - cha duy nhất có cột `tenantId` → lấy trực tiếp;
 *      - nhiều cha → chỉ vá khi các cha **cùng chỉ một** `tenantId`, lệch thì báo;
 *      - không có cha nào, hoặc `tenantId` là một phần của khoá chính của chính
 *        bảng đó (bảng 1-1 theo tenant) → không vá, liệt kê ra cho người xử lý.
 *   5. Idempotent: chạy lại không thay đổi gì thêm.
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

// ── Kết nối ───────────────────────────────────────────────────────────────────
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

// ── Thu thập metadata từ chính database ───────────────────────────────────────

const listTenantTables = (client) =>
  client.$queryRawUnsafe(`
    SELECT c.table_schema AS schema, c.table_name AS table
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'tenantId'
      AND t.table_type = 'BASE TABLE'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY c.table_schema, c.table_name`);

/** Các cột khoá chính; chỉ dùng được khi bảng có đúng một cột PK. */
const listPrimaryKeys = (client) =>
  client.$queryRawUnsafe(`
    SELECT tc.table_schema AS schema, tc.table_name AS table, kcu.column_name AS column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY tc.table_schema, tc.table_name`);

const listForeignKeys = (client) =>
  client.$queryRawUnsafe(`
    SELECT
      tc.table_schema   AS child_schema,
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
      AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY tc.table_schema, tc.table_name`);

// ── Phân tích ────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Plan
 * @property {'single'|'agree'|'none'} strategy
 * @property {Array} parents  các quan hệ cha có cột tenantId
 * @property {string} [reason] lý do không vá được
 */

/** Bảng con này có thể suy `tenantId` ra sao. */
const planFor = (table, ctx) => {
  const pkColumns = ctx.pkColumns.get(key(table.schema, table.table)) || [];

  // `tenantId` là một phần của khoá chính ⇒ nó CHÍNH LÀ định danh tenant của
  // dòng (bảng 1-1). NULL ở đây nghĩa là dòng không thuộc tenant nào, không
  // phải dữ liệu hỏng — tuyệt đối không đoán.
  if (pkColumns.includes("tenantId")) {
    return { strategy: "none", parents: [], reason: '"tenantId" là một phần của khoá chính của chính bảng này' };
  }

  const childFks = ctx.fks.filter((fk) => fk.child_schema === table.schema && fk.child_table === table.table);

  // `child_column = 'tenantId'` là chính cột cần suy — dùng nó làm nguồn là vô
  // nghĩa. Khóa ngoại tự tham chiếu (users.createdById → users.id) thì "cha" là
  // bảng đang xét, dùng để suy là vòng tròn.
  const candidates = childFks.filter(
    (fk) =>
      fk.child_column !== "tenantId" &&
      !(fk.parent_schema === table.schema && fk.parent_table === table.table),
  );
  const parents = candidates.filter((fk) => ctx.tenantTables.has(key(fk.parent_schema, fk.parent_table)));
  const tenantPointingFks = childFks.filter((fk) => fk.child_column === "tenantId");

  if (parents.length === 0) {
    const reason = tenantPointingFks.length
      ? `"tenantId" là khóa ngoại trỏ tới ${tenantPointingFks[0].parent_table} (bảng cha không mang tenantId), nên không có nguồn để suy`
      : "không có khóa ngoại nào trỏ tới bảng có cột tenantId";
    return { strategy: "none", parents: [], reason };
  }
  if (pkColumns.length !== 1) {
    return { strategy: "none", parents: [], reason: `khóa chính gồm ${pkColumns.length} cột, không ghép được` };
  }
  if (parents.length === 1) {
    return { strategy: "single", parents, pk: pkColumns[0] };
  }
  return { strategy: "agree", parents, pk: pkColumns[0] };
};

const countNull = async (client, table) => {
  const res = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${qt(table.schema, table.table)} WHERE "tenantId" IS NULL`,
  );
  return res[0].n;
};

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
  return { tables, fks, pkColumns, tenantTables };
};

const analyse = async (client) => {
  const ctx = await loadContext(client);
  const rows = [];
  for (const t of ctx.tables) {
    const plan = planFor(t, ctx);
    const nullCount = await countNull(client, t);
    rows.push({ ...t, nullCount, ...plan });
  }
  return rows;
};

// ── Sinh SQL ─────────────────────────────────────────────────────────────────

const sqlSingle = (row, parent) =>
  `UPDATE ${qt(row.schema, row.table)} c\n` +
  // Sao chép `tenantId` CỦA CHA — không phải khoá chính của cha.
  `   SET "tenantId" = p."tenantId"\n` +
  `  FROM ${qt(parent.parent_schema, parent.parent_table)} p\n` +
  ` WHERE p."${parent.parent_column}" = c."${parent.child_column}"\n` +
  `   AND c."tenantId" IS NULL\n` +
  `   AND p."tenantId" IS NOT NULL`;

/**
 * Nguồn dữ liệu dùng chung cho cả `UPDATE` lẫn `SELECT COUNT` của nhánh
 * "nhiều cha": mỗi dòng con ứng với `n_set` giá trị `tenantId` lấy từ các cha.
 *
 * Vá chỉ khi `n_set = <số cha>` (mọi cha đều có tenantId) và `n_distinct = 1`
 * (các cha không mâu thuẫn) ⇒ không bao giờ ghi nhầm tenant.
 */
const sourceSql = (row) => {
  const parts = row.parents.map(
    (p) =>
      `      SELECT c."${row.pk}" AS pk, pp."tenantId" AS v\n` +
      `        FROM ${qt(row.schema, row.table)} c\n` +
      `        LEFT JOIN ${qt(p.parent_schema, p.parent_table)} pp\n` +
      `          ON pp."${p.parent_column}" = c."${p.child_column}"\n` +
      `       WHERE c."tenantId" IS NULL`,
  );
  return (
    `(\n` +
    `    SELECT pk, min(v) AS "tenantId", count(v) AS n_set, count(DISTINCT v) AS n_distinct\n` +
    `      FROM (\n${parts.join("\n      UNION ALL\n")}\n` +
    `      ) all_parents\n` +
    `     GROUP BY pk\n` +
    `  ) src`
  );
};

const agreePredicate = (row) =>
  `src.n_set = ${row.parents.length}\n   AND src.n_distinct = 1\n   AND src."tenantId" IS NOT NULL`;

const sqlAgree = (row) =>
  `UPDATE ${qt(row.schema, row.table)} c\n` +
  `   SET "tenantId" = src."tenantId"\n` +
  `  FROM ${sourceSql(row)}\n` +
  ` WHERE c."${row.pk}" = src.pk\n   AND ${agreePredicate(row)}`;

const sqlFor = (row) => (row.strategy === "single" ? sqlSingle(row, row.parents[0]) : sqlAgree(row));

/**
 * Số dòng sẽ được ghi.
 *
 * KHÔNG bọc `sqlFor` vào subquery: Postgres không cho `UPDATE` nằm trong
 * `SELECT ... FROM (...)`. Phải viết riêng câu `SELECT COUNT` cùng điều kiện.
 */
const countWouldUpdate = async (client, row) => {
  let sql;
  if (row.strategy === "single") {
    const p = row.parents[0];
    sql =
      `SELECT count(*)::int AS n FROM ${qt(row.schema, row.table)} c ` +
      `JOIN ${qt(p.parent_schema, p.parent_table)} p ON p."${p.parent_column}" = c."${p.child_column}" ` +
      `WHERE c."tenantId" IS NULL AND p."tenantId" IS NOT NULL`;
  } else {
    sql = `SELECT count(*)::int AS n FROM ${sourceSql(row)} WHERE ${agreePredicate(row)}`;
  }

  try {
    const res = await client.$queryRawUnsafe(sql);
    return res[0].n;
  } catch (e) {
    console.error(`[tenant-null] không đếm được cho ${row.schema}.${row.table}: ${e.message}`);
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
  return `suy khi ${row.parents.length} cha thống nhất (${row.parents.map((p) => p.parent_table).join(", ")})`;
};

const printScan = (rows) => {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n=== QUÉT tenantId IS NULL — DB: ${dbLabel} ===`);
  console.log(`${pad("bảng", 40)} ${pad("null", 9)} kế hoạch`);
  console.log("-".repeat(110));
  for (const r of rows.filter((x) => x.nullCount > 0)) {
    console.log(`${pad(`${r.schema}.${r.table}`, 40)} ${pad(r.nullCount, 9)} ${describePlan(r)}`);
  }
  const total = rows.reduce((s, r) => s + r.nullCount, 0);
  const blocked = rows.filter((r) => r.nullCount > 0 && r.strategy === "none");
  console.log("-".repeat(110));
  console.log(`TỔNG dòng NULL: ${total}`);
  if (total === 0) console.log("Không có dòng NULL nào.");
  if (blocked.length) {
    console.log(`\nCần NGƯỜI xử lý (script không đoán) — ${blocked.length} bảng:`);
    for (const r of blocked) console.log(`  ${r.schema}.${r.table}: ${r.nullCount} dòng — ${r.reason}`);
  }
  return { total, blocked };
};

// ── Chạy ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`DB: ${dbLabel}`);
  console.log(`Chế độ: ${MODE_SCAN ? "--scan (chỉ đọc)" : `--backfill${APPLY ? " --apply (GHI THẬT)" : " (dry-run)"}`}`);

  if (MODE_SCAN) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const rows = await analyse(tx);
      const { total } = printScan(rows);
      if (total > 0) {
        console.log("\nXem câu UPDATE (không ghi):  node scripts/tenant-null.js --backfill");
      }
    });
    await prisma.$disconnect();
    return;
  }

  if (APPLY && !isLocalDb()) {
    console.error(
      "[tenant-null] TU CHOI CHAY --apply: DATABASE_URL không trỏ về máy cục bộ.\n" +
        "Script sẽ GHI hàng loạt vào DB. Trên môi trường khác chỉ chạy --backfill (dry-run)\n" +
        "để lấy câu SQL rồi con người tự quyết định khi nào chạy.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const rows = (await analyse(prisma)).filter((r) => r.nullCount > 0 && r.strategy !== "none");

  console.log("\n--- Kế hoạch vá ---");
  let total = 0;
  const plan = [];
  for (const row of rows) {
    const n = await countWouldUpdate(prisma, row);
    const unresolved = row.nullCount - n;
    if (n === 0) {
      console.log(`\n${row.schema}.${row.table}: 0 dòng khớp (bỏ qua)`);
    } else {
      total += n;
      plan.push({ row, n });
      console.log(`\n${row.schema}.${row.table}: ${n} dòng — ${describePlan(row)}`);
      console.log(`${sqlFor(row)};`);
    }
    if (unresolved > 0) {
      console.log(
        `  ! ${unresolved} dòng KHÔNG suy được tenantId (cha bị NULL hoặc các cha không thống nhất) — KHÔNG đoán, để người xử lý.`,
      );
    }
  }
  console.log(`\nTỔNG sẽ cập nhật: ${total} dòng`);

  if (!APPLY) {
    console.log("\nĐây là DRY-RUN — chưa ghi gì. Thêm --apply để ghi (chỉ DB local).");
    await prisma.$disconnect();
    return;
  }

  console.log("\n>>> Bắt đầu GHI THẬT...");
  let applied = 0;
  for (const { row, n } of plan) {
    const res = await prisma.$executeRawUnsafe(sqlFor(row));
    applied += res;
    console.log(`  ${row.schema}.${row.table}: yêu cầu ${n}, ghi ${res} dòng`);
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
