-- Gap-fill cho DB được khởi tạo bằng db push trước migration chain:
--  1. ai_documents / ai_embeddings chưa tồn tại vì 20260620100000 có guard
--     pgvector (máy không có extension vector -> bảng không được tạo).
--  2. Align kiểu dữ liệu: cycle_count_items.warehouseId (varchar -> text),
--     portal_otps.blockedUntil (timestamp -> timestamptz).
-- Tất cả IF NOT EXISTS / guard -> an toàn chạy lại trên DB mới (no-op).

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not available - RAG falls back to keyword search';
  END;
END $$;

CREATE TABLE IF NOT EXISTS ai_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id VARCHAR(36),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_documents_entity_type ON ai_documents(entity_type);
CREATE INDEX IF NOT EXISTS idx_ai_documents_updated_at ON ai_documents(updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_documents_tenant_id ON ai_documents(tenant_id);

DO $$
BEGIN
  BEGIN
    CREATE TABLE IF NOT EXISTS ai_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL UNIQUE REFERENCES ai_documents(id) ON DELETE CASCADE,
      embedding vector(768),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    CREATE TABLE IF NOT EXISTS ai_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL UNIQUE REFERENCES ai_documents(id) ON DELETE CASCADE,
      embedding real[],
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  END;
END $$;

ALTER TABLE ai_embeddings ALTER COLUMN embedding SET NOT NULL;

-- Align kiểu dữ liệu với schema hiện tại (no-op nếu đã đúng)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cycle_count_items' AND column_name = 'warehouseId' AND data_type <> 'text') THEN
    ALTER TABLE cycle_count_items ALTER COLUMN "warehouseId" SET DATA TYPE TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'portal_otps' AND column_name = 'blockedUntil' AND data_type <> 'timestamp with time zone') THEN
    ALTER TABLE portal_otps ALTER COLUMN "blockedUntil" SET DATA TYPE TIMESTAMP(3) WITH TIME ZONE;
  END IF;
END $$;
