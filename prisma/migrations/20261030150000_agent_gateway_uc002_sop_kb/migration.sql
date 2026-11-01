-- UC-002 (SOP/KB): m? r?ng ai_documents
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "doc_code" TEXT;
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "access_level" TEXT DEFAULT 'public';
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "version" TEXT DEFAULT '1.0';
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "effective_date" TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMPTZ;
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "section_heading" TEXT;
ALTER TABLE "ai_documents" ADD COLUMN IF NOT EXISTS "chunk_index" INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_ai_documents_tenant_dept_acl_eff" ON "ai_documents" ("tenant_id", "department", "access_level", "effective_date");
CREATE INDEX IF NOT EXISTS "idx_ai_documents_tenant_doc_ver_chunk" ON "ai_documents" ("tenant_id", "doc_code", "version", "chunk_index");
