/**
 * docs/aisc26/one-off/cleanup-dev-test-users.js — DỌN RÁC KIỂM THỬ TRÊN DB PHÁT TRIỂN
 *
 * DÙNG MỘT LẦN. Sau khi chạy xong thì có thể xoá khỏi repo; giữ lại để
 * phòng khi còn test residue.
 *
 * BỐI CẢNH
 * 9 tài khoản rác trên DB phát triển có `tenantId IS NULL`: 4 tài khoản
 * `e2e_test_*@example.com` và 5 tài khoản `smoke-*@test.local`. Chúng là
 * rác do các lần chạy script kiểm thử thất bại trước đây (đã có `pg_dump`
 * trước khi động vào), KHÔNG phải dữ liệu cần điều tra.
 *
 * CHỈ XOÁ KHI THOẢ ĐỒNG THỜI
 *   1. `tenantId IS NULL`
 *   2. email khớp `e2e_test_%@example.com` HOẶC `smoke-%@test.local`
 *   3. role KHÔNG phải `SUPER_OMEGA_ULTRA_ADMIN`
 *   4. ĐÚNG 9 tài khoản (4 + 5). Lệch bất kỳ số nào ⇒ hủy toàn bộ thao tác.
 *
 * DÙNG ĐÚNG MỘT TRANSACTION: mọi kiểm tra và mọi lệnh xoá cùng nhau, hoặc
 * không xoá gì cả. Mặc định dry-run; chỉ ghi khi có `--apply`.
 *
 * DÙNG
 *   node docs/aisc26/one-off/cleanup-dev-test-users.js            # dry-run
 *   node docs/aisc26/one-off/cleanup-dev-test-users.js --apply    # ghi thật
 */

require("dotenv").config();
const path = require("path");

const { assertLocalDb } = require(path.join(__dirname, "..", "..", "..", "scripts", "lib", "assert-local-db"));
assertLocalDb("cleanup-dev-test-users");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");

/** Số lượng đúng phải có; lệch là hủy (chốt chặn của đội). */
const EXPECTED_TOTAL = 9;
const EXPECTED_BY_PATTERN = { e2e: 4, smoke: 5 };

/**
 * Bảng con được phép xoá kèm. Mọi bảng khác tham chiếu tới 9 user này đều
 * khiến thao tác bị hủy — không xoá cưỡng bức.
 */
const ALLOWED_CHILD_TABLES = new Set(["refresh_tokens", "notifications", "audit_logs"]);

const EMAIL_E2E = "e2e\\_test\\_%@example.com";
const EMAIL_SMOKE = "smoke-%@test.local";

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432", 10),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Các bảng con có khóa ngoại trỏ tới `users`, kèm tên cột. */
const findUserReferences = async (tx) =>
  tx.$queryRawUnsafe(`
    SELECT tc.table_schema AS schema,
           tc.table_name  AS table,
           kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema NOT IN ('pg_catalog','information_schema')
       AND ccu.table_name = 'users'
     ORDER BY tc.table_name`);

