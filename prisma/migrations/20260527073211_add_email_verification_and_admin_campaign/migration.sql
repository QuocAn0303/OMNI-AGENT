-- CreateEnum
CREATE TYPE "AdminCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'DONE');

-- CreateEnum
CREATE TYPE "AdminCampaignChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifyExpiry" TIMESTAMP(3),
ADD COLUMN     "emailVerifyToken" TEXT,
ADD COLUMN     "registrationStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "admin_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "AdminCampaignChannel" NOT NULL,
    "targetPlans" TEXT[],
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "AdminCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_campaigns_pkey" PRIMARY KEY ("id")
);
