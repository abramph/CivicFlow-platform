-- Generic organization-scoped attachments for documents, logos, receipts, reports, and communication files.
CREATE TYPE "AttachmentEntityType" AS ENUM (
  'ORGANIZATION',
  'MEMBER',
  'CAMPAIGN',
  'EVENT',
  'MEETING',
  'COMMUNICATION_CAMPAIGN',
  'RECEIPT',
  'REPORT_EXPORT',
  'EXPENDITURE',
  'CONTRIBUTION',
  'OTHER'
);

CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entityType" "AttachmentEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "purpose" TEXT,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "objectKey" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "uploadedByUserId" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "deletedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Attachment_organizationId_idx" ON "Attachment"("organizationId");
CREATE INDEX "Attachment_organizationId_entityType_entityId_idx" ON "Attachment"("organizationId", "entityType", "entityId");
CREATE INDEX "Attachment_organizationId_purpose_idx" ON "Attachment"("organizationId", "purpose");
CREATE INDEX "Attachment_uploadedByUserId_idx" ON "Attachment"("uploadedByUserId");
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
