-- CRM Phase 4 — Sales hierarchy: self-relation `users.reportsToId`
--
-- Self-relation trên chính bảng `users`. KHÔNG backfill: trước migration này
-- mọi user đều là trưởng cao nhất (reportsToId = NULL) — đó là cây phẳng hợp lệ,
-- không cần chữa dữ liệu.
--
-- ON DELETE SET NULL: xoá user sẽ đưa bậc dưới lên thành trưởng mới thay vì
-- xoá luôn cây. Service (`hierarchy.service.js`) còn tự chăm sóc bằng cách
-- re-parent trước; SET NULL chỉ là lưới an toàn.

-- ============================================================
-- 1. Cột + index
-- ============================================================

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reportsToId" TEXT;

CREATE INDEX IF NOT EXISTS "users_tenantId_reportsToId_idx" ON "users"("tenantId", "reportsToId");

-- ============================================================
-- 2. FK
-- ============================================================

-- Guard dữ liệu lúc migrate. CHÚ Ý: đây là kiểm tra MỘT LẦN trên dữ liệu sẵn có,
-- KHÔNG phải ràng buộc lâu dài. Sau khi migration chạy xong, DB vẫn cho phép tự
-- trỏ chính nó → ràng buộc đó nằm ở migration kế tiếp
-- (`20261001140000_crm_hierarchy_self_ref_check`, thêm CHECK constraint thật).
--
-- Tương tự: chéo tenant KHÔNG thể chặn bằng CHECK (cần tra hàng khác). Việc đó
-- thuộc tầng service + tenant-scoping của Prisma extension, không thuộc migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" child
    JOIN "users" parent ON parent."id" = child."reportsToId"
    WHERE child."tenantId" IS DISTINCT FROM parent."tenantId"
  ) THEN
    RAISE EXCEPTION
      'users.reportsToId trỏ sang user khác tenant — cần sửa dữ liệu trước khi tạo FK.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "users" WHERE "reportsToId" = "id"
  ) THEN
    RAISE EXCEPTION
      'users.reportsToId trỏ tới chính nó — đây là vòng lặp, cần sửa trước khi tạo FK.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_reportsToId_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_reportsToId_fkey"
      FOREIGN KEY ("reportsToId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;