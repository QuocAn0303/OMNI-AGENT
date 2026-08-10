-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LineItemType') THEN
    CREATE TYPE "LineItemType" AS ENUM ('RETURN', 'EXCHANGE');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScheduleType') THEN
    CREATE TYPE "ScheduleType" AS ENUM ('ALWAYS', 'CRON');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentSessionStatus') THEN
    CREATE TYPE "AgentSessionStatus" AS ENUM ('RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentStepType') THEN
    CREATE TYPE "AgentStepType" AS ENUM ('LLM_CALL', 'TOOL_CALL', 'HUMAN_GATE', 'RENDER_UI');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HumanGateStatus') THEN
    CREATE TYPE "HumanGateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ModifierType') THEN
    CREATE TYPE "ModifierType" AS ENUM ('SINGLE', 'MULTIPLE', 'REQUIRED');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductType') THEN
    CREATE TYPE "ProductType" AS ENUM ('REGULAR', 'COMBO', 'VARIANT_PARENT');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TableStatus') THEN
    CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'DIRTY', 'DISABLED');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderType') THEN
    CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'DRIVE_THRU', 'QR_SELF');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoidReason') THEN
    CREATE TYPE "VoidReason" AS ENUM ('CUSTOMER_CHANGE', 'KITCHEN_ERROR', 'OUT_OF_STOCK', 'STAFF_MISTAKE', 'OTHER');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ForecastType') THEN
    CREATE TYPE "ForecastType" AS ENUM ('HOURLY_DEMAND', 'TOP_PRODUCTS', 'WASTE_PREDICTION', 'MENU_ENGINEERING');
  END IF;
END
$$;



-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountingMode') THEN
    CREATE TYPE "AccountingMode" AS ENUM ('FULL_VAS', 'SIMPLIFIED_HKD');
  END IF;
END
$$;



-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PaymentMethod' AND e.enumlabel = 'MOMO') THEN
    ALTER TYPE "PaymentMethod" ADD VALUE 'MOMO';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PaymentMethod' AND e.enumlabel = 'VNPAY') THEN
    ALTER TYPE "PaymentMethod" ADD VALUE 'VNPAY';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PaymentMethod' AND e.enumlabel = 'ZALOPAY') THEN
    ALTER TYPE "PaymentMethod" ADD VALUE 'ZALOPAY';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PaymentMethod' AND e.enumlabel = 'PAYOS') THEN
    ALTER TYPE "PaymentMethod" ADD VALUE 'PAYOS';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PaymentMethod' AND e.enumlabel = 'VIETQR') THEN
    ALTER TYPE "PaymentMethod" ADD VALUE 'VIETQR';
  END IF;
END
$$;



-- AlterEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PromotionType' AND e.enumlabel = 'HAPPY_HOUR') THEN
    ALTER TYPE "PromotionType" ADD VALUE 'HAPPY_HOUR';
  END IF;
END
$$;



-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PurchaseStatus' AND e.enumlabel = 'PENDING_APPROVAL') THEN
    ALTER TYPE "PurchaseStatus" ADD VALUE 'PENDING_APPROVAL';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'PurchaseStatus' AND e.enumlabel = 'REJECTED') THEN
    ALTER TYPE "PurchaseStatus" ADD VALUE 'REJECTED';
  END IF;
END
$$;



-- AlterEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'Role' AND e.enumlabel = 'ACCOUNTANT') THEN
    ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';
  END IF;
END
$$;



-- DropForeignKey
-- Lưu ý: bảng ai_* chỉ tồn tại nếu RAG/pgvector đã khởi tạo được (fallback nếu không)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_embeddings') THEN
    ALTER TABLE "ai_embeddings" DROP CONSTRAINT "ai_embeddings_document_id_fkey";
  END IF;
END $$;



-- DropForeignKey
ALTER TABLE "exchange_items" DROP CONSTRAINT IF EXISTS "exchange_items_productId_fkey";



-- DropForeignKey
ALTER TABLE "exchange_items" DROP CONSTRAINT IF EXISTS "exchange_items_returnId_fkey";



-- DropForeignKey
ALTER TABLE "order_return_items" DROP CONSTRAINT IF EXISTS "order_return_items_orderItemId_fkey";



-- DropForeignKey
ALTER TABLE "order_return_items" DROP CONSTRAINT IF EXISTS "order_return_items_returnId_fkey";



