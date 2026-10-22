/**
 * scripts/check-accounting-integrity.js — ĐỒNG BỘ GIỚI KHO VÀ KẾ TOÁN (chỉ đọc)
 *
 * CÂU HỎI: mỗi lần tồn kho TĂNG từ nhập hàng, có bút toán tương ứng (Nợ 156 /
 * Có 331) hay không?
 *
 * VÌ SAO CẦN (phát hiện 2026-10-12): có HAI đường nhập kho từ PO
 *   1. `POST /api/purchase-orders/:id/receive` → `purchase.service.receive`
 *      ⇒ cộng tồn kho + tạo Debt + ĐĂNG BÚT TOÁN qua `autopost`.
 *   2. `POST /api/grn` → `recordQc` → `post` → `grn.service.post`
 *      ⇒ cộng tồn kho, KHÔNG Debt, KHÔNG bút toán.
 * Nếu (2) là đường được dùng thì sổ cái lệch: hàng vào kho mà không ghi Nợ tài
 * sản. Đây là hệ quả nghiêm trọng hơn nhiều so với việc thiếu tính năng.
 *
 * Script KHÔNG tự sửa — chỉ đo và báo cáo. Số liệu dùng để trình bày và để quyết
 * định cách sửa.
 */
require("dotenv").config();
const { assertLocalDb } = require("./lib/assert-local-db");
assertLocalDb("check-accounting-integrity");

const prisma = require("../src/config/prisma");
const q = (sql) => prisma.$queryRawUnsafe(sql);

(async () => {
  console.log("\n=== ĐỒNG BỘ GIỚI KHO ↔ KẾ TOÁN (chỉ đọc) ===\n");

  // 1. PO nhập kho theo từng đường
  console.log("--- 1. PO đã nhập kho: đường nào? ---");
  const byPath = await q(`
    SELECT t.slug,
           count(*) FILTER (WHERE po.status = 'RECEIVED')::int AS po_received,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM goods_receipt_notes g
              WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED'
           ))::int AS co_grn_posted,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM goods_receipt_notes g
              WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED'
           ) AND NOT EXISTS (
             SELECT 1 FROM journal_entries je
              WHERE je."sourceId" = po.id AND je.source = 'PURCHASE'
           ))::int AS GRN_nhung_khong_co_butoan,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM journal_entries je
              WHERE je."sourceId" = po.id AND je.source = 'PURCHASE'
           ))::int AS co_butoan_purchase
      FROM purchase_orders po
      JOIN tenants t ON t.id = po."tenantId"
     GROUP BY 1 ORDER BY 1`);
  console.table(byPath);

  // 2. Bút toán nào đã ghi, còn "trong hàng trên đường" chưa gì
  console.log("\n--- 2. Chi tiết các PO có GRN POSTED nhưng KHÔNG có bút toán ---");
  const missing = await q(`
    SELECT t.slug, po."poCode", po.status, po.total, po."receivedAt"::text AS received_at,
           (SELECT count(*) FROM goods_receipt_notes g
             WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED')::int AS grn_posted,
           (SELECT coalesce(sum(gitems."receivedQty"),0) FROM goods_receipt_items gitems
              JOIN goods_receipt_notes g2 ON g2.id = gitems."grnId"
             WHERE g2."purchaseOrderId" = po.id AND g2.status = 'POSTED')::int AS so_luong_nhan,
           EXISTS (SELECT 1 FROM debts d WHERE d."poId" = po.id) AS co_debt_phai_tra
      FROM purchase_orders po
      JOIN tenants t ON t.id = po."tenantId"
     WHERE EXISTS (SELECT 1 FROM goods_receipt_notes g
                    WHERE g."purchaseOrderId" = po.id AND g.status = 'POSTED')
       AND NOT EXISTS (SELECT 1 FROM journal_entries je
                        WHERE je."sourceId" = po.id AND je.source = 'PURCHASE')
     ORDER BY po."createdAt" DESC LIMIT 15`);
  console.table(missing);

  // 3. Thử cân bằng sổ cái
  console.log("\n--- 3. Cân bằng sổ cái (tổng Nợ vs tổng Có) ---");
  const bal = await q(`
    SELECT sum(jl.debit)::numeric(14,2) AS tong_no,
           sum(jl.credit)::numeric(14,2) AS tong_co,
           round(sum(jl.debit) - sum(jl.credit), 2)::numeric(14,2) AS chenh_lenh
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl."entryId"
     WHERE je.status = 'POSTED'`);
  console.table(bal);

  // 4. Giá trị tồn kho trên sổ cái (TK 156) so với giá trị tồn kho thực tế
  console.log("\n--- 4. TK 156 (Hàng tồn kho) trên sổ cái ---");
  const t156 = await q(`
    SELECT a.code, a.name, coalesce(sum(jl.debit),0)::numeric(14,2) AS no,
           coalesce(sum(jl.credit),0)::numeric(14,2) AS co
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl."entryId"
      JOIN accounts a ON a.id = jl."accountId"
     WHERE je.status = 'POSTED' AND a.code IN ('156','1331','331')
     GROUP BY a.code, a.name ORDER BY a.code`);
  console.table(t156);

  const invVal = await q(`
    SELECT count(*)::int AS so_dong,
           sum(i.quantity)::bigint AS tong_so_luong
      FROM inventories i WHERE i.quantity <> 0`);
  console.table(invVal);

  // 5. Tổng quan GRN hiện có
  console.log("\n--- 5. GRN theo trạng thái ---");
  const grn = await q(`
    SELECT status, count(*)::int AS n FROM goods_receipt_notes GROUP BY 1 ORDER BY 1`);
  console.table(grn);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("LỖI:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});