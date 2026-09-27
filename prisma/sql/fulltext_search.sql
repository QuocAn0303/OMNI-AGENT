-- prisma/sql/fulltext_search.sql — Full-text search cho PostgreSQL (đặc tả §3.2)
--
-- Prisma KHÔNG hỗ trợ attribute @@fulltext với connector postgresql (chỉ MySQL/MongoDB),
-- nên index được tạo bằng raw SQL. Ứng dụng dùng Prisma Client preview
-- "fullTextSearchPostgres" với filter { search: "..." } → tsvector @@ tsquery.
--
-- Cách chạy (khi có PostgreSQL dev/prod):
--   psql "$DATABASE_URL" -f prisma/sql/fulltext_search.sql
-- hoặc thêm vào migration Prisma tiếp theo.
--
-- Yêu cầu: PostgreSQL 16+ với pg_trgm (theo đặc tả §1).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Customers: tìm theo tên / email / SĐT
CREATE INDEX IF NOT EXISTS "customers_name_trgm_idx"
  ON "customers" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_email_trgm_idx"
  ON "customers" USING GIN ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_phone_trgm_idx"
  ON "customers" USING GIN ("phone" gin_trgm_ops);

-- Products: tìm theo tên / SKU
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx"
  ON "products" USING GIN ("sku" gin_trgm_ops);

-- Vendors (bảng vendors): tìm theo tên / MST
CREATE INDEX IF NOT EXISTS "vendors_name_trgm_idx"
  ON "vendors" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "vendors_taxcode_trgm_idx"
  ON "vendors" USING GIN ("taxCode" gin_trgm_ops);