-- DropIndex
DROP INDEX IF EXISTS "bank_accounts_accountNumber_key";



-- DropIndex
DROP INDEX IF EXISTS "categories_name_key";



-- DropIndex
DROP INDEX IF EXISTS "customer_segments_name_key";



-- DropIndex
DROP INDEX IF EXISTS "customers_phone_key";



-- DropIndex
DROP INDEX IF EXISTS "fiscal_periods_year_month_key";



-- DropIndex
DROP INDEX IF EXISTS "fixed_assets_code_key";



-- DropIndex
DROP INDEX IF EXISTS "products_sku_key";



-- DropIndex
DROP INDEX IF EXISTS "projects_code_key";



-- DropIndex
DROP INDEX IF EXISTS "promotions_code_key";



-- DropIndex
DROP INDEX IF EXISTS "tax_rates_code_key";



-- DropIndex
DROP INDEX IF EXISTS "work_centers_code_key";



-- AlterTable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_embeddings') THEN
    ALTER TABLE "ai_embeddings" ALTER COLUMN "embedding" SET NOT NULL;
  END IF;
END $$;


-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS     "agentSessionId" TEXT,
ADD COLUMN IF NOT EXISTS     "agentStepId" TEXT,
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "bank_statement_lines" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "bank_statements" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "bom_items" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "campaign_trackings" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS     "accountingMode" "AccountingMode" NOT NULL DEFAULT 'FULL_VAS',
ADD COLUMN IF NOT EXISTS     "beginnerMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS     "businessTemplate" TEXT,
ADD COLUMN IF NOT EXISTS     "demoSeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "poApprovalThreshold" DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "customer_campaigns" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "customer_notes" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "customer_segments" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "customer_tag_on_customer" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "customer_tasks" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS     "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0;



-- AlterTable
ALTER TABLE "cycle_count_items" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ALTER COLUMN "warehouseId" SET DATA TYPE TEXT;



-- AlterTable
ALTER TABLE "cycle_counts" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "debt_payments" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "debts" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "delivery_events" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "depreciation_schedules" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "electronic_invoices" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "fiscal_periods" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "fixed_asset_categories" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "integration_configs" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "inventories" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "inventory_lots" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ADD COLUMN IF NOT EXISTS     "unitCost" DECIMAL(15,2);



-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ADD COLUMN IF NOT EXISTS     "unitCost" DECIMAL(15,2);



-- AlterTable
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "journal_posting_errors" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "lot_transactions" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "loyalty_transactions" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "marketplace_listings" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "marketplace_shops" ADD COLUMN IF NOT EXISTS     "credentialsIv" TEXT,
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "marketplace_sync_logs" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS     "humanGateId" TEXT,
ADD COLUMN IF NOT EXISTS     "requiresAction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS     "comboId" TEXT,
ADD COLUMN IF NOT EXISTS     "courseId" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS     "parentOrderItemId" TEXT,
ADD COLUMN IF NOT EXISTS     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ADD COLUMN IF NOT EXISTS     "voidReason" TEXT;



-- AlterTable
ALTER TABLE "order_returns" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS     "channel" TEXT NOT NULL DEFAULT 'POS',
ADD COLUMN IF NOT EXISTS     "channelOrderId" TEXT,
ADD COLUMN IF NOT EXISTS     "orderType" "OrderType" NOT NULL DEFAULT 'DINE_IN',
ADD COLUMN IF NOT EXISTS     "seatNumber" INTEGER,
ADD COLUMN IF NOT EXISTS     "serviceChargePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS     "splitMode" TEXT,
ADD COLUMN IF NOT EXISTS     "tableId" TEXT,
ADD COLUMN IF NOT EXISTS     "tableSessionId" TEXT,
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ADD COLUMN IF NOT EXISTS     "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;



-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS     "provider" TEXT,
ADD COLUMN IF NOT EXISTS     "providerTxId" TEXT,
ADD COLUMN IF NOT EXISTS     "rawResponse" JSONB,
ADD COLUMN IF NOT EXISTS     "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ADD COLUMN IF NOT EXISTS     "txStatus" TEXT;



-- AlterTable
ALTER TABLE "payrolls" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "portal_otps" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT,
ALTER COLUMN "blockedUntil" SET DATA TYPE TIMESTAMP(3);



