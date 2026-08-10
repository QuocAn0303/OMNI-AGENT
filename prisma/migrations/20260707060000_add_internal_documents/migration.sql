-- CreateTable: departments
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_tenantId_idx" ON "departments"("tenantId");

-- AlterTable: employees add departmentId
ALTER TABLE "employees" ADD COLUMN "departmentId" TEXT;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: internal_documents
CREATE TABLE "internal_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "sendToAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_documents_tenantId_idx" ON "internal_documents"("tenantId");

-- AddForeignKey
ALTER TABLE "internal_documents" ADD CONSTRAINT "internal_documents_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: internal_document_departments
CREATE TABLE "internal_document_departments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "internal_document_departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_document_departments_documentId_departmentId_key" ON "internal_document_departments"("documentId", "departmentId");

-- AddForeignKey
ALTER TABLE "internal_document_departments" ADD CONSTRAINT "internal_document_departments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "internal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_document_departments" ADD CONSTRAINT "internal_document_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
