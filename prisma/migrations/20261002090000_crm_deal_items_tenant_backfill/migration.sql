-- CRM audit fix C3 — backfill `crm_deal_items.tenantId`
--
-- Nguyên nhân: `dealsService.create` từng dùng NESTED WRITE
--   `crmDeal.create({ data: { items: { create: items } } })`.
-- Prisma extension trong `src/config/prisma.js` chỉ bọc operation cấp cao nhất
-- (`crmDeal.create`) nên dòng con `crm_deal_items` KHÔNG được inject `tenantId`.
--
-- Hậu quả: các dòng đó có `tenantId = NULL`, còn `upsertItems` gọi
--   `crmDealItem.deleteMany({ where: { dealId } })` — bị extension ép
--   `tenantId = <tid>` nên KHÔNG xoá được dòng NULL → mỗi lần bấm "Lưu danh sách
--   sản phẩm" danh sách nhân đôi.
--
-- Migration này chỉ gán `tenantId` cho dòng con từ `tenantId` của deal cha.
-- KHÔNG xoá dòng nào. Service đã sửa ở `deals.service.js` (create dùng
-- `createMany` top-level trong transaction) nên dòng mới luôn có `tenantId`.

-- ============================================================
-- 1. Backfill từ deal cha
-- ============================================================

UPDATE "crm_deal_items" i
SET "tenantId" = d."tenantId"
FROM "crm_deals" d
WHERE i."dealId" = d."id"
  AND i."tenantId" IS NULL
  AND d."tenantId" IS NOT NULL;

-- ============================================================
-- 2. Báo cáo dòng vẫn còn NULL (không chặn migration)
-- ============================================================
-- Dòng còn NULL nghĩa là: deal cha cũng NULL, hoặc deal đã bị xoá (mồ côi).
-- Cột `tenantId` giữ nullable vì SUPER_OMEGA bypass tenant-scoping khi ghi —
-- giữ nguyên lịch sử dữ liệu thay vì để migration FAIL trên dữ liệu bẩn.
-- `deals.service.js:dealItemDeleteScope` đã quét cả 2 trạng thái nên các dòng
-- NULL này vẫn bị xoá đúng khi sửa danh sách sản phẩm.

DO $$
DECLARE
  remaining BIGINT;
BEGIN
  SELECT COUNT(*) INTO remaining FROM "crm_deal_items" WHERE "tenantId" IS NULL;
  IF remaining > 0 THEN
    RAISE NOTICE
      'crm_deal_items: backfill xong, còn % dòng tenantId IS NULL (deal cha NULL hoặc mồ côi) — sẽ tự được xoá khi upsertItems chạy.',
      remaining;
  END IF;
END $$;