-- Phase 3: Multi-level BOM, Lot/Serial, Marketplace, Advanced Projects
-- (idempotent + TEXT ids to match Prisma convention)

-- ===================== 3.1 Multi-level BOM + WorkCenter + Routing =====================

ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "parentBomId" TEXT;
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "isSubAssembly" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boms_parentBomId_fkey') THEN
    ALTER TABLE "boms" ADD CONSTRAINT "boms_parentBomId_fkey"
      FOREIGN KEY ("parentBomId") REFERENCES "boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "work_centers" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "capacity"    DECIMAL(10,2) NOT NULL DEFAULT 8,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "accountId"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_centers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_centers_code_key" ON "work_centers"("code");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_centers_accountId_fkey') THEN
    ALTER TABLE "work_centers" ADD CONSTRAINT "work_centers_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "routings" (
  "id"        TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "bomId"     TEXT,
  "notes"     TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "routings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "routings_code_key" ON "routings"("code");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routings_productId_fkey') THEN
    ALTER TABLE "routings" ADD CONSTRAINT "routings_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routings_bomId_fkey') THEN
    ALTER TABLE "routings" ADD CONSTRAINT "routings_bomId_fkey"
      FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "routing_operations" (
  "id"              TEXT NOT NULL,
  "routingId"       TEXT NOT NULL,
  "sequence"        INTEGER NOT NULL,
  "name"            TEXT NOT NULL,
  "workCenterId"    TEXT,
  "durationMinutes" INTEGER NOT NULL DEFAULT 60,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "routing_operations_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routing_operations_routingId_fkey') THEN
    ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_routingId_fkey"
      FOREIGN KEY ("routingId") REFERENCES "routings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routing_operations_workCenterId_fkey') THEN
    ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_workCenterId_fkey"
      FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "routingId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_routingId_fkey') THEN
    ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routingId_fkey"
      FOREIGN KEY ("routingId") REFERENCES "routings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "quality_checks" (
  "id"          TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "checkedById" TEXT,
  "checkedAt"   TIMESTAMP(3),
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quality_checks_workOrderId_fkey') THEN
    ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quality_checks_checkedById_fkey') THEN
    ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_checkedById_fkey"
      FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "quality_check_items" (
  "id"             TEXT NOT NULL,
  "qualityCheckId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "result"         TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quality_check_items_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quality_check_items_qualityCheckId_fkey') THEN
    ALTER TABLE "quality_check_items" ADD CONSTRAINT "quality_check_items_qualityCheckId_fkey"
      FOREIGN KEY ("qualityCheckId") REFERENCES "quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ===================== 3.2 Lot / Serial / Expiry =====================

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trackByLot"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trackBySerial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shelfLifeDays" INTEGER;

CREATE TABLE IF NOT EXISTS "inventory_lots" (
  "id"          TEXT NOT NULL,
  "lotCode"     TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL DEFAULT 0,
  "originalQty" INTEGER NOT NULL DEFAULT 0,
  "mfgDate"     DATE,
  "expDate"     DATE,
  "poId"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lots_lotCode_productId_warehouseId_key" ON "inventory_lots"("lotCode", "productId", "warehouseId");
CREATE INDEX IF NOT EXISTS "inventory_lots_productId_idx" ON "inventory_lots"("productId");
CREATE INDEX IF NOT EXISTS "inventory_lots_expDate_idx" ON "inventory_lots"("expDate");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_lots_productId_fkey') THEN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_lots_warehouseId_fkey') THEN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_lots_poId_fkey') THEN
    ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_poId_fkey"
      FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lot_transactions" (
  "id"          TEXT NOT NULL,
  "lotId"       TEXT NOT NULL,
  "txId"        TEXT,
  "orderId"     TEXT,
  "workOrderId" TEXT,
  "quantity"    INTEGER NOT NULL,
  "type"        TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lot_transactions_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_transactions_lotId_fkey') THEN
    ALTER TABLE "lot_transactions" ADD CONSTRAINT "lot_transactions_lotId_fkey"
      FOREIGN KEY ("lotId") REFERENCES "inventory_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_transactions_txId_fkey') THEN
    ALTER TABLE "lot_transactions" ADD CONSTRAINT "lot_transactions_txId_fkey"
      FOREIGN KEY ("txId") REFERENCES "inventory_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_transactions_orderId_fkey') THEN
    ALTER TABLE "lot_transactions" ADD CONSTRAINT "lot_transactions_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_transactions_workOrderId_fkey') THEN
    ALTER TABLE "lot_transactions" ADD CONSTRAINT "lot_transactions_workOrderId_fkey"
      FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ===================== 3.3 Marketplace Integration =====================

CREATE TABLE IF NOT EXISTS "marketplace_shops" (
  "id"          TEXT NOT NULL,
  "platform"    TEXT NOT NULL,
  "shopName"    TEXT,
  "shopId"      TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "credentials" JSONB,
  "lastSyncAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_shops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "marketplace_listings" (
  "id"            TEXT NOT NULL,
  "shopId"        TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "platform"      TEXT NOT NULL,
  "externalId"    TEXT,
  "externalSku"   TEXT,
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastPushedAt"  TIMESTAMP(3),
  "syncErrors"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_listings_shopId_productId_key" ON "marketplace_listings"("shopId", "productId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_listings_shopId_fkey') THEN
    ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "marketplace_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_listings_productId_fkey') THEN
    ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "marketplace_sync_logs" (
  "id"        TEXT NOT NULL,
  "shopId"    TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "entity"    TEXT NOT NULL,
  "status"    TEXT NOT NULL,
  "count"     INTEGER NOT NULL DEFAULT 0,
  "errors"    JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"   TIMESTAMP(3),
  CONSTRAINT "marketplace_sync_logs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_sync_logs_shopId_fkey') THEN
    ALTER TABLE "marketplace_sync_logs" ADD CONSTRAINT "marketplace_sync_logs_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "marketplace_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ===================== 3.4 Advanced Projects: TimeEntry + ProjectInvoice =====================

ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "dependsOnId"   TEXT;
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "estimateHours" DECIMAL(8,2);
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "actualHours"   DECIMAL(8,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_dependsOnId_fkey') THEN
    ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_dependsOnId_fkey"
      FOREIGN KEY ("dependsOnId") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "time_entries" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "taskId"      TEXT,
  "userId"      TEXT NOT NULL,
  "startTime"   TIMESTAMP(3) NOT NULL,
  "endTime"     TIMESTAMP(3),
  "hours"       DECIMAL(8,2),
  "description" TEXT,
  "billable"    BOOLEAN NOT NULL DEFAULT true,
  "hourlyRate"  DECIMAL(12,2) NOT NULL DEFAULT 0,
  "invoiced"    BOOLEAN NOT NULL DEFAULT false,
  "invoiceId"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "time_entries_projectId_idx" ON "time_entries"("projectId");
CREATE INDEX IF NOT EXISTS "time_entries_userId_idx"    ON "time_entries"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_projectId_fkey') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_taskId_fkey') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_userId_fkey') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "project_invoices" (
  "id"          TEXT NOT NULL,
  "invoiceCode" TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "customerId"  TEXT,
  "amount"      DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status"      TEXT NOT NULL DEFAULT 'DRAFT',
  "issuedAt"    TIMESTAMP(3),
  "dueDate"     DATE,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_invoices_invoiceCode_key" ON "project_invoices"("invoiceCode");
CREATE INDEX IF NOT EXISTS "project_invoices_projectId_idx" ON "project_invoices"("projectId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_invoices_projectId_fkey') THEN
    ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_invoices_customerId_fkey') THEN
    ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_invoiceId_fkey') THEN
    ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "project_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
