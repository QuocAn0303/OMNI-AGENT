/**
 * scripts/fix-null-journal-tenant.js — GÁN TENANT CHO BÚT TOÁN `tenantId = NULL`
 *
 * BỐI CẢNH (đo 2026-10-12)
 * 18 dòng `journal_entries` có `tenantId = NULL` do `scripts/demo/demo-setup.js`
 * gọi `autopostService.postBuiltEntry` NGOÀI `runWithTenant` (lỗi đã sửa trong
 * demo-setup). Hậu quả kép:
 *   1. sổ cái của tenant demo không thấy 18 bút toán đó (thiếu tài sản/công nợ);
 *   2. vì `entryCode` unique TOÀN CỤC mà bộ đếm lại đọc toàn cục, các mã
 *      `JE-...-0040..0057` bị "chiếm" ⇒ tenant demo sinh mã trùng ⇒ P2002.
 *
 * CÁCH SỬA
 * Bút toán nhập hàng luôn có `source = 'PURCHASE'` và `sourceId` = PO. PO thì
 * luôn có `tenantId` ⇒ suy ra tenant CHÍNH XÁC từ dữ liệu, không đoán.
 * Dòng không suy được thì BÁO, không tự xoá (xoá bút toán là mất chứng tứ kế toán).
 *
 * Idempotent + dry-run mặc định.
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("fix-null-journal-tenant");

const prisma = require("../src/config/prisma");
const APPLY = process.argv.includes("--apply");

(async () => {
  console.log("\n=== GÁN TENANT CHO BÚT TOÁN tenantId NULL ===\n");
  console.log(`Chế độ: ${APPLY ? "--apply (GHI THẬT)" : "dry-run"}\n`);

  const rows = await prisma.$queryRawUnsafe(`
    SELECT je.id, je."entryCode", je.source::text AS source, je.description,
           coalesce(po."tenantId", ord."tenantId") AS suy_tenant,
           coalesce(po."poCode", ord."orderCode") AS tai_lieu
      FROM journal_entries je
      LEFT JOIN purchase_orders po
             ON je.source = 'PURCHASE' AND je."sourceId" = po.id
      LEFT JOIN orders ord
             ON je.source = 'ORDER' AND je."sourceId" = ord.id
     WHERE je."tenantId" IS NULL
     ORDER BY je."entryCode"`);

  console.log(`journal_entries tenantId NULL: ${rows.length}`);
  if (!rows.length) {
    console.log("=> Không còn bút toán NULL. Vẫn kiểm tra dòng chi tiết + audit con.");
  }

  const rowsum = rows.map((r) => ({
    ...r,
    suy_tenant: r.suy_tenant ? r.suy_tenant.slice(0, 8) + "…" : null,
  }));
  if (rows.length) console.table(rowsum);

  const unresolvable = rows.filter((r) => !r.suy_tenant);
  console.log(`\nSuy được tenant từ PO/đơn: ${rows.length - unresolvable.length}`);
  console.log(`KHÔNG suy được (cần người xử lý, KHÔNG tự đoán/xoá): ${unresolvable.length}`);

  if (!APPLY) {
    console.log("\nDRY-RUN — chưa ghi gì. Thêm --apply để ghi (chỉ DB local).");
    await prisma.$disconnect();
    return;
  }

  let fixed = 0;
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      if (!r.suy_tenant) continue;
      const res = await tx.$executeRawUnsafe(
        `UPDATE journal_entries SET "tenantId" = $1 WHERE id = $2 AND "tenantId" IS NULL`,
        r.suy_tenant,
        r.id,
      );
      fixed += res;
    }

    // Bút toán đã có tenant thì DÒNG CHI TIẾT (journal_lines) và bản ghi audit
    // sinh ra từ nó cũng phải theo — gán theo CHA, không suy đoán riêng.
    const lines = await tx.$executeRawUnsafe(`
      UPDATE journal_lines l SET "tenantId" = je."tenantId"
        FROM journal_entries je
       WHERE l."entryId" = je.id AND l."tenantId" IS NULL AND je."tenantId" IS NOT NULL`);
    const logs = await tx.$executeRawUnsafe(`
      UPDATE audit_logs a SET "tenantId" = je."tenantId"
        FROM journal_entries je
       WHERE a.entity = 'JournalEntry' AND a."entityId" = je.id
         AND a."tenantId" IS NULL AND je."tenantId" IS NOT NULL`);
    console.log(`  journal_lines gán theo cha: ${lines}`);
    console.log(`  audit_logs (POST_JOURNAL_ENTRY) gán theo cha: ${logs}`);
  });

  const after = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM journal_entries WHERE "tenantId" IS NULL) AS je,
      (SELECT count(*)::int FROM journal_lines  WHERE "tenantId" IS NULL) AS jl,
      (SELECT count(*)::int FROM audit_logs     WHERE "tenantId" IS NULL) AS al`);
  console.log(`\nĐã gán tenant cho: ${fixed} bút toán`);
  console.log("COUNT chạy lại — tenantId NULL:", JSON.stringify(after[0]));
  const left = after[0].je + after[0].jl + after[0].al;
  console.log(left === 0 ? "=> SẠCH." : `=> còn ${left} dòng cần người xử lý.`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});