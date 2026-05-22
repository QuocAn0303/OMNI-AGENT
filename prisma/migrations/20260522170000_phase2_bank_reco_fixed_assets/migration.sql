-- Phase 2: Bank Reconciliation + Fixed Assets

-- BankStatement
CREATE TABLE "bank_statements" (
  "id"           TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "fileName"     TEXT,
  "importedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fromDate"     TIMESTAMP(3),
  "toDate"       TIMESTAMP(3),
  "lineCount"    INTEGER NOT NULL DEFAULT 0,
  "status"       TEXT NOT NULL DEFAULT 'IMPORTED',
  PRIMARY KEY ("id")
);
CREATE INDEX "bank_statements_bankAccountId_idx" ON "bank_statements"("bankAccountId");
ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BankStatementLine
CREATE TABLE "bank_statement_lines" (
  "id"             TEXT NOT NULL,
  "statementId"    TEXT NOT NULL,
  "txDate"         TIMESTAMP(3) NOT NULL,
  "description"    TEXT NOT NULL,
  "debit"          DECIMAL(15,2) NOT NULL DEFAULT 0,
  "credit"         DECIMAL(15,2) NOT NULL DEFAULT 0,
  "balance"        DECIMAL(15,2),
  "reference"      TEXT,
  "matchedEntryId" TEXT,
  "isMatched"      BOOLEAN NOT NULL DEFAULT false,
  "isAdjustment"   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("id")
);
CREATE INDEX "bank_statement_lines_statementId_isMatched_idx" ON "bank_statement_lines"("statementId", "isMatched");
ALTER TABLE "bank_statement_lines"
  ADD CONSTRAINT "bank_statement_lines_statementId_fkey"
  FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FixedAssetCategory
CREATE TABLE "fixed_asset_categories" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "accountId"    TEXT NOT NULL,
  "deprAccountId" TEXT NOT NULL,
  "expAccountId" TEXT NOT NULL,
  "lifeMonths"   INTEGER NOT NULL DEFAULT 60,
  "method"       TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fixed_asset_categories_code_key" ON "fixed_asset_categories"("code");

-- FixedAsset
CREATE TABLE "fixed_assets" (
  "id"                     TEXT NOT NULL,
  "code"                   TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "categoryId"             TEXT NOT NULL,
  "purchaseDate"           TIMESTAMP(3) NOT NULL,
  "cost"                   DECIMAL(15,2) NOT NULL,
  "salvageValue"           DECIMAL(15,2) NOT NULL DEFAULT 0,
  "lifeMonths"             INTEGER NOT NULL,
  "method"                 TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
  "accumulatedDepreciation" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status"                 TEXT NOT NULL DEFAULT 'ACTIVE',
  "departmentId"           TEXT,
  "note"                   TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fixed_assets_code_key" ON "fixed_assets"("code");
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");
ALTER TABLE "fixed_assets"
  ADD CONSTRAINT "fixed_assets_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "fixed_asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DepreciationSchedule
CREATE TABLE "depreciation_schedules" (
  "id"             TEXT NOT NULL,
  "assetId"        TEXT NOT NULL,
  "period"         TEXT NOT NULL,
  "amount"         DECIMAL(15,2) NOT NULL,
  "journalEntryId" TEXT,
  "postedAt"       TIMESTAMP(3),
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "depreciation_schedules_assetId_period_key" ON "depreciation_schedules"("assetId", "period");
ALTER TABLE "depreciation_schedules"
  ADD CONSTRAINT "depreciation_schedules_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
