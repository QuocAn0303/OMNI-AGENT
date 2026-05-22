-- Finance hardening: JournalEntry idempotency
-- ============================================
-- Mục tiêu: ngăn chặn duplicate journal entry khi cùng business event
-- được trigger 2 lần (race condition, retry mạng, outbox retry...).

-- 1. Thêm cột operation. PRIMARY là bút toán chính.
--    Multi-step events (vd Expense: ACCRUAL + PAYMENT) dùng operation khác.
ALTER TABLE "journal_entries" ADD COLUMN "operation" TEXT NOT NULL DEFAULT 'PRIMARY';

-- 2. Back-fill operation cho dữ liệu cũ
--    Bút toán đảo (đã có description prefix [ĐẢO]) → REVERSAL
UPDATE "journal_entries"
SET "operation" = 'REVERSAL'
WHERE "description" LIKE '[ĐẢO]%' OR "reversedById" IS NOT NULL;

--    Bút toán thanh toán chi phí → PAYMENT (phân biệt với accrual)
UPDATE "journal_entries"
SET "operation" = 'PAYMENT'
WHERE "source" = 'EXPENSE'
  AND "description" LIKE 'Thanh toan chi phi%'
  AND "operation" = 'PRIMARY';

--    Bút toán thanh toán PO → PAYMENT
UPDATE "journal_entries"
SET "operation" = 'PAYMENT'
WHERE "source" = 'PURCHASE'
  AND "description" LIKE 'Thanh toan PO%'
  AND "operation" = 'PRIMARY';

-- 3. Khử trùng dữ liệu cũ trước khi tạo unique index.
--    Nếu có duplicates (source, sourceId, operation), giữ bản OLDEST và mark
--    các bản còn lại là REVERSED.
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "source", "sourceId", "operation"
           ORDER BY "createdAt"
         ) AS rn
  FROM "journal_entries"
  WHERE "sourceId" IS NOT NULL AND "status" = 'POSTED'
)
UPDATE "journal_entries" e
SET "status" = 'REVERSED',
    "description" = '[DUP-REMOVED] ' || e."description"
FROM dups
WHERE e.id = dups.id AND dups.rn > 1;

-- 4. Tạo unique constraint (Postgres treat NULL khác nhau, nên các MANUAL
--    với sourceId=null vẫn coexist được)
CREATE UNIQUE INDEX "journal_entries_source_sourceId_operation_key"
  ON "journal_entries"("source", "sourceId", "operation");
