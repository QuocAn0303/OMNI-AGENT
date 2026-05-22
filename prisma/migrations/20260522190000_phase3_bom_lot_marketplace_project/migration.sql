-- Phase 3: Multi-level BOM, Lot/Serial, Marketplace, Advanced Projects
-- (idempotent — safe to retry after partial failure)

-- ===================== 3.1 Multi-level BOM + WorkCenter + Routing =====================

ALTER TABLE boms ADD COLUMN IF NOT EXISTS "parentBomId" UUID REFERENCES boms(id) ON DELETE SET NULL;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS "isSubAssembly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS work_centers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(50) UNIQUE NOT NULL,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  capacity      NUMERIC(10,2) DEFAULT 8,
  "isActive"    BOOLEAN DEFAULT true,
  "accountId"   UUID REFERENCES accounts(id) ON DELETE SET NULL,
  "createdAt"   TIMESTAMP DEFAULT NOW(),
  "updatedAt"   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(200) NOT NULL,
  "productId" UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  "bomId"     UUID REFERENCES boms(id) ON DELETE SET NULL,
  notes       TEXT,
  "isActive"  BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routing_operations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "routingId"      UUID NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
  sequence         INT NOT NULL,
  name             VARCHAR(200) NOT NULL,
  "workCenterId"   UUID REFERENCES work_centers(id) ON DELETE SET NULL,
  "durationMinutes" INT NOT NULL DEFAULT 60,
  notes            TEXT,
  "createdAt"      TIMESTAMP DEFAULT NOW()
);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS "routingId" UUID REFERENCES routings(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS quality_checks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workOrderId" UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "checkedById" UUID REFERENCES users(id) ON DELETE SET NULL,
  "checkedAt"   TIMESTAMP,
  notes         TEXT,
  "createdAt"   TIMESTAMP DEFAULT NOW(),
  "updatedAt"   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_check_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "qualityCheckId" UUID NOT NULL REFERENCES quality_checks(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  result           VARCHAR(20),
  notes            TEXT,
  "createdAt"      TIMESTAMP DEFAULT NOW()
);

-- ===================== 3.2 Lot / Serial / Expiry =====================

ALTER TABLE products ADD COLUMN IF NOT EXISTS "trackByLot"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS "trackBySerial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS "shelfLifeDays" INT;

CREATE TABLE IF NOT EXISTS inventory_lots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lotCode"    VARCHAR(100) NOT NULL,
  "productId"  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  "warehouseId" UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity     INT NOT NULL DEFAULT 0,
  "originalQty" INT NOT NULL DEFAULT 0,
  "mfgDate"    DATE,
  "expDate"    DATE,
  "poId"       UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  "createdAt"  TIMESTAMP DEFAULT NOW(),
  "updatedAt"  TIMESTAMP DEFAULT NOW(),
  UNIQUE("lotCode", "productId", "warehouseId")
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_product ON inventory_lots("productId");
CREATE INDEX IF NOT EXISTS idx_inventory_lots_expdate ON inventory_lots("expDate");

CREATE TABLE IF NOT EXISTS lot_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lotId"         UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  "txId"          UUID REFERENCES inventory_transactions(id) ON DELETE SET NULL,
  "orderId"       UUID REFERENCES orders(id) ON DELETE SET NULL,
  "workOrderId"   UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  quantity        INT NOT NULL,
  type            VARCHAR(20) NOT NULL,
  "createdAt"     TIMESTAMP DEFAULT NOW()
);

-- ===================== 3.3 Marketplace Integration =====================

CREATE TABLE IF NOT EXISTS marketplace_shops (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    VARCHAR(30) NOT NULL,
  "shopName"  VARCHAR(200),
  "shopId"    VARCHAR(100),
  "isActive"  BOOLEAN DEFAULT true,
  credentials JSONB,
  "lastSyncAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shopId"      UUID NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  "productId"   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  platform      VARCHAR(30) NOT NULL,
  "externalId"  VARCHAR(200),
  "externalSku" VARCHAR(200),
  status        VARCHAR(20) DEFAULT 'ACTIVE',
  "lastPushedAt" TIMESTAMP,
  "syncErrors"   TEXT,
  "createdAt"   TIMESTAMP DEFAULT NOW(),
  "updatedAt"   TIMESTAMP DEFAULT NOW(),
  UNIQUE("shopId", "productId")
);

CREATE TABLE IF NOT EXISTS marketplace_sync_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shopId"    UUID NOT NULL REFERENCES marketplace_shops(id) ON DELETE CASCADE,
  direction   VARCHAR(10) NOT NULL,
  entity      VARCHAR(30) NOT NULL,
  status      VARCHAR(20) NOT NULL,
  count       INT DEFAULT 0,
  errors      JSONB,
  "startedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "endedAt"   TIMESTAMP
);

-- ===================== 3.4 Advanced Projects: TimeEntry + ProjectInvoice =====================

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS "dependsOnId" UUID REFERENCES project_tasks(id) ON DELETE SET NULL;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS "estimateHours" NUMERIC(8,2);
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS "actualHours"   NUMERIC(8,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS time_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "taskId"     UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  "userId"     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "startTime"  TIMESTAMP NOT NULL,
  "endTime"    TIMESTAMP,
  hours        NUMERIC(8,2),
  description  TEXT,
  billable     BOOLEAN DEFAULT true,
  "hourlyRate" NUMERIC(12,2) DEFAULT 0,
  invoiced     BOOLEAN DEFAULT false,
  "invoiceId"  UUID,
  "createdAt"  TIMESTAMP DEFAULT NOW(),
  "updatedAt"  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries("projectId");
CREATE INDEX IF NOT EXISTS idx_time_entries_user    ON time_entries("userId");

CREATE TABLE IF NOT EXISTS project_invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoiceCode" VARCHAR(50) UNIQUE NOT NULL,
  "projectId"   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  "customerId"  UUID REFERENCES customers(id) ON DELETE SET NULL,
  amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  status        VARCHAR(20) DEFAULT 'DRAFT',
  "issuedAt"    TIMESTAMP,
  "dueDate"     DATE,
  notes         TEXT,
  "createdAt"   TIMESTAMP DEFAULT NOW(),
  "updatedAt"   TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_te_invoice'
  ) THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_te_invoice
      FOREIGN KEY ("invoiceId") REFERENCES project_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_invoices_project ON project_invoices("projectId");
