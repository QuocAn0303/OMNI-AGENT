/**
 * docs/aisc26/one-off/cleanup-orphan-auditlogs.js — XOÁ `audit_logs` MỒ CÔI-TENANT
 * do smoke script để lại (P1.1)
 *
 * BỐI CẢNH (có bằng chứng lệnh, không phải suy đoán)
 *   `scripts/lib/teardown.js` mới bắt được rò thật: chạy
 *   `smoke-crm-phase4-hierarchy` rò **6** dòng `audit_logs`, chạy
 *   `smoke-crm-phase4-send` rò **2** dòng, mỗi lần chạy. Nguyên nhân gốc:
 *   `audit_logs` **không có** khoá ngoại tới `tenants` (1/139 bảng scoped có),
 *   nên xoá `tenant` KHÔNG kéo theo log của nó.
 *   Đã sửa ở chính các script đó (xoá `auditLog` TRƯỚC khi xoá tenant). Script
 *   này chỉ dọn 16 dòng mà hai lần chạy đó ĐÃ để lại.
 *
 * AN TOÀN (theo hiến pháp mục 3 của NIGHT-PROMPT.md)
 *   - `assert-local-db`: từ chối chạy nếu DB không phải máy cục bộ.
 *   - dry-run MẶC ĐỊNH; `--apply` mới ghi.
 *   - `EXPECTED` là số đã QUAN SÁT trước khi viết script. Chạy lại `COUNT` ngay
 *     trước khi ghi: lệch ⇒ **hủy toàn bộ**, không ghi gì.
 *   - MỘT transaction.
 *   - CHỉ xoá dòng `tenantId` KHÔNG còn trong `tenants`. Không đụng `NULL`
 *     (124 dòng khai báo ngoại lệ ở `lib/tenant-null-exceptions.js`).
 *
 * CÁCH DÙNG
 *   node docs/aisc26/one-off/cleanup-orphan-auditlogs.js            # dry-run
 *   node docs/aisc26/one-off/cleanup-orphan-auditlogs.js --apply
 */

require("dotenv").config();
const path = require("path");
const { assertLocalDb } = require(path.join(__dirname, "..", "..", "..", "scripts", "lib", "assert-local-db"));
assertLocalDb("cleanup-orphan-auditlogs");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

/**
 * Số dòng mồ côi đã quan sát trước khi ghi, theo từng lần:
 *   - lần 1: 16 = 2 lần chạy × (hierarchy 6 + send 2) sau khi thêm verify.
 *   - lần 2: 6  = 1 lần chạy `smoke-crm-phase4-hierarchy` ở **HEAD** (đã
 *     `git stash` phần sửa) → rò 6 dòng y hệt ⇒ bằng chứng rò có **trước** P1,
 *     không phải do `lib/teardown.js` sinh ra.
 * Số kỳ vọng phải bằng số QUAN SÁT gần nhất; lệch ⇒ hủy toàn bộ.
 */
const EXPECTED = 6;

const APPLY = process.argv.includes("--apply");

const url = new URL(process.env.DATABASE_URL);
const pool = new Pool({
  host: url.hostname,
  port: parseInt(url.port || "5432", 10),
  database: url.pathname.slice(1).split("?")[0],
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ORPHAN_WHERE = `
  a."tenantId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = a."tenantId")`;

const count = async (client) => {
  const r = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM audit_logs a WHERE ${ORPHAN_WHERE}`,
  );
  return r[0].n;
};

const main = async () => {
  console.log(`\n=== DON RAC audit_logs MO COI-TENANT (${APPLY ? "--apply" : "dry-run"}) ===`);
  const n = await count(prisma);
  console.log(`Dong mo coi hien tai: ${n} (EXPECTED = ${EXPECTED})`);

  const byAction = await prisma.$queryRawUnsafe(`
    SELECT a.action, a.entity, count(*)::int AS n,
           min(a."createdAt")::text AS minAt, max(a."createdAt")::text AS maxAt
      FROM audit_logs a WHERE ${ORPHAN_WHERE}
     GROUP BY 1, 2 ORDER BY 3 DESC`);
  // Prisma trả key của raw SQL ở dạng CHỮ THƯỜNG (alias `minAt` -> `minat`).
const ts = (v) => (v instanceof Date ? v.toISOString() : String(v ?? "?"));
  for (const r of byAction) {
    console.log(`  ${String(r.action).padEnd(28)} ${String(r.entity).padEnd(18)} n=${r.n}  ${ts(r.minat)} -> ${ts(r.maxat)}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — chua xoa gi. Them --apply de xoa.");
    await prisma.$disconnect();
    return;
  }

  if (n !== EXPECTED) {
    console.error(
      `\nHUY TOAN BO: COUNT chay lai = ${n}, khong bang EXPECTED = ${EXPECTED}.\n` +
      `Lech so => co nguon rac moi; phai xem lai bang chung truoc khi xoa.`,
    );
    await prisma.$disconnect();
    process.exit(2);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const r = await tx.$executeRawUnsafe(`DELETE FROM audit_logs a WHERE ${ORPHAN_WHERE}`);
    return r;
  });
  const after = await count(prisma);
  console.log(`\nDa xoa ${deleted} dong. Con lai: ${after}`);
  await prisma.$disconnect();
  process.exit(after === 0 ? 0 : 2);
};

main().catch(async (e) => {
  console.error("LOI:", e.message);
  try { await prisma.$disconnect(); } catch { /* bo qua */ }
  process.exit(1);
});