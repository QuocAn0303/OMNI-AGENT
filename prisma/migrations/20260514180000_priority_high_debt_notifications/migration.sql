-- Incremental migration: debt, notifications, PO workflow fields, customer.totalDebt, JournalSource.DEBT
-- Apply on a DB that already matches prior Prisma migrations for this project.

-- JournalSource: DEBT
DO $$ BEGIN
  ALTER TYPE "JournalSource" ADD VALUE 'DEBT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- PurchaseStatus: PENDING, APPROVED (append order matters for PG < 15 in some setups)
DO $$ BEGIN
  ALTER TYPE "PurchaseStatus" ADD VALUE 'PENDING';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "PurchaseStatus" ADD VALUE 'APPROVED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- New enums
DO $$ BEGIN
  CREATE TYPE "DebtType" AS ENUM ('RECEIVABLE', 'PAYABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DebtStatus" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED', 'OVERDUE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'LOW_STOCK',
    'OUT_OF_STOCK',
    'ORDER_PENDING_LONG',
    'PO_PENDING_APPROVAL',
    'DEBT_OVERDUE',
    'PAYROLL_DUE',
    'EXPENSE_PENDING_APPROVAL',
    'PERIOD_CLOSING_REMINDER',
    'SYSTEM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Customer AR balance
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "totalDebt" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Purchase order columns
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: legacy ORDERED (chưa nhận) coi như đã duyệt để receive theo flow mới
UPDATE "purchase_orders"
SET "status" = 'APPROVED'::"PurchaseStatus"
WHERE "status" = 'ORDERED'::"PurchaseStatus" AND "receivedAt" IS NULL;

CREATE TABLE "debts" (
  "id" TEXT NOT NULL,
  "type" "DebtType" NOT NULL,
  "status" "DebtStatus" NOT NULL DEFAULT 'OPEN',
  "amount" DECIMAL(12,2) NOT NULL,
  "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "dueDate" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customerId" TEXT,
  "vendorId" TEXT,
  "orderId" TEXT,
  "poId" TEXT,

  CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "debts_orderId_key" ON "debts"("orderId");
CREATE UNIQUE INDEX "debts_poId_key" ON "debts"("poId");
CREATE INDEX "debts_status_dueDate_idx" ON "debts"("status", "dueDate");

ALTER TABLE "debts" ADD CONSTRAINT "debts_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_poId_fkey"
  FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "debt_payments" (
  "id" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "note" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "debtId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,

  CONSTRAINT "debt_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_debtId_fkey"
  FOREIGN KEY ("debtId") REFERENCES "debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "link" TEXT,
  "meta" JSONB,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  "roleScope" "Role",

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");
CREATE INDEX "notifications_roleScope_isRead_idx" ON "notifications"("roleScope", "isRead");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
