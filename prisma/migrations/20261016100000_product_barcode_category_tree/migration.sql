-- Thêm 2026-10-16 — mã vạch ở cấp sản phẩm + cây ngành hàng
--
-- Bối cảnh
--   1. `barcode` trước đây CHỈ có trên `ProductVariant`. `Product` thì không.
--      Siêu thị quét mã vạch ở POS ⇒ thiếu cột này là thiếu THẬT, không phải
--      thiếu dữ liệu, và bài toán khớp mã mất chân trụng.
--   2. `Category` phẳng (chỉ có `name`). Cây ngành hàng siêu thị bắt buộc phải
--      có cấp cha–con. Copy đúng khuôn `WarehouseTree` đã có sẵn.
--
-- AN TOÀN
--   * Cả hai cột đều NULLABLE ⇒ không đụng dữ liệu đang có.
--   * UNIQUE trên `barcode` KHÔNG xung đột với dữ liệu hiện tại: cột vừa tạo
--     nên mọi giá trị đều NULL, mà PostgreSQL cho phép nhiều NULL trong UNIQUE.
--     (`prisma db push` cảnh báo "có thể mất dữ liệu" ở đây là báo động giả.)
--   * `ON DELETE RESTRICT` trên cây danh mục: xoá nhóm cha khi còn nhóm con thì
--     phải bị chặn, không để mất hàng mồ côi.

-- 1) Mã vạch ở cấp sản phẩm
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "products_barcode_key" ON "products"("barcode");

-- 2) Cây ngành hàng
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
CREATE INDEX IF NOT EXISTS "categories_tenantId_parentId_idx" ON "categories"("tenantId", "parentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_parentId_fkey'
  ) THEN
    ALTER TABLE "categories"
      ADD CONSTRAINT "categories_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "categories"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
