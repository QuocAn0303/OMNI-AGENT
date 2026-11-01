-- UC-007 — bộ nhớ dài hạn: company / department / user.
--
-- Bảng `agent_memories` phiên bản CŨ (enum AgentMemoryScope/Status, cột
-- key/fact/departmentId) tồn tại trên DB mẫu nhưng KHÔNG có trong schema/migration
-- và không có mã nào đọc. Đã kiểm tra 0 dòng. Bỏ nó để thay bằng mô hình 5 mục
-- của UC-007 (scope/memoryKey/content/version/supersede/TTL).
DROP TABLE IF EXISTS "agent_memories" CASCADE;
DROP TYPE IF EXISTS "AgentMemoryScope";
DROP TYPE IF EXISTS "AgentMemoryStatus";

-- Mỗi fact chỉ có TỐI ĐA MỘT bản đang hiệu lực. Supersede được thực hiện trong
-- một transaction (đánh dấu bản cũ rồi tạo bản mới, version = old.version + 1).
-- Partial unique index dưới đây là lớp bảo vệ THỨ HAI ở tầng DB: kể cả hai request
-- đồng thời cũng không thể tạo được hai sự thật cùng hiệu lực.
CREATE TABLE "agent_memories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "department" TEXT,
    "userId" TEXT,
    "memoryKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_memories_tenantId_scope_department_userId_idx"
    ON "agent_memories"("tenantId", "scope", "department", "userId");
CREATE INDEX "agent_memories_tenantId_memoryKey_supersededAt_idx"
    ON "agent_memories"("tenantId", "memoryKey", "supersededAt");

-- Chỉ một bản đang hiệu lực cho mỗi khoá nghiệp vụ. COALESCE để NULL (company /
-- department / user không mang trường tương ứng) vẫn tham gia khoá duy nhất.
CREATE UNIQUE INDEX "agent_memories_active_fact_uq"
    ON "agent_memories"(
        "tenantId",
        "scope",
        COALESCE("department", ''),
        COALESCE("userId", ''),
        "memoryKey"
    )
    WHERE "supersededAt" IS NULL;

ALTER TABLE "agent_memories"
    ADD CONSTRAINT "agent_memories_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
