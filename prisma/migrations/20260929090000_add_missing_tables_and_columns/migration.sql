-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CUSTOMER', 'DEAD');

-- CreateEnum
CREATE TYPE "KraljicCategory" AS ENUM ('STRATEGIC', 'LEVERAGE', 'BOTTLENECK', 'ROUTINE');

-- CreateEnum
CREATE TYPE "ChurnRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ChurnAlertStatus" AS ENUM ('PENDING', 'TRIGGERED', 'RETAINED', 'LOST');

-- CreateEnum
CREATE TYPE "GrnStatus" AS ENUM ('DRAFT', 'QC_PENDING', 'QC_DONE', 'POSTED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCHED', 'VARIANCE_HOLD', 'APPROVED_OVERRIDE');

-- DropForeignKey
ALTER TABLE "ai_embeddings" DROP CONSTRAINT "ai_embeddings_document_id_fkey";

-- AlterTable
ALTER TABLE "ai_embeddings" ALTER COLUMN "embedding" SET DATA TYPE DOUBLE PRECISION[];

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "leadRoundRobinCursor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "churnProbability" DOUBLE PRECISION,
ADD COLUMN     "clvPredicted" DECIMAL(15,2),
ADD COLUMN     "clvScoredAt" TIMESTAMP(3),
ADD COLUMN     "leadStatus" "LeadStatus" DEFAULT 'NEW',
ADD COLUMN     "referralSource" TEXT,
ADD COLUMN     "rfmFrequency" INTEGER,
ADD COLUMN     "rfmMonetary" DECIMAL(15,2),
ADD COLUMN     "rfmRecencyDays" INTEGER,
ADD COLUMN     "rfmScoredAt" TIMESTAMP(3),
ADD COLUMN     "rfmSegment" TEXT;

-- AlterTable
ALTER TABLE "portal_otps" ALTER COLUMN "blockedUntil" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "defectRate" DOUBLE PRECISION,
ADD COLUMN     "kraljicCategory" "KraljicCategory",
ADD COLUMN     "otifScore" DOUBLE PRECISION,
ADD COLUMN     "profitImpactScore" INTEGER,
ADD COLUMN     "supplyRiskScore" INTEGER,
ADD COLUMN     "vendorGrade" TEXT;

-- CreateTable
CREATE TABLE "churn_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "customerId" TEXT NOT NULL,
    "riskLevel" "ChurnRiskLevel" NOT NULL,
    "churnScore" DOUBLE PRECISION NOT NULL,
    "voucherCode" TEXT,
    "promotionId" TEXT,
    "status" "ChurnAlertStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "churn_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "grnCode" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "GrnStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onTime" BOOLEAN,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "grnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "passQty" INTEGER NOT NULL DEFAULT 0,
    "rejectQty" INTEGER NOT NULL DEFAULT 0,
    "lotCode" TEXT,
    "expiryDate" DATE,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "purchaseOrderId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceAmount" DECIMAL(15,2) NOT NULL,
    "invoiceTax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "varianceAmount" DECIMAL(15,2),
    "variancePct" DOUBLE PRECISION,
    "matchedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "churn_alerts_tenantId_status_idx" ON "churn_alerts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "churn_alerts_customerId_idx" ON "churn_alerts"("customerId");

-- CreateIndex
CREATE INDEX "churn_alerts_tenantId_idx" ON "churn_alerts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_notes_grnCode_key" ON "goods_receipt_notes"("grnCode");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_tenantId_purchaseOrderId_idx" ON "goods_receipt_notes"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_tenantId_idx" ON "goods_receipt_notes"("tenantId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_grnId_idx" ON "goods_receipt_items"("grnId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_productId_idx" ON "goods_receipt_items"("productId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_tenantId_idx" ON "goods_receipt_items"("tenantId");

-- CreateIndex
CREATE INDEX "purchase_invoice_records_tenantId_idx" ON "purchase_invoice_records"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_records_purchaseOrderId_invoiceNumber_key" ON "purchase_invoice_records"("purchaseOrderId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "churn_alerts" ADD CONSTRAINT "churn_alerts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "churn_alerts" ADD CONSTRAINT "churn_alerts_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_records" ADD CONSTRAINT "purchase_invoice_records_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kds_tickets" ADD CONSTRAINT "kds_tickets_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_embeddings" ADD CONSTRAINT "ai_embeddings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "ai_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
