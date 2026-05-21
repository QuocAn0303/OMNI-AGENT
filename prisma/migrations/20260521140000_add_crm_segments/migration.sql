-- CRM Phase 3: Customer segments

CREATE TABLE "customer_segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rules" JSONB NOT NULL,
    "customerCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_segments_name_key" ON "customer_segments"("name");

ALTER TABLE "customer_segments"
    ADD CONSTRAINT "customer_segments_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
