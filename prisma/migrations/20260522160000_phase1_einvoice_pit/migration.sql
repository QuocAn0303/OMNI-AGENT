-- Phase 1: E-invoice + PIT/BHXH

-- Employee: dependents + socialInsuranceCode
ALTER TABLE "employees" ADD COLUMN "dependents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN "socialInsuranceCode" TEXT;

-- Payroll: BHXH + PIT columns
ALTER TABLE "payrolls" ADD COLUMN "bhxhEmployee" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "payrolls" ADD COLUMN "pitAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ElectronicInvoice table
CREATE TABLE "electronic_invoices" (
  "id"           TEXT NOT NULL,
  "invoiceNo"    TEXT NOT NULL,
  "orderId"      TEXT,
  "templateCode" TEXT NOT NULL DEFAULT '1/001',
  "serial"       TEXT NOT NULL DEFAULT 'K24TVE',
  "issueDate"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buyerName"    TEXT NOT NULL DEFAULT '',
  "buyerTaxCode" TEXT,
  "buyerAddress" TEXT,
  "signedXml"    TEXT,
  "pdfUrl"       TEXT,
  "cqtCode"      TEXT,
  "cqtStatus"    TEXT NOT NULL DEFAULT 'PENDING',
  "provider"     TEXT NOT NULL DEFAULT 'VNPT',
  "rawResponse"  JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "electronic_invoices_invoiceNo_key" ON "electronic_invoices"("invoiceNo");
CREATE UNIQUE INDEX "electronic_invoices_orderId_key"   ON "electronic_invoices"("orderId");
CREATE INDEX "electronic_invoices_cqtStatus_idx"        ON "electronic_invoices"("cqtStatus");

ALTER TABLE "electronic_invoices"
  ADD CONSTRAINT "electronic_invoices_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