-- AlterTable
ALTER TABLE "portal_sessions" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS     "kdsStationId" TEXT,
ADD COLUMN IF NOT EXISTS     "productType" "ProductType" NOT NULL DEFAULT 'REGULAR';



-- AlterTable
ALTER TABLE "project_invoices" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "project_members" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "promotion_usages" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS     "cronExpression" TEXT,
ADD COLUMN IF NOT EXISTS     "daysOfWeek" TEXT,
ADD COLUMN IF NOT EXISTS     "endTime" TEXT,
ADD COLUMN IF NOT EXISTS     "scheduleType" "ScheduleType" DEFAULT 'ALWAYS',
ADD COLUMN IF NOT EXISTS     "startTime" TEXT,
ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "quality_check_items" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "quality_checks" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "recurring_expense_logs" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "report_schedules" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "routing_operations" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "routings" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "saved_reports" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "stock_transfer_items" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS     "checkoutSessionId" TEXT;



-- AlterTable
ALTER TABLE "tax_rates" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS     "avatar" TEXT,
ADD COLUMN IF NOT EXISTS     "businessTemplate" TEXT,
ADD COLUMN IF NOT EXISTS     "phone" TEXT,
ADD COLUMN IF NOT EXISTS     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "twoFactorIv" TEXT,
ADD COLUMN IF NOT EXISTS     "twoFactorSecret" TEXT;



-- AlterTable
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "violations" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "work_centers" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "work_order_items" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "workflow_approvals" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- AlterTable
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS     "tenantId" TEXT;



-- DropTable
DROP TABLE IF EXISTS "exchange_items";;



-- DropTable
DROP TABLE IF EXISTS "order_return_items";;



-- CreateTable
CREATE TABLE IF NOT EXISTS "permissions" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "isGranted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_backups" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_backups_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "backup_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "store_credit_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" TEXT NOT NULL,
    "referenceId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credit_transactions_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "return_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" "LineItemType" NOT NULL DEFAULT 'RETURN',
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "return_line_items_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "overtime_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_requests_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "prepaid_expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "totalMonths" INTEGER NOT NULL,
    "monthlyAmount" DECIMAL(15,2) NOT NULL,
    "remainingAmount" DECIMAL(15,2) NOT NULL,
    "allocatedMonths" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prepaid_expenses_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "serial_numbers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "serialCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "orderId" TEXT,
    "purchaseOrderId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "secretIv" TEXT,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastResponse" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_sessions" (
    "id" TEXT NOT NULL,
    "sessionCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'RUNNING',
    "intent" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'USER_CHAT',
    "userMessage" TEXT NOT NULL,
    "contextSnapshot" JSONB,
    "finalResult" JSONB,
    "errorMsg" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_steps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "AgentStepType" NOT NULL,
    "toolName" TEXT,
    "toolInput" JSONB,
    "toolOutput" JSONB,
    "prompt" TEXT,
    "completion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "durationMs" INTEGER,
    "path" TEXT,
    "confidence" DOUBLE PRECISION,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_human_gates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "sessionId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionPayload" JSONB NOT NULL,
    "actionSummary" TEXT NOT NULL,
    "triggerRule" TEXT,
    "status" "HumanGateStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_human_gates_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "rating" BOOLEAN NOT NULL,
    "comment" TEXT,
    "path" TEXT,
    "intent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_feedback_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "modifier_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ModifierType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "modifier_options" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceAdjust" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "product_variants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceAdjust" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sku" TEXT,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "combos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "combo_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "comboId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "modifierGroupOverrides" JSONB,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "order_item_modifiers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "orderItemId" TEXT NOT NULL,
    "modifierOptionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceAdjust" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "areas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "diner_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "areaId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "shape" TEXT NOT NULL DEFAULT 'SQUARE',
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "qrToken" TEXT NOT NULL,
    "currentSessionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diner_tables_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "table_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "tableId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT,
    "note" TEXT,

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "tableId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "bill_splits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "orderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethod" "PaymentMethod",

    CONSTRAINT "bill_splits_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "bill_split_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "splitId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "bill_split_items_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "kds_stations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "printerId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kds_stations_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "kds_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "orderItemId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "firedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "prepTimeSec" INTEGER,
    "bumpCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kds_tickets_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "printers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "stationId" TEXT,
    "connectionType" TEXT NOT NULL DEFAULT 'BLUETOOTH',
    "macAddress" TEXT,
    "ipAddress" TEXT,
    "paperWidth" INTEGER NOT NULL DEFAULT 58,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "qr_order_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "publicToken" TEXT NOT NULL,
    "tableId" TEXT,
    "tableName" TEXT,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_order_sessions_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "food_delivery_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "orderId" TEXT,
    "syncLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_delivery_orders_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "recipes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "portions" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "recipeId" TEXT NOT NULL,
    "ingredientProductId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'g',
    "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "waste_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT,
    "orderItemId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_logs_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "stamp_card_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "totalStamps" INTEGER NOT NULL DEFAULT 10,
    "rewardProductId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stamp_card_templates_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "stamp_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "customerId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stamps" INTEGER NOT NULL DEFAULT 0,
    "totalStamps" INTEGER NOT NULL DEFAULT 10,
    "rewardProductId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stamp_cards_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_forecasts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" "ForecastType" NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "horizon" TEXT NOT NULL DEFAULT 'DAY',
    "payload" JSONB NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentSessionId" TEXT,

    CONSTRAINT "ai_forecasts_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_recommendations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);



