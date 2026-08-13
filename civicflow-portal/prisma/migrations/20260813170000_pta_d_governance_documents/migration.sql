-- CreateEnum
CREATE TYPE "GovernanceDocumentType" AS ENUM ('BYLAWS', 'STANDING_RULES', 'POLICY', 'PROCEDURE', 'CONFLICT_OF_INTEREST', 'FINANCIAL_PROCEDURES', 'ELECTION_RULES', 'CODE_OF_CONDUCT', 'RESOLUTION', 'OTHER');

-- CreateEnum
CREATE TYPE "GovernanceDocumentStatus" AS ENUM ('DRAFT', 'CURRENT', 'SUPERSEDED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'ORGANIZATION_DOCUMENT';

-- CreateTable
CREATE TABLE "GovernanceDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rootDocumentId" TEXT,
    "title" TEXT NOT NULL,
    "docType" "GovernanceDocumentType" NOT NULL DEFAULT 'OTHER',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "GovernanceDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "approvedDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "notes" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "objectKey" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovernanceDocument_organizationId_idx" ON "GovernanceDocument"("organizationId");

-- CreateIndex
CREATE INDEX "GovernanceDocument_organizationId_docType_idx" ON "GovernanceDocument"("organizationId", "docType");

-- CreateIndex
CREATE INDEX "GovernanceDocument_organizationId_status_idx" ON "GovernanceDocument"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GovernanceDocument_rootDocumentId_idx" ON "GovernanceDocument"("rootDocumentId");

-- AddForeignKey
ALTER TABLE "GovernanceDocument" ADD CONSTRAINT "GovernanceDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceDocument" ADD CONSTRAINT "GovernanceDocument_rootDocumentId_fkey" FOREIGN KEY ("rootDocumentId") REFERENCES "GovernanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceDocument" ADD CONSTRAINT "GovernanceDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

