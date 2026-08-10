-- A2: CycleCountItem theo từng kho (trước đây gộp toàn bộ kho của 1 sản phẩm vào 1 dòng)
-- → khi complete, số lượng thực tế bị ghi vào MỌI kho (sai dữ liệu multi-warehouse)
ALTER TABLE cycle_count_items ADD COLUMN IF NOT EXISTS "warehouseId" VARCHAR(36);

-- Backfill: dòng cũ (không có kho) → gắn kho mặc định nếu tồn tại
UPDATE cycle_count_items cci
SET "warehouseId" = w.id
FROM warehouses w
WHERE cci."warehouseId" IS NULL
  AND w."isDefault" = true
  AND w."isActive" = true;

CREATE INDEX IF NOT EXISTS idx_cycle_count_items_product_warehouse
  ON cycle_count_items ("productId", "warehouseId");
