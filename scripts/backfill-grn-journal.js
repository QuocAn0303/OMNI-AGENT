/**
 * scripts/backfill-grn-journal.js — VÁ BÚT TOÁN CHO GRN ĐÃ POSTED
 *
 * BỐI CẢNH
 * Trước 2026-10-12, `grn.service.post` cộng tồn kho nhưng KHÔNG ghi bút toán và
 * KHÔNG tạo công nợ. Đo trên DB phát triển (`npm run check:accounting`):
 *   tenant `omni-demo-mo-phong`: 39 PO có GRN POSTED, 39 PO không có bút toán nào.
 * Sổ cái vẫn "cân bằng" (Nợ = Có) vì không ghi gì cả — nhưng TK 156 thiếu hết
 * tài sản của hàng đã nhập. Đây là LỆCH DỮ LIỆU, không phải thiếu tính năng.
 *
 * VIỆC NÀY LÀM
 * Với mỗi GRN POSTED còn thiếu bút toán: dựng lại payload bằng đúng hàm
 * `buildGoodsReceiptEntry` (cùng công thức với đường chạy mới) rồi ghi, và đồng
 * bộ công nợ phải trả theo tổng giá trị đã nhận tích luỹ.
 *
 * AN TOÀN
 *   - `assertLocalDb`, DRY-RUN mặc định, `--apply` mới ghi
 *   - `pg_dump` trước khi ghi
 *   - Idempotent: bỏ qua GRN đã có bút toán (khớp `operation = GRN:<id>`)
 *   - Chạy 2 lần phải cho cùng kết quả, lần 2 ghi 0 dòng
 *   - KHÔNG đụng các luồng khác (bút toán `PURCHASE/RECEIVE` của `receive` cũ)
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("backfill-grn-journal");

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const prisma = require("../src/config/prisma");
const { runWithTenant } = require("../src/config/tenantContext");
const autopostService = require("../src/modules/accounting/autopost.service");
const debtService = require("../src/modules/debt/debt.service");
const logger = require("../src/utils/logger");

const APPLY = process.argv.includes("--apply");

/** GRN POSTED chưa có bút toán (khớp chính xác `operation` mà đường mới dùng). */
async function findMissing() {
  return prisma.$queryRawUnsafe(`
    SELECT g.id, g."grnCode", g."purchaseOrderId", po."poCode", po.total,
           t.slug, g."createdAt"::text AS posted_at
      FROM goods_receipt_notes g
      JOIN purchase_orders po ON po.id = g."purchaseOrderId"
      JOIN tenants t ON t.id = g."tenantId"
     WHERE g.status = 'POSTED'
       AND NOT EXISTS (
         SELECT 1 FROM journal_entries je
          WHERE je.source = 'PURCHASE'
            AND je."sourceId" = g."purchaseOrderId"
            AND je.operation = 'GRN:' || g.id::text
       )
     ORDER BY g."createdAt"`);
}

/**
 * PO đã nhận hàng (có GRN POSTED) mà LẪN NÀY còn nợ NCC nhưng chưa có dòng công nợ.
 *
 * Điều kiện `paidAmount < total` là bắt buộc: PO lịch sử trong tập dữ liệu demo
 * được dựng sẵn ở trạng thái `PAID` (đã trả đủ). Đó KHÔNG phải thiếu sót —
 * `createPayableForPoInTx` từ chối đúng, và đếm chúng là "thiếu công nợ" là
 * đo sai (đã xảy ra một lần: 39 PO `PAID` bị báo là thiếu).
 */
async function findDebtsMissing() {
  return prisma.$queryRawUnsafe(`
    SELECT po.id, po."poCode", po.total, po."paidAmount", po."paymentStatus"::text AS pay_status, t.slug
      FROM purchase_orders po
      JOIN tenants t ON t.id = po."tenantId"
     WHERE EXISTS (SELECT 1 FROM goods_receipt_notes g
                    WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED')
       AND po."paidAmount" < po.total
       AND NOT EXISTS (SELECT 1 FROM debts d WHERE d."poId" = po.id)
     ORDER BY po."createdAt"`);
}

