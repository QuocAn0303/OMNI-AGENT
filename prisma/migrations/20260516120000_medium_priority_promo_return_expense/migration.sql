-- Phase 4-6: Promotion, Return advanced, Expense recurring

CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y', 'CATEGORY_DISCOUNT', 'PRODUCT_DISCOUNT', 'FREE_SHIPPING');
CREATE TYPE "PromotionScope" AS ENUM ('AUTO', 'VOUCHER_CODE');
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED');
CREATE TYPE "ReturnReason" AS ENUM ('DEFECTIVE', 'WRONG_ITEM', 'CUSTOMER_CHANGE', 'EXPIRED', 'OTHER');

ALTER TYPE "RefundMethod" ADD VALUE IF NOT EXISTS 'EXCHANGE';
ALTER TYPE "RefundMethod" ADD VALUE IF NOT EXISTS 'NONE';

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "storeCredit" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "promotionDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "voucherCode" TEXT;

CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "scope" "PromotionScope" NOT NULL DEFAULT 'AUTO',
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(12,2) NOT NULL,
    "maxDiscount" DECIMAL(12,2),
    "minOrderValue" DECIMAL(12,2),
    "minQuantity" INTEGER,
    "buyQuantity" INTEGER,
    "getQuantity" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER,
    "categoryId" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");
CREATE INDEX "promotions_status_startDate_endDate_idx" ON "promotions"("status", "startDate", "endDate");

ALTER TABLE "promotions" ADD CONSTRAINT "promotions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "promotion_usages" (
    "id" TEXT NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_returns" ADD COLUMN IF NOT EXISTS "restockable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "order_returns" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "order_returns" ADD COLUMN "reason_new" "ReturnReason";
UPDATE "order_returns" SET "reason_new" = 'OTHER' WHERE "reason_new" IS NULL;
ALTER TABLE "order_returns" DROP COLUMN "reason";
ALTER TABLE "order_returns" RENAME COLUMN "reason_new" TO "reason";
ALTER TABLE "order_returns" ALTER COLUMN "reason" SET NOT NULL;

CREATE TABLE "exchange_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "exchange_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exchange_items" ADD CONSTRAINT "exchange_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "isRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "recurringRule" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "parentTemplateId" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;

CREATE UNIQUE INDEX "expenses_sourceType_sourceId_key" ON "expenses"("sourceType", "sourceId");

CREATE TABLE "recurring_expense_logs" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expenseId" TEXT NOT NULL,
    CONSTRAINT "recurring_expense_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_expense_logs_expenseId_key" ON "recurring_expense_logs"("expenseId");
CREATE UNIQUE INDEX "recurring_expense_logs_templateId_periodKey_key" ON "recurring_expense_logs"("templateId", "periodKey");

ALTER TABLE "recurring_expense_logs" ADD CONSTRAINT "recurring_expense_logs_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
