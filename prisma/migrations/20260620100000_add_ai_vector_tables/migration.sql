-- Auto-detect pgvector availability and create tables accordingly
DO $$
BEGIN
  -- Try to enable pgvector extension (optional — RAG works without it)
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not available — RAG will fall back to keyword search';
  END;

  -- AI Documents table: stores chunked ERP data for RAG
  CREATE TABLE IF NOT EXISTS ai_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_type, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ai_documents_entity_type ON ai_documents(entity_type);
  CREATE INDEX IF NOT EXISTS idx_ai_documents_updated_at ON ai_documents(updated_at);

  -- AI Embeddings table — uses vector(768) if pgvector is available, else real[]
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
