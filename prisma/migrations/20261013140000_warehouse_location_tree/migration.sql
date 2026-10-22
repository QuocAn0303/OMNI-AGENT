-- Cây vị trí trong kho (Odoo `stock.location`).
--
-- VÌ SAO:
-- `Warehouse` trước đây là danh sách phẳng: mỗi kho một dòng, không có khái niệm
-- "kho mẹ / kho con" và không có phân biệt vị trí thật với vị trí trung gian.
-- Odoo dùng `stock.location` làm cây: mỗi kho có các vị trí nhập / lưu / xuất /
-- lấy hàng, và có loại vị trí (usage) để biết chỗ nào thực sự chứa hàng.
--
-- THIẾT KẾ AN TOÀN:
--   KHÔNG tạo bảng mới. Thêm cột vào `warehouses` và tự tham chiếu, để mọi
--   quan hệ cũ (Inventory, GRN, Lot, SerialNumber, StockTransfer, WorkOrder)
--   tiếp tục dùng `warehouseId` như cũ. Kho cũ mặc định thành PHYSICAL ⇒ hành vi
--   không đổi, không phải sửa dữ liệu nào.
--
-- `onDelete: Restrict` trên `parentId` ⇒ không xoá được kho cha còn kho con. Ràng
-- buộc này ở DB vì mất vị trí con là mất tồn kho.

-- THỨ TỰ QUAN TRỌNG: phải TẠO CỘT trước rồi mới thêm ràng buộc CHECK/REFERENCES
-- tham chiếu tới cột đó. Đặt CHECK trước sẽ lỗi "column does not exist".

-- Kiểu lưu trữ: TEXT + CHECK thay vì ENUM. Lý do: enum trên `warehouses` sẽ phải
-- `ALTER TYPE` mỗi lần thêm giá trị — thao tác đó dễ hỏng trên DB đang có dữ
-- liệu, còn CHECK chặn được giá trị lạ ngay ở tầng DB.
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "locationType" TEXT NOT NULL DEFAULT 'PHYSICAL',
  ADD COLUMN IF NOT EXISTS "parentId" TEXT,
  ADD COLUMN IF NOT EXISTS "path" TEXT;

ALTER TABLE "warehouses"
  DROP CONSTRAINT IF EXISTS "warehouses_locationType_valid";
ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_locationType_valid"
  CHECK ("locationType" IN ('PHYSICAL', 'VIEW', 'INTERNAL'));

-- Kho cha phải cùng tenant với kho con.
--
-- KHÔNG dùng CHECK: Postgres từ chối subquery trong CHECK
-- ("cannot use subquery in check constraint", đã vấp 1 lần). Cùng một điều kiện
-- cũng không làm được UNIQUE vì nó so sánh hai cột khác nhau.
-- ⇒ Dùng trigger. Nếu không chặn ở đây thì có thể gắn kho con tenant A vào kho
-- cha tenant B, và đọc tồn kho chéo tenant bằng cách duyệt cây.
CREATE OR REPLACE FUNCTION warehouses_parent_same_tenant() RETURNS trigger AS $$
DECLARE parent_tenant TEXT;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "tenantId" INTO parent_tenant FROM warehouses WHERE id = NEW."parentId";
  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'Kho cha % không tồn tại', NEW."parentId" USING ERRCODE = '23503';
  END IF;
  IF NEW."tenantId" IS NOT NULL AND parent_tenant IS NOT NULL AND NEW."tenantId" <> parent_tenant THEN
    RAISE EXCEPTION
      'Kho cha % thuộc tenant khác — không cho gắn vị trí con sang tenant khác',
      NEW."parentId" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS warehouses_parent_same_tenant_trg ON warehouses;
CREATE TRIGGER warehouses_parent_same_tenant_trg
  BEFORE INSERT OR UPDATE OF "parentId", "tenantId" ON warehouses
  FOR EACH ROW EXECUTE FUNCTION warehouses_parent_same_tenant();

-- Không tự làm cha của chính mình — vòng lặp sẽ làm hỏng mọi truy vấn cây
-- (duyệt đệ quy không bao giờ dừng).
ALTER TABLE "warehouses"
  DROP CONSTRAINT IF EXISTS "warehouses_not_self_parent";
ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_not_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> id);

CREATE INDEX IF NOT EXISTS "warehouses_parentId_idx" ON "warehouses"("parentId");
CREATE INDEX IF NOT EXISTS "warehouses_tenantId_parentId_idx" ON "warehouses"("tenantId", "parentId");

ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mọi kho đã có đều là vị trí THẬT: đặt rõ để không phải suy từ NULL.
UPDATE "warehouses"
   SET "locationType" = 'PHYSICAL'
 WHERE "locationType" IS NULL OR "locationType" = '';