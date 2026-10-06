/**
 * scripts/verify-backup-restore.js — Phase 6: chứng minh restore thật sự thành công
 *
 * DoD của R6: "restore backup thử thành công". Chỉ chạy `pg_restore` mà không
 * đối chiếu thì không phải bằng chứng — file .dump có thể "restore thành công"
 * rồi vẫn thiếu bảng. Script này so SỐ DÒNG TỪNG BẢNG giữa DB gốc và DB sau
 * restore, và kiểm tra `_prisma_migrations` đã đủ migration chưa.
 *
 * Dùng:
 *   node scripts/verify-backup-restore.js --dump <file.dump>
 *   (mặc định: tự tìm file .dump mới nhất trong D:\erp-backups\phase6-*)
 *
 * Script chỉ ĐỌC DB gốc; DB đích được tạo/xoá bởi chính script.
 * Cần `assertLocalDb` vì có DROP/CREATE DATABASE.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { assertLocalDb } = require("./lib/assert-local-db");

assertLocalDb("verify:backup-restore");

const prisma = require("../src/config/prisma");

const PG_BIN = process.env.PG_BIN
  || "C:\\Program Files\\PostgreSQL\\18\\bin";
const PSQL = path.join(PG_BIN, "psql.exe");
const PG_RESTORE = path.join(PG_BIN, "pg_restore.exe");

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const TARGET_DB = process.env.RESTORE_TEST_DB || "erp_restore_test";

// 12 bảng cốt lõi của dự án + bảng migration. So số dòng của từng bảng là
// bằng chứng mạnh hơn so tổng số bảng trong information_schema.
const TABLES = [
  "tenants", "users", "products", "categories", "customers", "orders",
  "order_items", "payments", "crm_leads", "crm_deals", "crm_communications",
  "customer_tasks", "churn_alerts", "promotions", "vendors", "saved_reports",
];

let failed = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} | ${label}${extra ? " → " + extra : ""}`);
  if (!cond) failed += 1;
};

// `psql`/`pg_restore` hỏi MẬT KHẨU trên stdin nếu không có PGPASSWORD ⇒ treo vô
// hạn. Lấy mật khẩu từ DATABASE_URL (chính là nguồn mà app dùng) và truyền vào
// env con — không bao giờ in ra log.
const DB_URL = new URL(process.env.DATABASE_URL);
const PG_ENV = { ...process.env, PGPASSWORD: decodeURIComponent(DB_URL.password || "") };

const psql = (db, sql) => {
  const out = execFileSync(PSQL, ["-h", "127.0.0.1", "-U", "postgres", "-d", db, "-t", "-A", "-c", sql], {
    encoding: "utf8",
    env: PG_ENV,
  });
  return out.trim();
};

const newestDump = () => {
  const root = path.join(process.cwd(), "..", "erp-backups");
  const dirs = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => d.startsWith("phase6-")).sort()
    : [];
  if (!dirs.length) return null;
  const dir = path.join(root, dirs[dirs.length - 1]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".dump"));
  return files.length ? path.join(dir, files[0]) : null;
};

async function main() {
  const dump = argOf("--dump") || newestDump();
  console.log("\n=== PHASE 6 — BACKUP & RESTORE THỬ ===");
  if (!dump || !fs.existsSync(dump)) {
    console.error(`FAIL | Không tìm thấy file dump: ${dump || "(không có thư mục phase6-*)"}`);
    console.error("      Tạo backup trước: pg_dump -Fc erp_db");
    process.exit(1);
  }
  const sizeMb = (fs.statSync(dump).size / 1048576).toFixed(2);
  console.log(`File backup: ${dump} (${sizeMb} MB)`);

  const dbName = new URL(process.env.DATABASE_URL).pathname.replace("/", "");
  console.log(`DB gốc: ${dbName} → DB restore thử: ${TARGET_DB}\n`);

  // 1. Tạo DB đích sạch
  psql("postgres", `DROP DATABASE IF EXISTS ${TARGET_DB};`);
  psql("postgres", `CREATE DATABASE ${TARGET_DB};`);
  console.log(`OK   | Đã tạo DB ${TARGET_DB}`);

  // 2. Restore
  const t0 = Date.now();
  execFileSync(PG_RESTORE, [
    "-h", "127.0.0.1", "-U", "postgres", "-d", TARGET_DB,
    "--no-owner", "--no-privileges", dump,
  ], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: PG_ENV });
  const restoreMs = Date.now() - t0;
  ok(`pg_restore chạy xong (${(restoreMs / 1000).toFixed(1)}s)`, true);

  // 3. So số dòng từng bảng
  console.log("");
  console.log(`  ${"bảng".padEnd(22)}${"gốc".padStart(9)}${"restore".padStart(10)}   kết quả`);
  console.log(`  ${"-".repeat(52)}`);
  let mismatched = 0;
  let missingTable = 0;
  const q = (t) => psql(dbName, `SELECT count(*) FROM ${t};`);
  for (const t of TABLES) {
    let a;
    let b;
    try {
      a = q(t);
      b = psql(TARGET_DB, `SELECT count(*) FROM ${t};`);
    } catch (e) {
      missingTable += 1;
      console.log(`  ${t.padEnd(22)}${"?".padStart(9)}${"?".padStart(10)}   bảng thiếu khi restore`);
      continue;
    }
    const same = Number(a) === Number(b);
    if (!same) mismatched += 1;
    console.log(`  ${t.padEnd(22)}${a.padStart(9)}${b.padStart(10)}   ${same ? "khớp" : "LỆCH"}`);
  }
  console.log("");
  ok("Tất cả bảng cốt lõi có mặt sau restore", missingTable === 0, `${missingTable} bảng thiếu`);
  ok("Số dòng khớp hoàn toàn giữa gốc và bản restore", mismatched === 0, `${mismatched} bảng lệch`);

  // 4. Migration đã đủ chưa — restore xong mà thiếu migration thì app lỗi schema
  const migSrc = psql(dbName, 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;');
  const migDst = psql(TARGET_DB, 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;');
  ok(
    "Đủ bản ghi _prisma_migrations (app khởi động được sau restore)",
    Number(migSrc) > 0 && migSrc === migDst,
    `gốc ${migSrc} / restore ${migDst}`,
  );

  // 5. Dữ liệu CRM nhìn được sau restore (không chỉ bảng rỗng)
  const tenants = psql(TARGET_DB, "SELECT count(*) FROM tenants;");
  const phase = psql(TARGET_DB, "SELECT count(*) FROM tenants WHERE slug = 'crm-phase1-demo';");
  ok("DB restore chứa tenant trình diễn", Number(phase) >= 1, `${phase}/${tenants} tenant`);

  console.log("");
  console.log(failed === 0
    ? "KẾT QUẢ: ĐẠT — backup đã restore thử thành công, dữ liệu khớp từng bảng."
    : `KẾT QUẢ: ${failed} kiểm tra FAIL.`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("LỖI:", e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
