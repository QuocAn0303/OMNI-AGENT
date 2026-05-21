-- CRM Phase 4: Customer campaigns (Email + Zalo OA)

CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'ZALO');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED');
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BOUNCED');

CREATE TABLE "customer_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "segmentId" TEXT NOT NULL,
    "subject" TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "stats" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_campaigns_status_scheduledAt_idx"
    ON "customer_campaigns"("status", "scheduledAt");

ALTER TABLE "customer_campaigns"
    ADD CONSTRAINT "customer_campaigns_segmentId_fkey"
    FOREIGN KEY ("segmentId") REFERENCES "customer_segments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_campaigns"
    ADD CONSTRAINT "customer_campaigns_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_recipients_campaignId_status_idx"
    ON "campaign_recipients"("campaignId", "status");

ALTER TABLE "campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "customer_campaigns"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_recipients"
    ADD CONSTRAINT "campaign_recipients_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
