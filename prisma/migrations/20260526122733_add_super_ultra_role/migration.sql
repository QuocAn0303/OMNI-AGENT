/*
  Warnings:

  - A unique constraint covering the columns `[name,tenantId]` on the table `customer_tags` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SupportSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_OMEGA_ULTRA_ADMIN';

-- DropIndex
DROP INDEX "customer_tags_name_key";

-- AlterTable
ALTER TABLE "customer_tags" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "support_access_sessions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SupportSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedById" TEXT,

    CONSTRAINT "support_access_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_access_sessions_tenantId_idx" ON "support_access_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "support_access_sessions_adminId_idx" ON "support_access_sessions"("adminId");

-- CreateIndex
CREATE INDEX "support_access_sessions_status_expiresAt_idx" ON "support_access_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "customer_tags_tenantId_idx" ON "customer_tags"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tags_name_tenantId_key" ON "customer_tags"("name", "tenantId");

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_sessions" ADD CONSTRAINT "support_access_sessions_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
