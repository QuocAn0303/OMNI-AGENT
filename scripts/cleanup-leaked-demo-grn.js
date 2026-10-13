/**
 * scripts/cleanup-leaked-demo-grn.js — DỌN PHIẾU NHẬP KHO SÓT DO LẦN CHẠY LỖI
 *
 * BỐI CẢNH (2026-10-13):
 * Trước khi sửa cơ chế dọn, hai lần chạy luồng demo bị lỗi giữa chừng đã để lại
 * 2 phiếu GRN ở trạng thái POSTED + 2 đơn mua + 2 bút toán + 2 dòng công nợ.
 * `demo:check` KHÔNG bắt được vì nó chỉ so sánh trước và sau lần chạy của chính nó.
 *
 * ⚠️ BÀI HỌC TỪ CHỔI NÀY:
 * Bản đầu tiên của script lọc theo mã id (`:grn-po-demo-hist-`) và **KHÔNG khớp**
 * với dữ liệu `demo:setup` thật — id thật là `:grn-lich-su-*` / `:po-lich-su-*`.
 * Dry-run lộ ra 5 phiếu thay vì 2, trong đó 3 phiếu là dữ liệu lịch sử cấp lead
 * time đo được cho luồng demo. Đây đúng loại lỗi Mốc 10 cấm: xoá nhầm dữ liệu có
 * chủ đích vì bộ lọc viết tay không khớp thực tế. **Luôn dry-run trước khi --apply.**
 *
 * PHẠM VI AN TOÀN — chỉ xoá phiếu thỏa cả BA điều kiện:
 *   1. tenant = `omni-demo-mo-phong` (tenant MÔ PHỎNG, không phải doanh nghiệp thật);
 *   2. PO có `note` chứa `[gate:` — DẤU HIỆU DUY NHẤT do luồng demo sinh ra
 *      (`executeGate` ghi note này khi tạo PO). Dữ liệu `demo:setup` dựng có chủ
 *      đích có note `"Lịch sử nhập cho luồng demo (MÔ PHỎNG…"` ⇒ KHÔNG khớp;
 *   3. PO CHƯA ở trạng thái `RECEIVED` — PO lịch sử đã `RECEIVED`, PO sót thì chưa
 *      kịp hoàn tất vòng nhập.
 *
 * Mặc định DRY-RUN. `--apply` mới ghi, và có `pg_dump` trước khi ghi.
 */
require('dotenv').config();
const { assertLocalDb } = require('./lib/assert-local-db');
assertLocalDb('cleanup-leaked-demo-grn');

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const apply = process.argv.includes('--apply');
const TENANT_SLUG = 'omni-demo-mo-phong';
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.env.TEMP || '.', 'erp-backups');

const FIND = `
  SELECT g.id, g."grnCode", g."purchaseOrderId", g."createdAt", g.status,
         po."poCode", po.status AS po_status
    FROM goods_receipt_notes g
    JOIN purchase_orders po ON po.id = g."purchaseOrderId"
   WHERE po."tenantId" = (SELECT id FROM tenants WHERE slug = '${TENANT_SLUG}')
     AND po.note LIKE '%[gate:%'
     AND po.status <> 'RECEIVED'
   ORDER BY g."createdAt" DESC`;

/**
 * Tìm `pg_dump`. Trên Windows nó thường KHÔNG nằm trong PATH (kiểm 2026-10-13:
 * `Get-Command pg_dump` trả về không có, dump cũ vẫn tồn tại nghĩa là lần trước
 * chạy được từ shell đã có PATH). Tự dò trong `C:\Program Files\PostgreSQL\*\bin`.
 * Không tìm thấy ⇒ DỪNG, không ghi gì.
 */
