-- Phase 4: Report Builder, Workflow Engine, Customer Portal, SMS/Zalo
-- (idempotent + TEXT ids)

-- ===================== 4.1 Report Builder =====================

CREATE TABLE IF NOT EXISTS "saved_reports" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "config"      JSONB NOT NULL,
  "isPublic"    BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_reports_createdById_fkey') THEN
    ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "report_schedules" (
  "id"        TEXT NOT NULL,
  "reportId"  TEXT NOT NULL,
  "cron"      TEXT NOT NULL,
  "emailTo"   TEXT[],
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_schedules_reportId_fkey') THEN
    ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ===================== 4.2 Workflow Engine =====================

CREATE TABLE IF NOT EXISTS "workflows" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "trigger"     TEXT NOT NULL,
  "config"      JSONB NOT NULL DEFAULT '{}',
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflows_createdById_fkey') THEN
    ALTER TABLE "workflows" ADD CONSTRAINT "workflows_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workflow_steps" (
  "id"         TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "sequence"   INTEGER NOT NULL,
  "type"       TEXT NOT NULL,
  "config"     JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_steps_workflowId_fkey') THEN
    ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id"         TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "entity"     TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "data"       JSONB,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"    TIMESTAMP(3),
  CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_runs_workflowId_fkey') THEN
    ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workflow_approvals" (
  "id"         TEXT NOT NULL,
  "runId"      TEXT NOT NULL,
  "stepId"     TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "comment"    TEXT,
  "decidedAt"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_approvals_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_approvals_runId_fkey') THEN
    ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_approvals_stepId_fkey') THEN
    ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_stepId_fkey"
      FOREIGN KEY ("stepId") REFERENCES "workflow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_approvals_approverId_fkey') THEN
    ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_approverId_fkey"
      FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ===================== 4.3 Customer Portal =====================

CREATE TABLE IF NOT EXISTS "portal_sessions" (
  "id"         TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "portal_sessions_token_key" ON "portal_sessions"("token");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_sessions_customerId_fkey') THEN
    ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "portal_otps" (
  "id"        TEXT NOT NULL,
  "phone"     TEXT NOT NULL,
  "otp"       TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "used"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_otps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portal_otps_phone_used_idx" ON "portal_otps"("phone", "used");

-- ===================== 4.4 SMS/Zalo tracking =====================

ALTER TABLE "customer_campaigns" ADD COLUMN IF NOT EXISTS "opens"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customer_campaigns" ADD COLUMN IF NOT EXISTS "clicks"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customer_campaigns" ADD COLUMN IF NOT EXISTS "cost"    DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "customer_campaigns" ADD COLUMN IF NOT EXISTS "revenue" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "campaign_trackings" (
  "id"          TEXT NOT NULL,
  "campaignId"  TEXT NOT NULL,
  "recipientId" TEXT,
  "event"       TEXT NOT NULL,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_trackings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "campaign_trackings_campaignId_idx" ON "campaign_trackings"("campaignId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_trackings_recipientId_fkey') THEN
    ALTER TABLE "campaign_trackings" ADD CONSTRAINT "campaign_trackings_recipientId_fkey"
      FOREIGN KEY ("recipientId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
