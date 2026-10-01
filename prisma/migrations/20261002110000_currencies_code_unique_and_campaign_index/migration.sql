-- CRM audit H11 — vá drift `currencies.code` và khai index campaign trong schema
--
-- Vì sao có migration này:
--  1. `prisma/schema.prisma` khai `Currency.code @unique` (nên Prisma sinh
--     `currencies_code_key`) nhưng DB THỰC TẾ không có index đó. Hệ quả:
--     `POST /api/currencies` dùng `upsert({ where: { code } })` nên **luôn fail 500**
--     — endpoint chết hoàn toàn. `migrate deploy` báo "up to date" vì nó chỉ so
--     `_prisma_migrations` với thư mục, KHÔNG so schema với DB thật. Phải dùng
--     `prisma migrate diff` mới lộ (xem `scripts/verify.js`).
--  2. Index `campaign_recipients_campaignId_unsubscribedAt_idx` có trong DB (do
--     migration 20261001120000 tạo) nhưng schema không khai báo ⇒ `migrate dev` sẽ
--     đề xuất DROP. Schema đã được sửa ở `prisma/schema.prisma`; migration này
--     chỉ tạo index nếu DB thiếu (idempotent).
--
-- Migration này KHÔNG xoá bản ghi currency nào: bản ghi trùng `code` sẽ được
-- set `isActive = false` (ẩn khỏi danh sách, giữ tồn tại) và RAISE NOTICE.

-- ============================================================
-- 1. Báo cáo + xử lý trùng `code`
-- ============================================================

DO $$
DECLARE
  dup_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "code" FROM "currencies" GROUP BY "code" HAVING COUNT(*) > 1
  ) t;

  IF dup_count > 0 THEN
    RAISE NOTICE
      'currencies: % mã tiền tệ bị trùng — giữ bản ghi CŨ nhất mỗi mã, các bản ghi còn lại set isActive=false.',
      dup_count;
  END IF;
END $$;

WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "code" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "currencies"
)
UPDATE "currencies" c
SET "isActive" = false
FROM ranked r
WHERE c."id" = r."id" AND r.rn > 1;

-- ============================================================
-- 2. Tạo unique index (idempotent cho cả DB đã có lẫn DB thiếu)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS "currencies_code_key" ON "currencies"("code");

-- ============================================================
-- 3. Index campaign (migration 20261001120000 đã tạo; đây chỉ để chắc chắn)
-- ============================================================

CREATE INDEX IF NOT EXISTS "campaign_recipients_campaignId_unsubscribedAt_idx"
  ON "campaign_recipients"("campaignId", "unsubscribedAt");