const resolvePgDump = () => {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  // `where`/`which` **ném lỗi** khi không tìm thấy, không trả về rỗng — phải bọc.
  let probe = null;
  try {
    probe = execSync(process.platform === 'win32' ? 'where pg_dump' : 'which pg_dump', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().split(/\r?\n/)[0];
  } catch {
    probe = null;
  }
  if (probe && fs.existsSync(probe)) return probe;
  const root = process.env.ProgramFiles || 'C:\\Program Files';
  const base = path.join(root, 'PostgreSQL');
  if (!fs.existsSync(base)) return null;
  const found = fs.readdirSync(base)
    .map((v) => path.join(base, v, 'bin', 'pg_dump.exe'))
    .find((v) => fs.existsSync(v));
  return found || null;
};

(async () => {
  console.log(`\n=== DỌN PHIẾU NHẬP KHO SÓT (${apply ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const rows = await prisma.$queryRawUnsafe(FIND);
  if (!rows.length) {
    console.log('Không có phiếu nào dính điều kiện. Không ghi gì.');
    await prisma.$disconnect();
    return;
  }
  console.table(rows);
  console.log(`Tổng: ${rows.length} phiếu\n`);

  if (!apply) {
    console.log('DRY-RUN — chạy lại với --apply để ghi.');
    await prisma.$disconnect();
    return;
  }

  // Sao lưu trước khi ghi (quy tắc Mốc 10: luôn có dump trước thao tác dữ liệu).
  const pgDump = resolvePgDump();
  if (!pgDump) {
    console.error('KHÔNG tìm thấy pg_dump — DỪNG, không ghi gì.');
    console.error('Đặt biến môi trường PG_DUMP sang đường dẫn đầy đủ, ví dụ:');
    console.error('  $env:PG_DUMP="C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe"');
    await prisma.$disconnect();
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
  const dump = path.join(BACKUP_DIR, `aduu-before-leaked-grn-cleanup-${stamp}.dump`);
  // `?schema=public` là tham số CHỈ Prisma hiểu; `pg_dump` từ chối
  // ("invalid URI query parameter"). Bỏ nó đi trước khi gọi.
  const dbUrl = String(process.env.DATABASE_URL || '').replace(/\?schema=public/, '');
  try {
    execFileSync(pgDump, ['-Fc', '-d', dbUrl, '-f', dump], { stdio: 'ignore' });
    const size = fs.statSync(dump).size;
    if (size < 1000) throw new Error(`dump quá nhỏ (${size} byte) — coi như không sao lưu được`);
    console.log(`Đã sao lưu: ${dump} (${Math.round(size / 1024)} KB)`);
  } catch (e) {
    console.error('KHÔNG sao lưu được — DỪNG, không ghi gì.');
    console.error(e.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  const grnIds = rows.map((r) => r.id);
  const poIds = rows.map((r) => r.purchaseOrderId);
  const deleted = await prisma.$transaction(async (tx) => {
    const out = {};
    // Thứ tự con trước cha. `goods_receipt_items.purchaseItemId` là FK RESTRICT.
    out.items = (await tx.goodsReceiptItem.deleteMany({ where: { grnId: { in: grnIds } } })).count;
    out.notes = (await tx.goodsReceiptNote.deleteMany({ where: { id: { in: grnIds } } })).count;
    out.purchaseItems = (await tx.purchaseItem.deleteMany({
      where: { purchaseOrderId: { in: poIds } },
    })).count;
    out.purchaseOrders = (await tx.purchaseOrder.deleteMany({ where: { id: { in: poIds } } })).count;
    return out;
  });
  console.log('Đã xoá:', deleted);

  // Bút toán, công nợ và audit tương ứng đã được `purgeFlowResidue` của luồng dọn
  // theo cửa sổ thời gian. Kiểm lại bằng `npm run check:accounting` — số PO
  // thiếu bút toán phải bằng 0.
  const after = await prisma.$queryRawUnsafe(FIND);
  console.log(`Còn lại sau khi dọn: ${after.length} phiếu`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('LỖI:', e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});