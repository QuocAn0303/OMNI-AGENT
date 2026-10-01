-- CRM audit fix H10 — unique (mobileNo, tenantId) và (email, tenantId) cho `crm_leads`
--
-- Nguyên nhân: `leadsService.importList` dùng
--   `createMany({ data, skipDuplicates: true })`
-- nhưng KHÔNG có `@@unique` nào trên `CrmLead.mobileNo`/`email` → Postgres không
-- có gì để conflict → `skipDuplicates` là no-op. Import/webhook song song tạo lead
-- trùng. `lead-capture.service` cũng TOCTOU (findFirst rồi create).
--
-- Postgres coi NULL khác nhau trong unique index ⇒ lead không có SĐT/email vẫn tạo
-- được vô hạn. Đúng như mong muốn (không phải mọi lead đều có SĐT).
--
-- LƯU Ý: migration này TRÙNG DẸP dữ liệu sẵn có trước khi tạo index (không xoá
-- dòng). Bản ghi cũ nhất theo `createdAt` GIỮ LẠI giá trị; các bản ghi trùng
-- được set NULL (không phá record) và được RAISE NOTICE để admin đối chiếu.

-- ============================================================
-- 1. Trùng SĐT → set NULL cho bản ghi trùng, giữ bản ghi cũ nhất
-- ============================================================

WITH ranked AS (
  SELECT i."id",
         ROW_NUMBER() OVER (
           PARTITION BY i."tenantId", i."mobileNo"
           ORDER BY i."createdAt" ASC, i."id" ASC
         ) AS rn
  FROM "crm_leads" i
  WHERE i."mobileNo" IS NOT NULL AND btrim(i."mobileNo") <> ''
)
UPDATE "crm_leads" l
SET "mobileNo" = NULL
FROM ranked r
WHERE l."id" = r."id" AND r.rn > 1;

-- ============================================================
-- 2. Trùng email → set NULL cho bản ghi trùng, giữ bản ghi cũ nhất
-- ============================================================
-- Partition theo GIÁ TRỊ THÔ (không LOWER) để khớp chính xác unique index ở mục 3.
-- `CrmLead.email` không được chuẩn hoá case khi ghi (`leads.service.js` gán thẳng
-- `data.email`), nên index cũng phải theo giá trị thô — nếu không, migration sẽ
-- FAIL vì còn dữ liệu trùng mà index không chặn.

WITH ranked AS (
  SELECT i."id",
         ROW_NUMBER() OVER (
           PARTITION BY i."tenantId", i."email"
           ORDER BY i."createdAt" ASC, i."id" ASC
         ) AS rn
  FROM "crm_leads" i
  WHERE i."email" IS NOT NULL AND btrim(i."email") <> ''
)
UPDATE "crm_leads" l
SET "email" = NULL
FROM ranked r
WHERE l."id" = r."id" AND r.rn > 1;

DO $$
DECLARE
  nulled_mobile BIGINT;
  nulled_email  BIGINT;
BEGIN
  SELECT COUNT(*) INTO nulled_mobile
  FROM "crm_leads" WHERE "mobileNo" IS NULL AND "email" IS NULL;

  SELECT COUNT(*) INTO nulled_email FROM "crm_leads" WHERE "email" IS NULL;
  RAISE NOTICE
    'crm_leads: đã set NULL mobileNo/email cho bản ghi trùng. Tổng số lead không còn email = %.',
    nulled_email;
  RAISE NOTICE 'crm_leads: tổng số lead không có cả SĐT lẫn email = %.', nulled_mobile;
END $$;

-- ============================================================
-- 3. Unique index (khớp tên Prisma sinh cho @@unique trong schema.prisma)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS "crm_leads_mobileNo_tenantId_key"
  ON "crm_leads"("mobileNo", "tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "crm_leads_email_tenantId_key"
  ON "crm_leads"("email", "tenantId");