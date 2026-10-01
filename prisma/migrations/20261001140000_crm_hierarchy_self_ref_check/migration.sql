-- CRM Phase 4 (bổ sung) — users.reportsToId: ràng buộc CHỐNG TỰ TRỎ thật sự
--
-- PHÁT HIỆN khi chạy smoke test trên DB thật (scripts/smoke-crm-phase4-hierarchy.js):
-- migration `20261001130000_crm_sales_hierarchy` có block `DO $$` guard
-- `WHERE "reportsToId" = "id"` → dừng nếu dữ liệu lúc migrate bị bẩn.
-- NHƯNG đó chỉ là kiểm tra MỘT LẦN. Sau khi migrate xong, DB vẫn cho phép:
--
--     UPDATE users SET "reportsToId" = <id của chính nó>   -- tạo vòng tự tham chiếu
--
-- và smoke test đã xác nhận điều đó (code=CREATED, tức DB nhận).
--
-- Sửa ở đây bằng CHECK constraint — biểu thức so sánh 2 cột của CÙNG một hàng thì
-- Postgres enforce được (khác với so sánh cross-row, vốn cần trigger).
--
-- Ghi chú về cross-tenant: KHÔNG thể chặn bằng CHECK (cần tra cột của hàng khác).
-- Việc chặn chéo tenant thuộc tầng service + tenant-scoping của Prisma extension
-- (`setReportsTo` tra manager qua client đã scope → trả 404 nếu khác tenant).
-- Xem `hierarchy.service.js:assertCanManage` và `setReportsTo`.

-- Dọn dữ liệu bẩn trước khi tạo constraint, nếu có (migration trước đã chặn nhưng
-- để chắc — constraint fail giữa chừng sẽ để lại DB ở trạng thái nửa vời).
UPDATE "users"
SET "reportsToId" = NULL
WHERE "reportsToId" IS NOT NULL AND "reportsToId" = "id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_reportsToId_not_self'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_reportsToId_not_self"
      CHECK ("reportsToId" IS NULL OR "reportsToId" <> "id");
  END IF;
END $$;