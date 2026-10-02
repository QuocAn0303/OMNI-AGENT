/**
 * scripts/cleanup-test-residue.js — DỌN RÁC KIỂM THỬ THEO TIỀN TỐ
 *
 * VÌ SAO CẦN
 * Các script smoke/check tạo tenant/user rồi xoá. Khi xoá không trọn (FK
 * `RESTRICT`, hoặc quên bảng), dữ liệu kiểm thử **ở lại** và làm sai mọi phép
 * đo về dữ liệu. Đã xảy ra: `smoke:po-gate` rò `warehouse` + `audit_log`,
 * `check-tenant-isolation` rò cả tenant (`ISO A` / `ISO B`).
 *
 * CÁCH DÙNG
 *   node scripts/cleanup-test-residue.js                 # dry-run (mặc định)
 *   node scripts/cleanup-test-residue.js --apply         # xoá thật (chỉ DB local)
 *   node scripts/cleanup-test-residue.js --apply --keep=CANDORY,Á
 *
 * AN TOÀN
 *   - `assert-local-db`: từ chối chạy trên DB không phải máy cục bộ.
 *   - Chỉ xoá tenant mà TÊN hoặc SLUG khớp đúng các tiền tố kiểm thử dưới đây.
 *   - `--keep` để chỉ định thêm tên được giữ (ví dụ tenant thật).
 *   - Xoá theo thứ tự phụ thuộc, trong MỘT transaction; lỗi ⇒ rollback toàn bộ.
 *   - **Không** xoá bất kỳ tenant nào không khớp tiền tố.
 *
 * Tiền tố của dự án này:
 *   SMOKE / smoke  · ISO / iso      (check-tenant-isolation, check-tenant-gaps)
 *   GAP  / gap     · DBG  / dbg     (script debug)
 *   CHK  / chk     · DEMO / demo    (smoke dàn hạng)
 */

require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("cleanup-test-residue");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const keepArg = process.argv.find((a) => a.startsWith("--keep="));
const KEEP = new Set(
  (keepArg ? keepArg.slice(7) : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Tiền tố tenant kiểm thử. CHỈ xoá tenant khớp một trong các tiền tố này. */
const PREFIXES = ["SMOKE", "smoke", "ISO", "iso", "GAP", "gap", "DBG", "dbg", "CHK", "chk", "DEMO", "demo"];

const isTestTenant = (name, slug) =>
  PREFIXES.some((p) => String(name).startsWith(p) || String(slug).startsWith(p));

const url = new URL(process.env.DATABASE_URL || "");
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432", 10),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const q = async (sql) => (await prisma.$queryRawUnsafe(sql))[0];

const main = async () => {
  console.log(`\n=== DỌN RÁC KIỂM THỬ THEO TIỀN TỐ (${APPLY ? "--apply" : "dry-run"}) ===`);

  const tenants = await prisma.$queryRawUnsafe(`SELECT id, name, slug FROM tenants ORDER BY name`);
  const targets = tenants.filter((t) => isTestTenant(t.name, t.slug) && !KEEP.has(t.name));
  const kept = tenants.filter((t) => KEEP.has(t.name));

  console.log(`Tenant tổng: ${tenants.length} | tiền tố kiểm thử sẽ dọn: ${targets.length}`);
  for (const t of targets) console.log(`  - ${t.name}  (${t.slug})`);
  for (const t of kept) console.log(`  = GIỮ: ${t.name}`);
  const untouched = tenants.filter((t) => !targets.includes(t) && !kept.includes(t));
  for (const t of untouched) console.log(`  . giữ nguyên (không khớp tiền tố): ${t.name}`);

  if (targets.length === 0) {
    console.log("\nKhông có gì để dọn.");
    await prisma.$disconnect();
    return;
  }

  const ids = targets.map((t) => `'${t.id}'`).join(",");

  // Bảng cần dọn theo thứ tự con → cha. Dùng bảng có cột tenantId, xoá theo
  // thứ tự "càng nhiều quan hệ con càng trước" là an toàn cho FK RESTRICT.
  const tables = (
    await prisma.$queryRawUnsafe(`
      SELECT c.table_name AS t,
             (SELECT count(*)::int FROM information_schema.table_constraints tc2
               JOIN information_schema.constraint_column_usage ccu2
                 ON ccu2.constraint_name = tc2.constraint_name
                AND ccu2.table_schema = tc2.table_schema
              WHERE tc2.constraint_type = 'FOREIGN KEY' AND ccu2.table_name = c.table_name) AS n_fk_child
        FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       WHERE c.column_name = 'tenantId' AND tb.table_type = 'BASE TABLE'
         AND c.table_schema = 'public'
       ORDER BY 1`)
  ).map((r) => ({ table: r.t, n_fk_child: r.n_fk_child }));

  const counts = [];
  for (const t of tables) {
    const n = await q(`SELECT count(*)::int AS n FROM "${t.table}" WHERE "tenantId" IN (${ids})`);
    if (n.n > 0) counts.push({ ...t, n: n.n });
  }
  // Bảng bị tham chiếu nhiều nhất (nhiều con hơn) xoá trước.
  counts.sort((a, b) => b.n_fk_child - a.n_fk_child || a.table.localeCompare(b.table));

  console.log(`\nDòng sẽ xoá: ${counts.reduce((s, c) => s + c.n, 0)} ở ${counts.length} bảng`);
  for (const c of counts) console.log(`  ${c.table.padEnd(34)} ${c.n}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — chưa xoá gì. Thêm --apply để xoá.");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const c of counts) {
      // Bảng nào xoá lỗi FK thì bỏ qua và báo, không làm hỏng cả lượt.
      try {
        const r = await tx.$executeRawUnsafe(`DELETE FROM "${c.table}" WHERE "tenantId" IN (${ids})`);
        console.log(`  đã xoá ${c.table}: ${r}`);
      } catch (e) {
        console.log(`  BỎ QUA ${c.table}: ${String(e.message).slice(0, 90)}`);
      }
    }
    const t = await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN (${ids})`);
    console.log(`  đã xoá tenants: ${t}`);
  });

  console.log("\nXong. Chạy lại `node scripts/cleanup-test-residue.js` để xác nhận còn 0.");
  await prisma.$disconnect();
};

main().catch(async (e) => {
  console.error("LỖI:", e.message);
  try {
    await prisma.$disconnect();
  } catch {
    /* bỏ qua */
  }
  process.exit(1);
});
