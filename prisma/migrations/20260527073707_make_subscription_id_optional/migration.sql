-- DropForeignKey
ALTER TABLE "subscription_invoices" DROP CONSTRAINT "subscription_invoices_subscriptionId_fkey";

-- AlterTable
ALTER TABLE "subscription_invoices" ALTER COLUMN "subscriptionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "tenant_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
