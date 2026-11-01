-- UC-005 — báo giá bán hàng + thư nháp.
-- TÁCH BIỆT hoàn toàn khỏi RfqQuotation của phân hệ mua hàng.
-- `sent` mặc định false, `status` mặc định 'DRAFT'; không có cột nào cho phép gửi.
CREATE TABLE "sales_quote_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "quoteNumber" TEXT,
    "customerId" TEXT,
    "dealId" TEXT,
    "gateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "sheetPath" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quote_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_quote_drafts_idempotencyKey_key"
    ON "sales_quote_drafts"("idempotencyKey");
CREATE INDEX "sales_quote_drafts_tenantId_idx"
    ON "sales_quote_drafts"("tenantId");
CREATE INDEX "sales_quote_drafts_tenantId_createdAt_idx"
    ON "sales_quote_drafts"("tenantId", "createdAt");
CREATE INDEX "sales_quote_drafts_tenantId_customerId_idx"
    ON "sales_quote_drafts"("tenantId", "customerId");
