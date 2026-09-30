-- CRM SALES PIPELINE (Lead / Deal / Organization / Contact)
--
-- Thêm mới hoàn toàn, KHÔNG sửa dữ liệu bảng cũ. Customer vẫn là khách hàng
-- giao dịch; CrmDeal.customerId chỉ được set khi deal thắng.
--
-- Cố ý KHÔNG gồm `CREATE UNIQUE INDEX "currencies_code_key"`: index đó đang
-- lệch giữa DB thực tế và migration history (vấn đề có sẵn, không liên quan
-- Phase 1). Gộp vào đây sẽ khiến migration CRM fail theo dữ liệu tiền tệ trùng.
-- CreateEnum
CREATE TYPE "CrmEntityType" AS ENUM ('LEAD', 'DEAL');

-- CreateEnum
CREATE TYPE "CrmStageKind" AS ENUM ('ONGOING', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DEAD');

-- CreateEnum
CREATE TYPE "CrmCommType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'ZALO', 'WHATSAPP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CrmCommDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "zaloUserId" TEXT;

-- CreateTable
CREATE TABLE "crm_pipeline_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "entityType" "CrmEntityType" NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0f766e',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" "CrmStageKind" NOT NULL DEFAULT 'ONGOING',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "leadName" TEXT NOT NULL,
    "email" TEXT,
    "mobileNo" TEXT,
    "jobTitle" TEXT,
    "source" TEXT,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "stageId" TEXT,
    "leadOwnerId" TEXT,
    "organizationId" TEXT,
    "contactId" TEXT,
    "expectedValue" DECIMAL(15,2),
    "convertedAt" TIMESTAMP(3),
    "convertedDealId" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_organizations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "annualRevenue" DECIMAL(18,2),
    "taxCode" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "customerId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "dealName" TEXT NOT NULL,
    "organizationId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "customerId" TEXT,
    "stageId" TEXT,
    "kind" "CrmStageKind" NOT NULL DEFAULT 'ONGOING',
    "value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "nextStep" TEXT,
    "dealOwnerId" TEXT,
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "dealId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_deal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_communications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" "CrmCommType" NOT NULL,
    "direction" "CrmCommDirection",
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "durationSec" INTEGER,
    "leadId" TEXT,
    "dealId" TEXT,
    "contactId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_communications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_tenantId_entityType_sortOrder_idx" ON "crm_pipeline_stages"("tenantId", "entityType", "sortOrder");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_tenantId_idx" ON "crm_pipeline_stages"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipeline_stages_tenantId_entityType_label_key" ON "crm_pipeline_stages"("tenantId", "entityType", "label");

-- CreateIndex
CREATE INDEX "crm_leads_tenantId_status_stageId_idx" ON "crm_leads"("tenantId", "status", "stageId");

-- CreateIndex
CREATE INDEX "crm_leads_tenantId_mobileNo_idx" ON "crm_leads"("tenantId", "mobileNo");

-- CreateIndex
CREATE INDEX "crm_leads_tenantId_leadOwnerId_idx" ON "crm_leads"("tenantId", "leadOwnerId");

-- CreateIndex
CREATE INDEX "crm_leads_tenantId_idx" ON "crm_leads"("tenantId");

-- CreateIndex
CREATE INDEX "crm_organizations_tenantId_idx" ON "crm_organizations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_organizations_name_tenantId_key" ON "crm_organizations"("name", "tenantId");

-- CreateIndex
CREATE INDEX "crm_contacts_tenantId_organizationId_idx" ON "crm_contacts"("tenantId", "organizationId");

-- CreateIndex
CREATE INDEX "crm_contacts_tenantId_phone_idx" ON "crm_contacts"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "crm_contacts_tenantId_email_idx" ON "crm_contacts"("tenantId", "email");

-- CreateIndex
CREATE INDEX "crm_contacts_tenantId_idx" ON "crm_contacts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_orderId_key" ON "crm_deals"("orderId");

-- CreateIndex
CREATE INDEX "crm_deals_tenantId_stageId_kind_idx" ON "crm_deals"("tenantId", "stageId", "kind");

-- CreateIndex
CREATE INDEX "crm_deals_tenantId_dealOwnerId_idx" ON "crm_deals"("tenantId", "dealOwnerId");

-- CreateIndex
CREATE INDEX "crm_deals_tenantId_expectedCloseDate_idx" ON "crm_deals"("tenantId", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "crm_deals_tenantId_idx" ON "crm_deals"("tenantId");

-- CreateIndex
CREATE INDEX "crm_deal_items_dealId_idx" ON "crm_deal_items"("dealId");

-- CreateIndex
CREATE INDEX "crm_deal_items_tenantId_idx" ON "crm_deal_items"("tenantId");

-- CreateIndex
CREATE INDEX "crm_communications_tenantId_leadId_createdAt_idx" ON "crm_communications"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_communications_tenantId_dealId_createdAt_idx" ON "crm_communications"("tenantId", "dealId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_communications_tenantId_idx" ON "crm_communications"("tenantId");

-- CreateIndex

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_leadOwnerId_fkey" FOREIGN KEY ("leadOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "crm_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "crm_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "crm_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_dealOwnerId_fkey" FOREIGN KEY ("dealOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_items" ADD CONSTRAINT "crm_deal_items_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "crm_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_items" ADD CONSTRAINT "crm_deal_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_communications" ADD CONSTRAINT "crm_communications_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
