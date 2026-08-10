-- C5: Gắn tenant cho AI RAG documents (ngăn cross-tenant leak qua chat AI)
-- Đảm bảo bảng entity gốc có cột tenantId TRƯỚC khi backfill
-- (cột này nằm trong schema Prisma, nhưng migration drift của Prisma
--  được tạo SAU migration này — nên phải tự thêm ở đây)
ALTER TABLE products ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

-- Bảng ai_documents chỉ tồn tại nếu pgvector/RAG đã khởi tạo được lúc migrate —
-- nếu không có (RAG fallback), bỏ qua các thao tác này.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_documents') THEN
    ALTER TABLE ai_documents ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(36);
    CREATE INDEX IF NOT EXISTS idx_ai_documents_tenant_id ON ai_documents(tenant_id);

    -- Backfill từ entity gốc (entity_id = UUID product/customer)
    UPDATE ai_documents d SET tenant_id = p."tenantId"
      FROM products p
      WHERE d.entity_type = 'product' AND d.entity_id = p.id::text AND d.tenant_id IS NULL;

    UPDATE ai_documents d SET tenant_id = c."tenantId"
      FROM customers c
      WHERE d.entity_type = 'customer' AND d.entity_id = c.id::text AND d.tenant_id IS NULL;
  END IF;
END $$;
