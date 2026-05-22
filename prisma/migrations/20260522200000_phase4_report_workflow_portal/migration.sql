-- Phase 4: Report Builder, Workflow Engine, Customer Portal, SMS/Zalo

-- ===================== 4.1 Report Builder =====================

CREATE TABLE saved_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  config       JSONB NOT NULL,           -- { table, fields, filters, groupBy, orderBy }
  "isPublic"   BOOLEAN DEFAULT false,
  "createdById" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt"  TIMESTAMP DEFAULT NOW(),
  "updatedAt"  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE report_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reportId"     UUID NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  cron           VARCHAR(50) NOT NULL,   -- cron expression
  "emailTo"      TEXT[],
  "lastRunAt"    TIMESTAMP,
  "nextRunAt"    TIMESTAMP,
  "isActive"     BOOLEAN DEFAULT true,
  "createdAt"    TIMESTAMP DEFAULT NOW()
);

-- ===================== 4.2 Workflow Engine =====================

CREATE TABLE workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  trigger     VARCHAR(50) NOT NULL,      -- EXPENSE_ABOVE / PO_ABOVE / LEAVE_REQUEST / CUSTOM
  config      JSONB NOT NULL DEFAULT '{}',
  "isActive"  BOOLEAN DEFAULT true,
  "createdById" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE workflow_steps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflowId" UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  sequence     INT NOT NULL,
  type         VARCHAR(30) NOT NULL,     -- APPROVAL / NOTIFY / AUTO_ACTION
  config       JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE workflow_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflowId" UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  entity       VARCHAR(50) NOT NULL,     -- Expense / PurchaseOrder
  "entityId"   UUID NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING / APPROVED / REJECTED / CANCELLED
  data         JSONB,
  "startedAt"  TIMESTAMP DEFAULT NOW(),
  "endedAt"    TIMESTAMP
);

CREATE TABLE workflow_approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "runId"     UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  "stepId"    UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  "approverId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING / APPROVED / REJECTED
  comment     TEXT,
  "decidedAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

-- ===================== 4.3 Customer Portal =====================

CREATE TABLE portal_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token       VARCHAR(200) UNIQUE NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE portal_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       VARCHAR(20) NOT NULL,
  otp         VARCHAR(6) NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  used        BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_portal_otps_phone ON portal_otps(phone, used);

-- ===================== 4.4 SMS/Zalo tracking =====================

ALTER TABLE customer_campaigns ADD COLUMN IF NOT EXISTS "opens" INT DEFAULT 0;
ALTER TABLE customer_campaigns ADD COLUMN IF NOT EXISTS "clicks" INT DEFAULT 0;
ALTER TABLE customer_campaigns ADD COLUMN IF NOT EXISTS "cost" NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE customer_campaigns ADD COLUMN IF NOT EXISTS "revenue" NUMERIC(12, 2) DEFAULT 0;

CREATE TABLE campaign_trackings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" UUID NOT NULL,
  "recipientId" UUID REFERENCES customers(id) ON DELETE SET NULL,
  event        VARCHAR(20) NOT NULL,    -- SENT / OPENED / CLICKED / CONVERTED
  metadata     JSONB,
  "createdAt"  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_campaign_trackings_campaign ON campaign_trackings("campaignId");
