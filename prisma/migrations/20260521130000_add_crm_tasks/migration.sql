-- CRM Phase 2: Customer tasks / follow-ups

CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

CREATE TABLE "customer_tasks" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "dueAt" TIMESTAMP(3),
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_tasks_assignedToId_status_dueAt_idx"
    ON "customer_tasks"("assignedToId", "status", "dueAt");

CREATE INDEX "customer_tasks_customerId_idx" ON "customer_tasks"("customerId");

ALTER TABLE "customer_tasks"
    ADD CONSTRAINT "customer_tasks_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_tasks"
    ADD CONSTRAINT "customer_tasks_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_tasks"
    ADD CONSTRAINT "customer_tasks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
