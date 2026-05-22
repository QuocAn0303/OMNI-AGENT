-- Finance integration: link expenses to projects, track WO cost + journal entry

-- AlterTable: Expense.projectId
ALTER TABLE "expenses" ADD COLUMN "projectId" TEXT;

-- AlterTable: WorkOrder.totalCost + journalEntryId
ALTER TABLE "work_orders" ADD COLUMN "totalCost" DECIMAL(15, 2);
ALTER TABLE "work_orders" ADD COLUMN "journalEntryId" TEXT;

-- CreateIndex
CREATE INDEX "expenses_projectId_idx" ON "expenses"("projectId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed new accounts for manufacturing cost flow (idempotent)
INSERT INTO "accounts" ("id", "code", "name", "nameVi", "type", "normalBalance", "isCash", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), '154', 'Work in progress', 'Chi phí sản xuất dở dang', 'ASSET'::"AccountType", 'DEBIT'::"NormalBalance", false, true, NOW(), NOW()),
  (gen_random_uuid(), '155', 'Finished goods', 'Thành phẩm', 'ASSET'::"AccountType", 'DEBIT'::"NormalBalance", false, true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
