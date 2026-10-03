-- T13 (docs/aisc26/NIGHT-PROMPT.md §6, T13) — bảng `llm_usage_logs`.
--
-- ĐÂY LÀ MỘT TRONG HAI BẢNG ĐƯỢC PHÉP THÊM Ở VÒNG 2 (cùng `AgentHumanGate.resultRef`
-- của P0-3). KHÔNG sửa bất kỳ migration đã áp dụng nào.
--
-- VÌ SAO CẦN:
--   `src/config/llm.js` đọc `candidates[0].content.parts` rồi BỎ QUA `usageMetadata`
--   ⇒ không biết một lần gọi tốn bao nhiêu token. Không có bảng này thì "chi phí LLM"
--   trong `03-evaluation-protocol.md` §5.4 không đo được (chỉ ghi "chưa đo").
--
-- AN TOÀN:
--   - ADDITIVE thuần: chỉ CREATE TABLE + CREATE INDEX. Không ALTER/DROP bảng nào đang
--     có, không chạm dữ liệu, không backfill.
--   - `tenantId` KHÔNG có khoá ngoại tới `tenants` (giống `AgentHumanGate`): có thể
--     ghi dòng NULL cho lần gọi ngoài tenant context (cron/script) — cần giữ để phân
--     biệt "lỗi" với "không thuộc tenant nào".
--   - CHỈ dùng `prisma migrate deploy`. TUYỆT ĐỐI KHÔNG dùng `migrate dev`: repo đã
--     bằng RAG vector (`prisma/migrations/20260620100000_add_ai_vector_tables`) nên
--     `migrate dev` có thể sinh ALTER cột `real[]`/`vector`.
--
-- Quy ước (giữ đúng, xem `prisma/schema.prisma` model `LlmUsageLog`):
--   task: SKU_MATCH | PROPOSAL_EXPLAIN | VENDOR_MESSAGE  (hằng số, không tự do)
--   mode: live | record | replay | fallback
--   promptText/responseText chỉ để tái lập kết quả ở chế độ record/replay; KHÔNG
--   dùng để đưa dữ liệu khách hàng thật qua LLM (hiến pháp NIGHT-PROMPT §3).

-- CreateTable
CREATE TABLE IF NOT EXISTS "llm_usage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "promptText" TEXT,
    "responseText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- Bảng mới ⇒ không đổi nội dung bảng khác, nhưng index tĩnh thì nên đặt trước khi
-- có dữ liệu để không phải rewrite sau này. Idempotent để chạy lại cũng an toàn.
CREATE INDEX IF NOT EXISTS "llm_usage_logs_tenantId_createdAt_idx" ON "llm_usage_logs" ("tenantId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "llm_usage_logs_task_createdAt_idx" ON "llm_usage_logs" ("task", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "llm_usage_logs_createdAt_idx" ON "llm_usage_logs" ("createdAt");