/**
 * scripts/cleanup-orphan-null-rows.js — DỌN DẸP DÒNG `tenantId IS NULL` KHÔNG SUY ĐƯỢC
 *
 * BỐI CẢNH (đo 2026-10-12, trên DB phát triển cục bộ)
 * `npm run check:tenant` FAIL vì 3 nhóm dòng NULL không nằm trong bất kỳ ngoại lệ
 * tường minh nào (`scripts/lib/tenant-null-exceptions.js`). Truy nguồn từng dòng:
 *
 *   1. `customers` 83 dòng — rác từ lần chạy `seed_prm.js` sai cách (ngoài
 *      `runWithTenant`) trước khi extension được chặn ghi lồng. ĐÃ CHỨNG MINH:
 *        - 0 khóa ngoại nào trỏ tới (`information_schema` ⇒ 0 bảng FK customers.id)
 *        - 0 `partner_referrals` nào trỏ tới
 *        - 0 tenant nào đọc được (tenantId NULL nên không lọc được vào tenant nào)
 *      Không có cha để suy ra tenant ⇒ KHÔNG VÁ ĐƯỢC, chỉ có thể XOÁ.
 *      `seed_prm.js:277` đã cảnh báo đúng việc này.
 *
 *   2. `refresh_tokens` 4 dòng — suy ra được từ `users.tenantId` (user thật, tenant
 *      thật). ĐÃ SỬA MÃ: `auth.service.js` `generateTokens` + `refreshAccessToken`
 *      truyền `tenantId` tường minh. 4 dòng này VÁ LẠI (không xoá token còn hiệu
 *      lực — xoá sẽ đăng xuất người dùng).
 *
 *   3. `audit_logs` 4 dòng `LOGIN` — suy ra được từ `users.tenantId`, và mã đã sửa
 *      (`auth.service.js` `login`, `auth.controller.js` `verify2fa`). VÁ LẠI để lịch
 *      sửa đăng nhập hiện đúng trên màn hình Audit của từng tenant.
 *
 * QUY TẮC (theo `docs/aisc26/STATE.md` + `docs/aisc26/AI-HANDOVER.md`)
 *   - `assertLocalDb` — từ chối chạy nếu DB không phải máy cục bộ.
 *   - DRY-RUN là mặc định; phải có `--apply` mới ghi.
 *   - COUNT CHẠY LẠI ngay trước lúc ghi (không tin số đo lúc đầu phiên).
 *   - MỘT transaction: hỏng thì hết, không để lại nửa vời.
 *   - Xoá hàng loạt ⇒ `pg_dump` trước, ghi đường dẫn ra stdout.
 *   - Sau khi ghi: chạy lại COUNT và in ra để chứng minh, không tự tin bằng lời.
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("cleanup-orphan-null-rows");

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const prisma = require("../src/config/prisma");

const APPLY = process.argv.includes("--apply");
const q = (sql) => prisma.$queryRawUnsafe(sql);

/** `pg_dump` trong PATH (Linux/macOS, hoặc Windows đã thêm vào PATH). */
function findOnPath(bin) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
      const p = path.join(d, bin + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Bản cài PostgreSQL trên Windows: `C:\Program Files\PostgreSQL\<ver>\bin`. */
function findPgDumpInPostgresInstall() {
  const roots = [
    "C:\\Program Files\\PostgreSQL",
    "C:\\Program Files (x86)\\PostgreSQL",
    path.join(os.homedir(), "scoop", "apps", "postgresql"),
    "/usr/local/pgsql/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/lib/postgresql/16/bin",
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    // Sắp phiên bản giảm dần để dùng bản mới nhất tìm được.
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => Number(b.replace(/\D/g, "")) - Number(a.replace(/\D/g, "")));
    for (const ver of [...entries, ""]) {
      const p = path.join(root, ver, "bin", process.platform === "win32" ? "pg_dump.exe" : "pg_dump");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Phân tích `postgresql://user:pass@host:port/db?schema=public` bằng `URL` chuẩn
 * của Node (decode user/pass) — regex tay dễ cắt sai khi mật khẩu chứa `@` hay `:`.
 */
function parseDatabaseUrl(raw) {
  if (!raw) return { ok: false, reason: "DATABASE_URL rỗng" };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "URL không hợp lệ" };
  }
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!dbName) return { ok: false, reason: "thiếu tên database trong URL" };
  return {
    ok: true,
    host: u.hostname || "localhost",
    port: u.port || "5432",
    user: decodeURIComponent(u.username || "postgres"),
    pass: decodeURIComponent(u.password || ""),
    dbName,
  };
}

/** Đếm lại tại thời điểm chạy — không dùng số đo lúc đầu phiên. */
const countAll = async () => {
  const c = await q(`SELECT count(*)::int AS n FROM customers WHERE "tenantId" IS NULL`);
  const r = await q(`SELECT count(*)::int AS n FROM refresh_tokens WHERE "tenantId" IS NULL`);
  const a = await q(`
    SELECT count(*)::int AS n FROM audit_logs
     WHERE "tenantId" IS NULL AND action = 'LOGIN'`);
  return { customers: c[0].n, refreshTokens: r[0].n, loginAudit: a[0].n };
};