-- CreateTable
CREATE TABLE IF NOT EXISTS "petty_cash_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petty_cash_transactions_pkey" PRIMARY KEY ("id")
);



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_permissionKey_key" ON "role_permissions"("role", "permissionKey");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "backup_codes_tenantId_idx" ON "backup_codes"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "backup_codes_userId_codeHash_key" ON "backup_codes"("userId", "codeHash");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_credit_transactions_customerId_createdAt_idx" ON "store_credit_transactions"("customerId", "createdAt" DESC);



-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_credit_transactions_tenantId_idx" ON "store_credit_transactions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "return_line_items_returnId_idx" ON "return_line_items"("returnId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "return_line_items_tenantId_idx" ON "return_line_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "overtime_requests_employeeId_date_idx" ON "overtime_requests"("employeeId", "date");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "overtime_requests_tenantId_idx" ON "overtime_requests"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "prepaid_expenses_tenantId_idx" ON "prepaid_expenses"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "serial_numbers_productId_status_idx" ON "serial_numbers"("productId", "status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "serial_numbers_warehouseId_idx" ON "serial_numbers"("warehouseId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "serial_numbers_tenantId_idx" ON "serial_numbers"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "serial_numbers_serialCode_productId_key" ON "serial_numbers"("serialCode", "productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_endpoints_tenantId_idx" ON "webhook_endpoints"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_attemptCount_idx" ON "webhook_deliveries"("status", "attemptCount");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpointId_idx" ON "webhook_deliveries"("endpointId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_deliveries_tenantId_idx" ON "webhook_deliveries"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_sessionCode_key" ON "agent_sessions"("sessionCode");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_userId_createdAt_idx" ON "agent_sessions"("userId", "createdAt" DESC);



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_tenantId_status_idx" ON "agent_sessions"("tenantId", "status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_sessions_triggerSource_idx" ON "agent_sessions"("triggerSource");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_steps_sessionId_sequence_idx" ON "agent_steps"("sessionId", "sequence");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_steps_tenantId_idx" ON "agent_steps"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_human_gates_sessionId_idx" ON "agent_human_gates"("sessionId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_human_gates_status_expiresAt_idx" ON "agent_human_gates"("status", "expiresAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_human_gates_tenantId_idx" ON "agent_human_gates"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_feedback_userId_createdAt_idx" ON "agent_feedback"("userId", "createdAt" DESC);



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_feedback_sessionId_idx" ON "agent_feedback"("sessionId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_feedback_tenantId_idx" ON "agent_feedback"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "modifier_groups_productId_idx" ON "modifier_groups"("productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "modifier_groups_tenantId_idx" ON "modifier_groups"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "modifier_options_groupId_idx" ON "modifier_options"("groupId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "modifier_options_tenantId_idx" ON "modifier_options"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_variants_productId_idx" ON "product_variants"("productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_variants_tenantId_idx" ON "product_variants"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "combos_productId_key" ON "combos"("productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "combos_tenantId_idx" ON "combos"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "combo_items_comboId_idx" ON "combo_items"("comboId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "combo_items_tenantId_idx" ON "combo_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_item_modifiers_orderItemId_idx" ON "order_item_modifiers"("orderItemId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_item_modifiers_tenantId_idx" ON "order_item_modifiers"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "areas_tenantId_idx" ON "areas"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "diner_tables_qrToken_key" ON "diner_tables"("qrToken");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "diner_tables_areaId_idx" ON "diner_tables"("areaId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "diner_tables_status_idx" ON "diner_tables"("status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "diner_tables_tenantId_idx" ON "diner_tables"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_sessions_tableId_status_idx" ON "table_sessions"("tableId", "status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "table_sessions_tenantId_idx" ON "table_sessions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "reservations_reservedAt_idx" ON "reservations"("reservedAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "reservations_phone_idx" ON "reservations"("phone");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "reservations_tenantId_idx" ON "reservations"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_splits_orderId_idx" ON "bill_splits"("orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_splits_tenantId_idx" ON "bill_splits"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_split_items_splitId_idx" ON "bill_split_items"("splitId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_split_items_tenantId_idx" ON "bill_split_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "kds_stations_tenantId_idx" ON "kds_stations"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "kds_tickets_orderItemId_key" ON "kds_tickets"("orderItemId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "kds_tickets_stationId_status_idx" ON "kds_tickets"("stationId", "status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "kds_tickets_orderId_idx" ON "kds_tickets"("orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "kds_tickets_tenantId_idx" ON "kds_tickets"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "printers_tenantId_idx" ON "printers"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "qr_order_sessions_publicToken_key" ON "qr_order_sessions"("publicToken");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "qr_order_sessions_tableId_idx" ON "qr_order_sessions"("tableId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "qr_order_sessions_status_idx" ON "qr_order_sessions"("status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "qr_order_sessions_tenantId_idx" ON "qr_order_sessions"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "food_delivery_orders_providerOrderId_key" ON "food_delivery_orders"("providerOrderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "food_delivery_orders_provider_status_idx" ON "food_delivery_orders"("provider", "status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "food_delivery_orders_tenantId_idx" ON "food_delivery_orders"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "recipes_productId_key" ON "recipes"("productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "recipes_tenantId_idx" ON "recipes"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "recipe_ingredients_recipeId_idx" ON "recipe_ingredients"("recipeId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "recipe_ingredients_tenantId_idx" ON "recipe_ingredients"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "waste_logs_createdAt_idx" ON "waste_logs"("createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "waste_logs_tenantId_idx" ON "waste_logs"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stamp_card_templates_tenantId_idx" ON "stamp_card_templates"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stamp_cards_customerId_idx" ON "stamp_cards"("customerId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stamp_cards_tenantId_idx" ON "stamp_cards"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_forecasts_type_targetDate_idx" ON "ai_forecasts"("type", "targetDate");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_forecasts_tenantId_idx" ON "ai_forecasts"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_recommendations_status_idx" ON "ai_recommendations"("status");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_recommendations_tenantId_idx" ON "ai_recommendations"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "petty_cash_transactions_createdAt_idx" ON "petty_cash_transactions"("createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "petty_cash_transactions_tenantId_idx" ON "petty_cash_transactions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_accounts_tenantId_idx" ON "bank_accounts"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_accountNumber_tenantId_key" ON "bank_accounts"("accountNumber", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_statement_lines_tenantId_idx" ON "bank_statement_lines"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_statements_tenantId_idx" ON "bank_statements"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_transactions_tenantId_idx" ON "bank_transactions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "bom_items_tenantId_idx" ON "bom_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "boms_tenantId_idx" ON "boms"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "campaign_recipients_tenantId_idx" ON "campaign_recipients"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "campaign_trackings_tenantId_idx" ON "campaign_trackings"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "categories_tenantId_idx" ON "categories"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "categories_name_tenantId_key" ON "categories"("name", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "company_settings_tenantId_idx" ON "company_settings"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_campaigns_tenantId_idx" ON "customer_campaigns"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_notes_tenantId_idx" ON "customer_notes"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_segments_tenantId_idx" ON "customer_segments"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_segments_name_tenantId_key" ON "customer_segments"("name", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_tag_on_customer_tenantId_idx" ON "customer_tag_on_customer"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_tasks_tenantId_idx" ON "customer_tasks"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customers_tenantId_createdAt_idx" ON "customers"("tenantId", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "customers_tenantId_idx" ON "customers"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_tenantId_key" ON "customers"("phone", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "cycle_count_items_cycleCountId_idx" ON "cycle_count_items"("cycleCountId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "cycle_count_items_tenantId_idx" ON "cycle_count_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "cycle_counts_tenantId_idx" ON "cycle_counts"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "debt_payments_debtId_idx" ON "debt_payments"("debtId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "debt_payments_tenantId_idx" ON "debt_payments"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "debts_tenantId_customerId_idx" ON "debts"("tenantId", "customerId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "debts_tenantId_vendorId_idx" ON "debts"("tenantId", "vendorId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "debts_tenantId_idx" ON "debts"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "deliveries_tenantId_idx" ON "deliveries"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_events_deliveryId_idx" ON "delivery_events"("deliveryId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "delivery_events_tenantId_idx" ON "delivery_events"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "depreciation_schedules_tenantId_idx" ON "depreciation_schedules"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "electronic_invoices_tenantId_idx" ON "electronic_invoices"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "employees_tenantId_idx" ON "employees"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "expense_categories_tenantId_idx" ON "expense_categories"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_code_tenantId_key" ON "expense_categories"("code", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "expenses_tenantId_idx" ON "expenses"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "fiscal_periods_tenantId_idx" ON "fiscal_periods"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_periods_tenantId_year_month_key" ON "fiscal_periods"("tenantId", "year", "month");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "fixed_asset_categories_tenantId_idx" ON "fixed_asset_categories"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "fixed_assets_tenantId_idx" ON "fixed_assets"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "integration_configs_tenantId_idx" ON "integration_configs"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventories_tenantId_idx" ON "inventories"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_lots_productId_warehouseId_idx" ON "inventory_lots"("productId", "warehouseId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_lots_tenantId_idx" ON "inventory_lots"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_transactions_tenantId_idx" ON "inventory_transactions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_tenantId_createdAt_idx" ON "invoices"("tenantId", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_tenantId_idx" ON "invoices"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_date_idx" ON "journal_entries"("tenantId", "date");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_status_date_idx" ON "journal_entries"("tenantId", "status", "date");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_entries_tenantId_idx" ON "journal_entries"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_tenantId_idx" ON "journal_lines"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_posting_errors_tenantId_idx" ON "journal_posting_errors"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "lot_transactions_lotId_idx" ON "lot_transactions"("lotId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "lot_transactions_orderId_idx" ON "lot_transactions"("orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "lot_transactions_tenantId_idx" ON "lot_transactions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "loyalty_transactions_tenantId_idx" ON "loyalty_transactions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_listings_tenantId_idx" ON "marketplace_listings"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_shops_tenantId_idx" ON "marketplace_shops"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "marketplace_sync_logs_tenantId_idx" ON "marketplace_sync_logs"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_tenantId_userId_isRead_createdAt_idx" ON "notifications"("tenantId", "userId", "isRead", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_tenantId_roleScope_isRead_createdAt_idx" ON "notifications"("tenantId", "roleScope", "isRead", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "notifications_tenantId_idx" ON "notifications"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_orderId_idx" ON "order_items"("orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_productId_idx" ON "order_items"("productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_tenantId_orderId_idx" ON "order_items"("tenantId", "orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_tenantId_idx" ON "order_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_returns_tenantId_idx" ON "order_returns"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_tenantId_createdAt_idx" ON "orders"("tenantId", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_tenantId_status_createdAt_idx" ON "orders"("tenantId", "status", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_tenantId_idx" ON "orders"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payments_providerTxId_key" ON "payments"("providerTxId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_provider_txStatus_idx" ON "payments"("provider", "txStatus");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_tenantId_orderId_idx" ON "payments"("tenantId", "orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_tenantId_idx" ON "payments"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "payrolls_employeeId_month_year_idx" ON "payrolls"("employeeId", "month", "year");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "payrolls_tenantId_idx" ON "payrolls"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "portal_otps_tenantId_idx" ON "portal_otps"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "portal_sessions_tenantId_idx" ON "portal_sessions"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_tenantId_isActive_createdAt_idx" ON "products"("tenantId", "isActive", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_tenantId_idx" ON "products"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "products_sku_tenantId_key" ON "products"("sku", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_invoices_tenantId_idx" ON "project_invoices"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_members_tenantId_idx" ON "project_members"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_tasks_tenantId_idx" ON "project_tasks"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "projects_tenantId_idx" ON "projects"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "promotion_usages_promotionId_customerId_idx" ON "promotion_usages"("promotionId", "customerId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "promotion_usages_orderId_idx" ON "promotion_usages"("orderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "promotion_usages_tenantId_idx" ON "promotion_usages"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "promotions_tenantId_idx" ON "promotions"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "promotions_code_tenantId_key" ON "promotions"("code", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "purchase_items_purchaseOrderId_idx" ON "purchase_items"("purchaseOrderId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "purchase_items_tenantId_idx" ON "purchase_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "purchase_orders_tenantId_idx" ON "purchase_orders"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "quality_check_items_tenantId_idx" ON "quality_check_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "quality_checks_tenantId_idx" ON "quality_checks"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "recurring_expense_logs_tenantId_idx" ON "recurring_expense_logs"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_tenantId_idx" ON "refresh_tokens"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_schedules_tenantId_idx" ON "report_schedules"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "routing_operations_routingId_idx" ON "routing_operations"("routingId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "routing_operations_tenantId_idx" ON "routing_operations"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "routings_tenantId_idx" ON "routings"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "saved_reports_tenantId_idx" ON "saved_reports"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "shifts_employeeId_date_idx" ON "shifts"("employeeId", "date");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "shifts_tenantId_idx" ON "shifts"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_transfer_items_transferId_idx" ON "stock_transfer_items"("transferId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_transfer_items_productId_idx" ON "stock_transfer_items"("productId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_transfer_items_tenantId_idx" ON "stock_transfer_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_transfers_tenantId_status_createdAt_idx" ON "stock_transfers"("tenantId", "status", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_transfers_tenantId_idx" ON "stock_transfers"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_checkoutSessionId_key" ON "subscription_invoices"("checkoutSessionId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "tax_rates_tenantId_idx" ON "tax_rates"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_code_tenantId_key" ON "tax_rates"("code", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "time_entries_userId_startTime_idx" ON "time_entries"("userId", "startTime");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "time_entries_tenantId_idx" ON "time_entries"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendors_tenantId_idx" ON "vendors"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_code_tenantId_key" ON "vendors"("code", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "violations_employeeId_date_idx" ON "violations"("employeeId", "date");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "violations_tenantId_idx" ON "violations"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "warehouses_tenantId_idx" ON "warehouses"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_code_tenantId_key" ON "warehouses"("code", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "work_centers_tenantId_idx" ON "work_centers"("tenantId");



-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "work_centers_code_tenantId_key" ON "work_centers"("code", "tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "work_order_items_tenantId_idx" ON "work_order_items"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "work_orders_tenantId_status_createdAt_idx" ON "work_orders"("tenantId", "status", "createdAt");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "work_orders_tenantId_idx" ON "work_orders"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_approvals_tenantId_idx" ON "workflow_approvals"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_runs_tenantId_idx" ON "workflow_runs"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_steps_tenantId_idx" ON "workflow_steps"("tenantId");



-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflows_tenantId_idx" ON "workflows"("tenantId");



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permissionKey_fkey' AND conrelid = '"role_permissions"'::regclass) THEN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_backups_createdById_fkey' AND conrelid = '"admin_backups"'::regclass) THEN
    ALTER TABLE "admin_backups" ADD CONSTRAINT "admin_backups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'backup_codes_userId_fkey' AND conrelid = '"backup_codes"'::regclass) THEN
    ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_credit_transactions_customerId_fkey' AND conrelid = '"store_credit_transactions"'::regclass) THEN
    ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_credit_transactions_createdById_fkey' AND conrelid = '"store_credit_transactions"'::regclass) THEN
    ALTER TABLE "store_credit_transactions" ADD CONSTRAINT "store_credit_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_line_items_returnId_fkey' AND conrelid = '"return_line_items"'::regclass) THEN
    ALTER TABLE "return_line_items" ADD CONSTRAINT "return_line_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_line_items_orderItemId_fkey' AND conrelid = '"return_line_items"'::regclass) THEN
    ALTER TABLE "return_line_items" ADD CONSTRAINT "return_line_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_line_items_productId_fkey' AND conrelid = '"return_line_items"'::regclass) THEN
    ALTER TABLE "return_line_items" ADD CONSTRAINT "return_line_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'overtime_requests_employeeId_fkey' AND conrelid = '"overtime_requests"'::regclass) THEN
    ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'serial_numbers_productId_fkey' AND conrelid = '"serial_numbers"'::regclass) THEN
    ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'serial_numbers_warehouseId_fkey' AND conrelid = '"serial_numbers"'::regclass) THEN
    ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'serial_numbers_orderId_fkey' AND conrelid = '"serial_numbers"'::regclass) THEN
    ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_deliveries_endpointId_fkey' AND conrelid = '"webhook_deliveries"'::regclass) THEN
    ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_sessions_userId_fkey' AND conrelid = '"agent_sessions"'::regclass) THEN
    ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_steps_sessionId_fkey' AND conrelid = '"agent_steps"'::regclass) THEN
    ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_human_gates_sessionId_fkey' AND conrelid = '"agent_human_gates"'::regclass) THEN
    ALTER TABLE "agent_human_gates" ADD CONSTRAINT "agent_human_gates_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_human_gates_decidedById_fkey' AND conrelid = '"agent_human_gates"'::regclass) THEN
    ALTER TABLE "agent_human_gates" ADD CONSTRAINT "agent_human_gates_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feedback_sessionId_fkey' AND conrelid = '"agent_feedback"'::regclass) THEN
    ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_feedback_userId_fkey' AND conrelid = '"agent_feedback"'::regclass) THEN
    ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modifier_groups_productId_fkey' AND conrelid = '"modifier_groups"'::regclass) THEN
    ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modifier_options_groupId_fkey' AND conrelid = '"modifier_options"'::regclass) THEN
    ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_productId_fkey' AND conrelid = '"product_variants"'::regclass) THEN
    ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'combos_productId_fkey' AND conrelid = '"combos"'::regclass) THEN
    ALTER TABLE "combos" ADD CONSTRAINT "combos_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'combo_items_comboId_fkey' AND conrelid = '"combo_items"'::regclass) THEN
    ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'combo_items_productId_fkey' AND conrelid = '"combo_items"'::regclass) THEN
    ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_modifiers_orderItemId_fkey' AND conrelid = '"order_item_modifiers"'::regclass) THEN
    ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_modifiers_modifierOptionId_fkey' AND conrelid = '"order_item_modifiers"'::regclass) THEN
    ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifierOptionId_fkey" FOREIGN KEY ("modifierOptionId") REFERENCES "modifier_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diner_tables_areaId_fkey' AND conrelid = '"diner_tables"'::regclass) THEN
    ALTER TABLE "diner_tables" ADD CONSTRAINT "diner_tables_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_sessions_tableId_fkey' AND conrelid = '"table_sessions"'::regclass) THEN
    ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "diner_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_splits_orderId_fkey' AND conrelid = '"bill_splits"'::regclass) THEN
    ALTER TABLE "bill_splits" ADD CONSTRAINT "bill_splits_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_split_items_splitId_fkey' AND conrelid = '"bill_split_items"'::regclass) THEN
    ALTER TABLE "bill_split_items" ADD CONSTRAINT "bill_split_items_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "bill_splits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kds_tickets_stationId_fkey' AND conrelid = '"kds_tickets"'::regclass) THEN
    ALTER TABLE "kds_tickets" ADD CONSTRAINT "kds_tickets_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kds_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_productId_fkey' AND conrelid = '"recipes"'::regclass) THEN
    ALTER TABLE "recipes" ADD CONSTRAINT "recipes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_ingredients_recipeId_fkey' AND conrelid = '"recipe_ingredients"'::regclass) THEN
    ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stamp_cards_customerId_fkey' AND conrelid = '"stamp_cards"'::regclass) THEN
    ALTER TABLE "stamp_cards" ADD CONSTRAINT "stamp_cards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stamp_cards_templateId_fkey' AND conrelid = '"stamp_cards"'::regclass) THEN
    ALTER TABLE "stamp_cards" ADD CONSTRAINT "stamp_cards_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "stamp_card_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;



-- AddForeignKey
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_embeddings') THEN
    ALTER TABLE "ai_embeddings" ADD CONSTRAINT "ai_embeddings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "ai_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;



-- RenameIndex
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_cycle_count_items_product_warehouse') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'cycle_count_items_productId_warehouseId_idx') THEN
    ALTER INDEX "idx_cycle_count_items_product_warehouse" RENAME TO "cycle_count_items_productId_warehouseId_idx";
  END IF;
END
$$;
