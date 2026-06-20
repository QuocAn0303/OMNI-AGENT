-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- AI Documents table: stores chunked ERP data for RAG
CREATE TABLE ai_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX idx_ai_documents_entity_type ON ai_documents(entity_type);
CREATE INDEX idx_ai_documents_updated_at ON ai_documents(updated_at);

-- AI Embeddings table: stores vector embeddings
-- nomic-embed-text outputs 768 dimensions
CREATE TABLE ai_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL UNIQUE REFERENCES ai_documents(id) ON DELETE CASCADE,
  embedding vector(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For small datasets (<10k rows), cosine distance (<=> operator) works without index.
-- When data grows, add IVFFlat index:
-- CREATE INDEX idx_ai_embeddings_vector ON ai_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
