-- CRM Phase 1: Customer notes + tags

CREATE TYPE "CustomerNoteType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'ZALO');

CREATE TABLE "customer_notes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "CustomerNoteType" NOT NULL DEFAULT 'NOTE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_notes_customerId_createdAt_idx" ON "customer_notes"("customerId", "createdAt");

ALTER TABLE "customer_notes"
    ADD CONSTRAINT "customer_notes_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_notes"
    ADD CONSTRAINT "customer_notes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "customer_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0f766e',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_tags_name_key" ON "customer_tags"("name");

CREATE TABLE "customer_tag_on_customer" (
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_tag_on_customer_pkey" PRIMARY KEY ("customerId", "tagId")
);

ALTER TABLE "customer_tag_on_customer"
    ADD CONSTRAINT "customer_tag_on_customer_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_tag_on_customer"
    ADD CONSTRAINT "customer_tag_on_customer_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "customer_tags"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
