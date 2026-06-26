-- CreateTable
CREATE TABLE "admin_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "tenantName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "admin_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_campaign_recipients_campaignId_status_idx" ON "admin_campaign_recipients"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "admin_campaign_recipients" ADD CONSTRAINT "admin_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "admin_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_campaign_recipients" ADD CONSTRAINT "admin_campaign_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