async function parseDbUrl(raw) {
  const u = new URL(raw);
  return {
    host: u.hostname || "localhost",
    port: u.port || "5432",
    user: decodeURIComponent(u.username || "postgres"),
    pass: decodeURIComponent(u.password || ""),
    dbName: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

(async () => {
  console.log("\n=== VÁ BÚT TOÁN + CÔNG NỢ CHO GRN ĐÃ POSTED ===\n");
  console.log(`Chế độ: ${APPLY ? "--apply (GHI THẬT)" : "dry-run"}\n`);

  const missing = await findMissing();
  const debtsMissing = await findDebtsMissing();
  console.log(`GRN POSTED thiếu bút toán: ${missing.length}`);
  console.log(`PO có GRN POSTED nhưng thiếu công nợ: ${debtsMissing.length}`);
  if (!missing.length && !debtsMissing.length) {
    console.log("=> Không có gì để vá. Sổ cái đã khớp.");
    await prisma.$disconnect();
    return;
  }

  const byTenant = {};
  for (const m of missing) byTenant[m.slug] = (byTenant[m.slug] || 0) + 1;
  console.log("\nTheo tenant:");
  console.table(byTenant);

  if (!APPLY) {
    console.log("\n--- Kế hoạch (10 dòng đầu) ---");
    for (const m of missing.slice(0, 10)) {
      console.log(`  ${m.grnCode}  PO ${m.poCode}  tổng PO ${Number(m.total).toLocaleString("vi-VN")}`);
    }
    if (missing.length > 10) console.log(`  ... và ${missing.length - 10} dòng nữa`);
    console.log("\nDRY-RUN — chưa ghi gì. Thêm --apply để ghi (chỉ DB local).");
    await prisma.$disconnect();
    return;
  }

  // --- Sao lưu --------------------------------------------------------------
  const c = await parseDbUrl(process.env.DATABASE_URL || "");
  const dir = path.join(os.tmpdir(), "erp-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const dump = path.join(dir, `aduu-before-grn-backfill-${stamp}.dump`);
  const pgDump = process.env.PG_DUMP_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
  console.log(`\n>>> Sao lưu: ${dump}`);
  execFileSync(pgDump, ["-h", c.host, "-p", c.port, "-U", c.user, "-d", c.dbName, "-F", "c", "-f", dump], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, PGPASSWORD: c.pass },
  });
  console.log(`    xong (${(fs.statSync(dump).size / 1024 / 1024).toFixed(2)} MB)`);

  // --- Vá theo từng tenant (bắt buộc có tenant context) ---------------------
  const tenants = [...new Set([...missing.map((m) => m.slug), ...debtsMissing.map((m) => m.slug)])];
  let posted = 0;
  let failed = 0;
  let debts = 0;

  for (const slug of tenants) {
    await runWithTenant(
      (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } })).id,
      async () => {
        const grns = await prisma.goodsReceiptNote.findMany({
          where: { status: "POSTED" },
          select: {
            id: true,
            grnCode: true,
            purchaseOrderId: true,
            items: { select: { passQty: true, purchaseItem: { select: { quantity: true, unitCost: true, taxAmount: true } } } },
            purchaseOrder: { include: { vendor: true, items: true } },
          },
        });

        for (const grn of grns) {
          const already = await prisma.journalEntry.findFirst({
            where: { source: "PURCHASE", sourceId: grn.purchaseOrderId, operation: `GRN:${grn.id}` },
            select: { id: true },
          });
          if (already) continue;

          const payload = autopostService.buildGoodsReceiptEntry({
            grn,
            purchaseOrder: grn.purchaseOrder,
            vendor: grn.purchaseOrder.vendor,
            userId: null,
          });
          if (!payload) continue;
          const { goodsReceiptValue, ...entry } = payload;

          try {
            await autopostService.postBuiltEntry(entry);
            posted += 1;
          } catch (e) {
            failed += 1;
            logger.error(`[backfill] ${grn.grnCode}: ${e.message}`);
          }
        }

        // Đồng bộ công nợ cho các PO có GRN POSTED nhưng chưa có Debt.
        const pos = await prisma.purchaseOrder.findMany({
          where: { grns: { some: { status: "POSTED" } } },
          include: {
            vendor: true,
            items: true,
            grns: { where: { status: "POSTED" }, include: { items: true } },
          },
        });
        for (const po of pos) {
          const existing = await prisma.debt.findFirst({ where: { poId: po.id } });
          if (existing) continue;
          let subtotal = 0;
          let tax = 0;
          for (const g of po.grns) {
            for (const it of g.items) {
              const pi = po.items.find((x) => x.id === it.purchaseItemId);
              const qty = Number(it.passQty || 0);
              if (qty <= 0 || !pi) continue;
              subtotal += qty * Number(pi.unitCost || 0);
              if (Number(pi.quantity) > 0) tax += Number(pi.taxAmount || 0) * (qty / Number(pi.quantity));
            }
          }
          const value = Math.round((subtotal + tax) * 100) / 100;
          if (value <= 0) continue;
          // Chỉ đếm khi hàm THỰC SỰ tạo/cập nhật công nợ. Hàm trả `null` với PO
          // đã trả đủ — đếm cả null là báo cáo sai.
          const debt = await prisma.$transaction((tx) =>
            debtService.createPayableForPoInTx(tx, { po, userId: null, amount: value }),
          );
          if (debt) debts += 1;
        }
      },
    );
  }

  console.log(`\nĐã ghi bút toán: ${posted}`);
  console.log(`Đã tạo công nợ: ${debts}`);
  if (failed) console.log(`THẤT BẠI: ${failed} (xem logs/ để biết lý do)`);
  // PO đã trả đủ không có công nợ là ĐÚNG — nói rõ để không ai đọc nhầm là sót.
  const paidSkipped = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM purchase_orders po
     WHERE EXISTS (SELECT 1 FROM goods_receipt_notes g
                    WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED')
       AND po."paidAmount" >= po.total
       AND NOT EXISTS (SELECT 1 FROM debts d WHERE d."poId" = po.id)`);
  if (paidSkipped[0].n) {
    console.log(`Bỏ qua ${paidSkipped[0].n} PO đã trả đủ (không còn nợ NCC nên không có công nợ)`);
  }

  // --- Chứng minh: chạy lại truy vấn ---------------------------------------
  const afterMissing = await findMissing();
  const afterDebts = await findDebtsMissing();
  console.log(`\n--- Chạy lại sau khi vá ---`);
  console.log(`GRN POSTED còn thiếu bút toán: ${afterMissing.length}`);
  console.log(`PO còn thiếu công nợ: ${afterDebts.length}`);
  console.log(
    afterMissing.length === 0 && afterDebts.length === 0
      ? "=> SẠCH: mọi GRN POSTED đều có bút toán và công nợ."
      : "=> CÒN THIẾU — cần điều tiếp.",
  );

  await prisma.$disconnect();
  if (afterMissing.length || afterDebts.length) process.exit(1);
})().catch(async (e) => {
  logger.error(`[backfill] LỖI: ${e.message}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});