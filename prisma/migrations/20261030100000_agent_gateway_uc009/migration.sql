-- UC-009 (agent-gateway): phòng ban của actor + cột audit cho agent.
--
-- `users.department` là FALLBACK: nguồn ưu tiên vẫn là `employees.departmentId`
-- (agent-gateway.service.js `resolveDepartment`).
--
-- `audit_logs` nhận thêm trường agent. KHÔNG có trigger chặn UPDATE/DELETE
-- (nhóm đã chốt bỏ ADR-4b): append-only được bảo đảm bằng việc chỉ mở duy nhất
-- hàm `create` qua POST /api/agent-gateway/audit-events.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "department" TEXT;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "runId" TEXT,
ADD COLUMN "agentName" TEXT,
ADD COLUMN "toolName" TEXT,
ADD COLUMN "resource" TEXT,
ADD COLUMN "decision" TEXT,
ADD COLUMN "reason" TEXT,
ADD COLUMN "department" TEXT,
ADD COLUMN "skillName" TEXT,
ADD COLUMN "skillVersion" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_runId_idx" ON "audit_logs"("runId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_runId_idx" ON "audit_logs"("tenantId", "runId");
