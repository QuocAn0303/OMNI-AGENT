-- P0-3: `AgentHumanGate.resultRef` — cột nullable, additive, KHÔNG cần backfill.
--
-- Vì sao cần (docs/aisc26/00b-gate-design.md §4):
--   Đề xuất PO phải là gate có hiệu lực đầu tiên trong hệ thống. Khi ADMIN/MANAGER
--   duyệt, executor tạo PO rồi ghi `resultRef` = PurchaseOrder.id. Nếu bước ghi
--   lỗi, gate rơi vào trạng thái "đã duyệt nhưng chưa tạo được PO" — `resultRef`
--   là cách nhận diện trạng thái đó MÀ KHÔNG NHẦM sang gate loại khác.
--
--   Không thêm `executedAt` (đội đã chốt bỏ): nhận diện bằng `resultRef IS NULL`
--   + `status = APPROVED` + đúng `actionType`, cả ba điều kiện cùng lúc.
--
-- Index `[actionType, status, resultRef]` phục vụ truy vấn tìm đúng nhóm gate
-- cần thử lại. Không có index này thì phải quét toàn bảng.
--
-- AN TOÀN:
--   - Cột NULLABLE + ADD COLUMN IF NOT EXISTS ⇒ chạy lại nhiều lần vẫn an toàn,
--     không mất dữ liệu, không lock bảng lâu.
--   - CHỈ dùng `prisma migrate deploy`. TUYỆT ĐỐI KHÔNG dùng `migrate dev`:
--     repo có bảng RAG vector (`prisma/migrations/20260620100000_add_ai_vector_tables`)
--     nên `migrate dev` có thể sinh ALTER phá cột `real[]`/`vector`.

ALTER TABLE "agent_human_gates"
  ADD COLUMN IF NOT EXISTS "resultRef" TEXT;

CREATE INDEX IF NOT EXISTS "agent_human_gates_actionType_status_resultRef_idx"
  ON "agent_human_gates" ("actionType", "status", "resultRef");