(async () => {
  console.log(`\n=== DỌN DẸP DÒNG tenantId NULL KHÔNG SUY ĐƯỢC ===`);
  console.log(`Chế độ: ${APPLY ? "--apply (GHI THẬT, chỉ DB local)" : "dry-run (chưa ghi gì)"}\n`);

  const before = await countAll();
  console.log("COUNT chạy lại trước khi ghi:");
  console.table(before);

  const total = before.customers + before.refreshTokens + before.loginAudit;
  if (total === 0) {
    console.log("Không có dòng nào cần xử lý. Dừng.");
    await prisma.$disconnect();
    return;
  }

  // --- Xác minh lại giả định "không tham chiếu" TRƯỚC khi xoá hàng loạt -------
  console.log("--- Xác minh lại trước khi xoá (phải đều là 0) ---");

  const fk = await q(`
    SELECT count(*)::int AS n
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.columns c
        ON c.table_schema = tc.table_schema
       AND c.table_name  = tc.table_name
       AND c.column_name = kcu.column_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND c.table_name = 'customers' AND c.column_name = 'id'`);
  console.log(`  customers.id có FK trỏ tới: ${fk[0].n}`);

  const ref = await q(`
    SELECT count(*)::int AS n FROM partner_referrals
     WHERE "customerId" IN (SELECT id FROM customers WHERE "tenantId" IS NULL)`);
  console.log(`  partner_referrals trỏ tới khách NULL: ${ref[0].n}`);

  if (fk[0].n > 0 || ref[0].n > 0) {
    console.error(
      "\nDỪNG: có tham chiếu tới khách NULL — giả định 'không ai dùng' KHÔNG còn đúng.\n" +
        "Phải điều tra lại trước khi xoá. Không ghi gì.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("\n--- Kế hoạch ---");
  console.log(`  XOÁ  customers:        ${before.customers} dòng (không FK, không referral, không tenant đọc được)`);
  console.log(`  VÁ   refresh_tokens:   ${before.refreshTokens} dòng (lấy tenant từ users.tenantId — token còn hiệu lực, KHÔNG xoá)`);
  console.log(`  VÁ   audit_logs LOGIN: ${before.loginAudit} dòng (lấy tenant từ users.tenantId)`);

  if (!APPLY) {
    console.log("\nDRY-RUN — chưa ghi gì. Thêm --apply để ghi (chỉ DB local).");
    await prisma.$disconnect();
    return;
  }

  // --- Sao lưu trước khi xoá hàng loạt -------------------------------------
  // Dùng parser chuẩn, KHÔNG dùng regex: `DATABASE_URL` có thể chứa `@`/`:` trong
  // mật khẩu và `?schema=` ở cuối. Regex tay cắt sai chuỗi sẽ tạo tên DB
  // bịa đặt và `pg_dump` báo "database does not exist" (đã xảy ra 1 lần).
  const conn = parseDatabaseUrl(process.env.DATABASE_URL || "");
  if (!conn.ok) {
    console.error(`\nDỪNG: không phân tích được DATABASE_URL (${conn.reason}).`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const { host, port, user, pass, dbName } = conn;
  const dir = path.join(os.tmpdir(), "erp-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const dump = path.join(dir, `aduu-before-orphan-null-cleanup-${stamp}.dump`);
  console.log(`\n>>> Sao lưu trước: ${dump}`);

  // `pg_dump` thường KHÔNG nằm trong PATH trên Windows (PostgreSQL cài ở
  // `C:\Program Files\PostgreSQL\<ver>\bin`). Dò thủ công thay vì bỏ qua bước
  // sao lưu — bỏ qua thì xoá hàng loạt mà không có đường lui.
  const pgDump =
    (process.env.PG_DUMP_BIN || "").trim() ||
    findOnPath("pg_dump") ||
    findPgDumpInPostgresInstall();
  if (!pgDump) {
    console.error(
      "\nDỪNG: không tìm thấy `pg_dump`.\n" +
        "Không ghi gì — xoá hàng loạt mà không có bản sao lưu là không thể đảo.\n" +
        "Cài `pg_dump` hoặc đặt biến môi trường `PG_DUMP_BIN` trỏ tới file .exe.",
    );
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`    dùng: ${pgDump}`);

  execFileSync(
    pgDump,
    ["-h", host, "-p", port, "-U", user, "-d", dbName, "-F", "c", "-f", dump],
    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, PGPASSWORD: pass } },
  );
  const size = (fs.statSync(dump).size / 1024 / 1024).toFixed(2);
  console.log(`    xong (${size} MB, ngoài repo)`);

  // --- Ghi: MỘT transaction ----------------------------------------------------
  console.log("\n>>> GHI THẬT (1 transaction)...");
  const result = await prisma.$transaction(async (tx) => {
    const delCus = await tx.$executeRawUnsafe(`DELETE FROM customers WHERE "tenantId" IS NULL`);
    const fixRt = await tx.$executeRawUnsafe(`
      UPDATE refresh_tokens rt SET "tenantId" = u."tenantId"
        FROM users u
       WHERE rt."userId" = u.id
         AND rt."tenantId" IS NULL
         AND u."tenantId" IS NOT NULL`);
    const fixLog = await tx.$executeRawUnsafe(`
      UPDATE audit_logs a SET "tenantId" = u."tenantId"
        FROM users u
       WHERE a."userId" = u.id
         AND a."tenantId" IS NULL
         AND a.action = 'LOGIN'
         AND u."tenantId" IS NOT NULL`);
    return { delCus, fixRt, fixLog };
  });

  console.log(`  customers XOÁ:       ${result.delCus}`);
  console.log(`  refresh_tokens VÁ:   ${result.fixRt}`);
  console.log(`  audit_logs VÁ:       ${result.fixLog}`);

  // --- Chứng minh bằng COUNT chạy lại ---------------------------------------
  const after = await countAll();
  console.log("\n--- COUNT chạy lại SAU khi ghi ---");
  console.table(after);
  const left = after.customers + after.refreshTokens + after.loginAudit;
  console.log(
    left === 0
      ? "=> SẠCH: 0 dòng NULL còn lại trong 3 nhóm này."
      : `=> CÒN ${left} dòng — cần điều tiếp.`,
  );

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});