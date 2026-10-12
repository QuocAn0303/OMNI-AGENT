-- Quy tắc nhập hàng theo (sản phẩm × kho), mô phỏng Odoo
-- `Reordering Rules` (reordering_min_qty / reordering_max_qty).
--
-- VÌ SAO:
-- Trước đây chỉ có `Inventory.minStock` và engine ROP dùng hằng số cứng cho
-- lead time (7 ngày), packMultiple (1) và serviceLevel (0,95). Người dùng không
-- cấu hình được gì cho từng SKU. Đây là các tham số mà Odoo đưa vào UI.
--
-- LƯU Ý VỀ NULL:
--   maxStock, leadTimeDays, serviceLevel cho phép NULL = "chưa đặt" ⇒ dùng
--   mặc định của hệ thống. packMultiple mặc định 1 = bán lẻ từng cái.
--   KHÔNG dùng NOT NULL + giá trị mặc định khác 0 vì sẽ không phân biệt được
--   "chủ động đặt 0" với "chưa cấu hình".

ALTER TABLE "inventories"
  ADD COLUMN IF NOT EXISTS "maxStock"     INTEGER,
  ADD COLUMN IF NOT EXISTS "leadTimeDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "packMultiple" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "serviceLevel" DOUBLE PRECISION;

-- Ràng buộc giá trị: công thức từ chối ngoài miền này (xem replenishment.calc),
-- nhưng ràng buộc ở DB chặn được dữ liệu rác từ script/import chạy ngoài app.
ALTER TABLE "inventories"
  DROP CONSTRAINT IF EXISTS "inventories_maxStock_positive";
ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_maxStock_positive"
  CHECK ("maxStock" IS NULL OR "maxStock" > 0);

ALTER TABLE "inventories"
  DROP CONSTRAINT IF EXISTS "inventories_leadTimeDays_positive";
ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_leadTimeDays_positive"
  CHECK ("leadTimeDays" IS NULL OR "leadTimeDays" > 0);

ALTER TABLE "inventories"
  DROP CONSTRAINT IF EXISTS "inventories_packMultiple_positive";
ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_packMultiple_positive"
  CHECK ("packMultiple" >= 1);

ALTER TABLE "inventories"
  DROP CONSTRAINT IF EXISTS "inventories_serviceLevel_range";
ALTER TABLE "inventories"
  ADD CONSTRAINT "inventories_serviceLevel_range"
  CHECK ("serviceLevel" IS NULL OR ("serviceLevel" > 0 AND "serviceLevel" < 1));