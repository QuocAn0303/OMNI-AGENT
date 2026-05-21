-- Deep dive core: payments, returns, cycle counts, advanced discounts, stock reservations.

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'RESERVATION';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'RESERVATION_RELEASE';

DO $$ BEGIN
  CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'STORE_CREDIT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CycleCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "inventories"
  ADD COLUMN IF NOT EXISTS "reserved" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "discountValue" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amount" DECIMAL(12, 2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_returns" (
  "id" TEXT NOT NULL,
  "returnCode" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "refundMethod" "RefundMethod" NOT NULL DEFAULT 'CASH',
  "refundAmount" DECIMAL(12, 2) NOT NULL,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_return_items" (
  "id" TEXT NOT NULL,
  "returnId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "refundAmount" DECIMAL(12, 2) NOT NULL,
  CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cycle_counts" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "CycleCountStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cycle_count_items" (
  "id" TEXT NOT NULL,
  "cycleCountId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "systemQuantity" INTEGER NOT NULL,
  "actualQuantity" INTEGER,
  "variance" INTEGER,
  "note" TEXT,
  CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_returns_returnCode_key" ON "order_returns"("returnCode");
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_counts_code_key" ON "cycle_counts"("code");

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_returnId_fkey"
    FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_cycleCountId_fkey"
    FOREIGN KEY ("cycleCountId") REFERENCES "cycle_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
