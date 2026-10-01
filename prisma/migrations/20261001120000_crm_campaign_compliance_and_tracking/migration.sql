-- CRM Phase 4 — Campaign compliance + CampaignTracking wiring
--   1. CampaignRecipient: consent / opt-out / 2 token (Nghị định 13/2023)
--   2. CampaignTracking: sửa 2 quan hệ đang trỏ sai + event String → enum
--
-- CHỈ DDL + dọn dữ liệu bắt buộc cho FK. KHÔNG backfill `consentedAt`:
-- ghi consent giả (đặt = createdAt) là sai về pháp lý — đồng ý phải do
-- người nhận thực hiện. Campaign gửi trước migration này sẽ có
-- consentedAt = NULL, và executeCampaign coi đó là "chưa có consent"
-- (xem consentPolicy trong campaigns.service.js).

-- ============================================================
-- 1. Enum sự kiện tracking
-- ============================================================

CREATE TYPE "CampaignTrackingEvent" AS ENUM ('SENT', 'OPEN', 'CLICK', 'BOUNCE', 'UNSUBSCRIBE');

-- Guard: `event` đang là TEXT tự do. Nếu có giá trị ngoài enum thì KHÔNG ép
-- im lặng — dừng lại để người vận hành quyết định mapping.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "campaign_trackings"
    WHERE "event" NOT IN ('SENT', 'OPEN', 'CLICK', 'BOUNCE', 'UNSUBSCRIBE')
  ) THEN
    RAISE EXCEPTION
      'campaign_trackings.event có giá trị ngoài CampaignTrackingEvent. Cần quyết định mapping (UPDATE ... SET "event" = ...) rồi chạy lại migration.';
  END IF;
END $$;

ALTER TABLE "campaign_trackings"
  ALTER COLUMN "event" DROP DEFAULT,
  ALTER COLUMN "event" TYPE "CampaignTrackingEvent"
    USING ("event"::"CampaignTrackingEvent");

-- ============================================================
-- 2. CampaignRecipient — consent + opt-out + token
-- ============================================================

ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "consentedAt" TIMESTAMP(3);
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "unsubscribedAt" TIMESTAMP(3);
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "unsubscribeReason" TEXT;

-- Token ngẫu nhiên sinh lúc gửi (không backfill): cột unique + NULL vẫn cho
-- nhiều NULL cùng tồn tại, nên thêm index không cần lo trùng.
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "unsubscribeToken" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "trackingToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_unsubscribeToken_key"
  ON "campaign_recipients"("unsubscribeToken");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_trackingToken_key"
  ON "campaign_recipients"("trackingToken");

-- Truy vấn chính của compliance: "recipient nào đã từ chối" theo chiến dịch
CREATE INDEX IF NOT EXISTS "campaign_recipients_campaignId_unsubscribedAt_idx"
  ON "campaign_recipients"("campaignId", "unsubscribedAt");

-- ============================================================
-- 3. CampaignTracking — sửa quan hệ
-- ============================================================

-- 3a. recipientId cũ trỏ sang customers(id) (sai schema, không model nào ghi được).
--     Map sang campaign_recipients theo (campaignId, customerId); phần không
--     map được → NULL = sự kiện ở cấp chiến dịch.
UPDATE "campaign_trackings" t
SET "recipientId" = r."id"
FROM "campaign_recipients" r
WHERE r."customerId" = t."recipientId" AND r."campaignId" = t."campaignId";

UPDATE "campaign_trackings" t
SET "recipientId" = NULL
WHERE t."recipientId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "campaign_recipients" r WHERE r."id" = t."recipientId");

-- 3b. Bỏ FK cũ trỏ customers, trỏ lại CampaignRecipient
ALTER TABLE "campaign_trackings" DROP CONSTRAINT IF EXISTS "campaign_trackings_recipientId_fkey";

ALTER TABLE "campaign_trackings"
  ADD CONSTRAINT "campaign_trackings_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "campaign_recipients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3c. campaignId trước đây là String TRẦN, không FK. Thêm FK nhưng guard trước:
--     campaignId không tồn tại = hỏng dữ liệu thật, không tự bịa được.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "campaign_trackings" t
    LEFT JOIN "customer_campaigns" c ON c."id" = t."campaignId"
    WHERE c."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'campaign_trackings.campaignId có giá trị không tồn tại trong customer_campaigns. Không thêm FK tự động — cần dọn dữ liệu trước.';
  END IF;
END $$;

ALTER TABLE "campaign_trackings"
  ADD CONSTRAINT "campaign_trackings_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "customer_campaigns"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Index phục vụ bảng thống kê (funnel: sent → open → click)
DROP INDEX IF EXISTS "campaign_trackings_campaignId_idx";
CREATE INDEX IF NOT EXISTS "campaign_trackings_campaignId_event_idx"
  ON "campaign_trackings"("campaignId", "event");
CREATE INDEX IF NOT EXISTS "campaign_trackings_recipientId_event_idx"
  ON "campaign_trackings"("recipientId", "event");