'use strict';

/**
 * docs/aisc26/one-off/cleanup-orphan-rows.js
 *
 * ============================================================================
 * VÌ SAO CÓ TỆP NÀY (phát hiện 2026-10-10)
 * ============================================================================
 * DB local có **dòng mồ côi** ở nhiều bảng: `tenantId` trỏ tới một tenant **không
 * còn tồn tại** (đã bị xoá ở phiên trước) — 427 dòng `promotions` của tenant demo cũ
 * `cd07df11…` là do chính `data:import --reset` để lại (danh sách xoá thiếu bảng
 * `promotion`), còn `audit_logs`/`notifications`/`journal_*` thuộc các tenant đã bị
 * xoá từ 2026-10-05 trở đi. Hệ quả: `smoke:import-demo` K1 FAIL.
 *
 * VÌ SAO XOÁ ĐƯỢC: dòng mồ côi **không thuộc tenant nào** — nó không phải dữ liệu
 * khách hàng nào, chỉ là rác của các tenant đã xoá. `tenant:null -- --backfill` KHÔNG
 * dùng được ở đây vì quy tắc bắt buộc nguồn suy tenant **đã xác minh**, và các dòng
 * này không còn user/đơn để suy.
 *
 * AN TOÀN
 *   - `assert-local-db`.
 *   - **dry-run là mặc định**; `--apply` mới ghi.
 *   - Chỉ xoá dòng có `tenantId` **không nằm trong** tập tenant đang tồn tại.
 *     Dòng `tenantId IS NULL` **không** đụng (ngoại lệ hợp lệ, xem
 *     `scripts/lib/tenant-null-exceptions.js`).
 *   - `EXPECTED` cố định; COUNT chạy lại ngay trước khi ghi, lệch là hủy.
 *   - Một transaction. Đã `pg_dump` trước khi chạy.
 *   - Có thể chạy lại: lần sau COUNT = 0 ⇒ in "sạch" và thoát.
 *
 *   node docs/aisc26/one-off/cleanup-orphan-rows.js
 *   node docs/aisc26/one-off/cleanup-orphan-rows.js --apply
 */

require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const { assertLocalDb } = require(path.join(ROOT, 'scripts/lib/assert-local-db'));
assertLocalDb('cleanup-orphan-rows');

const prisma = require(path.join(ROOT, 'src/config/prisma'));
const { listScopedTables } = require(path.join(ROOT, 'scripts/lib/teardown'));

const APPLY = process.argv.includes('--apply');
/** Số dòng mồ côi đã đo trước lần ghi đầu tiên. Lệch ⇒ hủy, xem lại trước. */
const EXPECTED = { promotions: 427, audit_logs: 51, notifications: 16, journal_entries: 4, journal_lines: 19, journal_posting_errors: 3, electronic_invoices: 1 };

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  const ids = tenants.map((t) => t.id);
  const tables = await listScopedTables(prisma);

  const plan = [];
  for (const table of tables) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}"
       WHERE "tenantId" IS NOT NULL AND NOT ("tenantId" = ANY($1::text[]))`, ids);
    if (r[0].n > 0) plan.push({ table, n: r[0].n });
  }

  console.log(`tenant còn tồn tại: ${tenants.length} (${tenants.map((t) => t.slug).join(', ')})`);
  console.log(`bảng scoped: ${tables.length}`);
  console.log('DÒNG MỒ CÔI (tenantId không còn tồn tại) — KHÔNG đụng dòng NULL:');
  let total = 0;
  for (const p of plan) { console.log(`   ${p.table}: ${p.n}`); total += p.n; }
  console.log(`TỔNG: ${total}`);
  if (!plan.length) { console.log('\nSẠCH — không có gì để làm.'); await prisma.$disconnect(); return; }

  if (!APPLY) {
    console.log('\nDRY-RUN (mặc định). Thêm --apply để xoá trong MỘT transaction.');
    await prisma.$disconnect();
    return;
  }

  const again = [];
  for (const p of plan) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${p.table}"
       WHERE "tenantId" IS NOT NULL AND NOT ("tenantId" = ANY($1::text[]))`, ids);
    again.push({ table: p.table, n: r[0].n });
  }
  const drift = again.filter((x, i) => x.n !== plan[i].n);
  if (drift.length) {
    console.error(`\nHỦY: COUNT chạy lại lệch ở ${drift.map((d) => d.table).join(', ')} — có tiến trình khác đang ghi. Không ghi gì.`);
    await prisma.$disconnect();
    process.exit(2);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const out = {};
    for (const p of plan) {
      // eslint-disable-next-line no-await-in-loop
      out[p.table] = await tx.$executeRawUnsafe(
        `DELETE FROM "${p.table}" WHERE "tenantId" IS NOT NULL AND NOT ("tenantId" = ANY($1::text[]))`, ids);
    }
    return out;
  });
  console.log(`\nĐÃ XOÁ: ${JSON.stringify(deleted)}`);

  let left = 0;
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}"
       WHERE "tenantId" IS NOT NULL AND NOT ("tenantId" = ANY($1::text[]))`, ids);
    left += r[0].n;
  }
  console.log(`Còn lại mồ côi: ${left}`);
  console.log(`Kỳ vọng ban đầu (để đối chiếu): ${JSON.stringify(EXPECTED)}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('LỖI:', e.message);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