const run = async () => {
  console.log(`\n=== DỌN RÁC KIỂM THỬ (${APPLY ? "--apply: GHI THẬT" : "dry-run"}) ===\n`);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. Tìm ứng viên ────────────────────────────────────────────────────
    const targets = await tx.$queryRawUnsafe(
      `SELECT id, email, role::text AS role
         FROM users
        WHERE "tenantId" IS NULL
          AND role::text <> 'SUPER_OMEGA_ULTRA_ADMIN'
          AND (email LIKE $1 OR email LIKE $2)
        ORDER BY email`,
      EMAIL_E2E,
      EMAIL_SMOKE,
    );

    console.log(`Ứng viên: ${targets.length} tài khoản`);
    const byPattern = {
      e2e: targets.filter((u) => u.email.startsWith("e2e_test_")).length,
      smoke: targets.filter((u) => u.email.startsWith("smoke-")).length,
    };
    for (const u of targets) console.log(`  ${u.email}  (${u.role})`);

    // ── 2. Kiểm tra số lượng ──────────────────────────────────────────────
    const problems = [];
    if (targets.length !== EXPECTED_TOTAL) {
      problems.push(`số tài khoản là ${targets.length}, dự kiến ${EXPECTED_TOTAL}`);
    }
    if (byPattern.e2e !== EXPECTED_BY_PATTERN.e2e) {
      problems.push(`e2e_test_* = ${byPattern.e2e}, dự kiến ${EXPECTED_BY_PATTERN.e2e}`);
    }
    if (byPattern.smoke !== EXPECTED_BY_PATTERN.smoke) {
      problems.push(`smoke-* = ${byPattern.smoke}, dự kiến ${EXPECTED_BY_PATTERN.smoke}`);
    }

    // ── 3. Rà toàn bộ tham chiếu tới 9 user này ────────────────────────────
    const refs = await findUserReferences(tx);
    const ids = targets.map((u) => u.id);
    const childPlan = [];

    for (const ref of refs) {
      const allowed = ALLOWED_CHILD_TABLES.has(ref.table);
      // Không phải bảng nào tham chiếu `users` cũng có cột `tenantId`
      // (ví dụ chính `users`, hay bảng 1-1 theo tenant) — chỉ lọc khi có.
      const hasTenantCol = await tx.$queryRawUnsafe(
        `SELECT count(*)::int AS n
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND column_name = 'tenantId'`,
        ref.schema,
        ref.table,
      );
      const withTenantFilter = hasTenantCol[0].n > 0;

      const nullCountExpr = withTenantFilter
        ? `count(*) FILTER (WHERE "tenantId" IS NULL)::int`
        : `0::int`;
      const res = await tx.$queryRawUnsafe(
        `SELECT count(*)::int AS total, ${nullCountExpr} AS null_tenant
           FROM "${ref.schema}"."${ref.table}"
          WHERE "${ref.column}" = ANY($1::text[])`,
        ids,
      );
      const { total, null_tenant } = res[0];
      if (total === 0) continue;
      const withTenant = withTenantFilter ? total - null_tenant : total;

      console.log(
        `  tham chiếu: ${ref.table}.${ref.column} = ${total} dòng` +
          (withTenantFilter ? ` (tenantId NULL: ${null_tenant})` : " (bảng không có cột tenantId)") +
          (allowed ? "" : "   <-- BẢNG KHÔNG MẪN ĐỊNH"),
      );
      if (!allowed) {
        problems.push(`${ref.table} tham chiếu tới user rác nhưng không nằm trong danh sách cho phép`);
      }
      if (withTenant > 0) {
        problems.push(
          `${ref.table} có ${withTenant} dòng thuộc user rác mà KHÔNG mang tenantId NULL` +
            `${withTenantFilter ? " (khác NULL)" : " — bảng không có tenantId để đối chiếu"}: không đoán, hủy`,
        );
      }
      childPlan.push({ ...ref, total, null_tenant, withTenantFilter });
    }

    // ── 4. Báo cáo tài khoản nền tảng (giữ nguyên, không xoá) ──────────────
    const platform = await tx.$queryRawUnsafe(
      `SELECT id, email FROM users WHERE "tenantId" IS NULL AND role::text = 'SUPER_OMEGA_ULTRA_ADMIN' ORDER BY email`,
    );
    console.log(`\nTài khoản cấp nền tảng (NULL là cố ý, KHÔNG đụng): ${platform.length}`);
    for (const u of platform) console.log(`  ${u.email}`);

    if (problems.length) {
      console.log("\nHỦY TOÀN BỘ THAO TÁC — không xoá gì:");
      for (const p of problems) console.log(`  - ${p}`);
      return { aborted: true };
    }

    // ── 5. Xoá (chỉ khi --apply) ──────────────────────────────────────────
    if (!APPLY) {
      console.log("\nDRY-RUN — chưa xoá gì. Thêm --apply để ghi.");
      return { aborted: false, dryRun: true, targets: targets.length, childPlan };
    }

    const deleted = [];
    for (const child of childPlan) {
      const r = await tx.$executeRawUnsafe(
        `DELETE FROM "${child.schema}"."${child.table}" WHERE "${child.column}" = ANY($1::text[])`,
        ids,
      );
      deleted.push({ table: child.table, n: r });
      console.log(`  đã xoá ${child.table}: ${r} dòng`);
    }
    const u = await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = ANY($1::text[])`, ids);
    deleted.push({ table: "users", n: u });
    console.log(`  đã xoá users: ${u} dòng`);

    return { aborted: false, deleted };
  });

  console.log("");
  return result;
};

run()
  .then(async (r) => {
    if (!r.aborted && !r.dryRun) console.log("HOÀN TẤT (một transaction).");
    await prisma.$disconnect();
    process.exit(r.aborted ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("LỖI (transaction đã rollback):", e.message);
    try {
      await prisma.$disconnect();
    } catch {
      /* bỏ qua */
    }
    process.exit(1);
  });
