-- CreateEnum
CREATE TYPE "ArchitecturalRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'CONDITIONALLY_APPROVED', 'DENIED', 'WITHDRAWN', 'EXPIRED');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'HOA_ARCHITECTURAL_REQUEST';

-- CreateTable
CREATE TABLE "ArchitecturalRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "submittedByOrgMemberId" TEXT NOT NULL,
    "requestNumber" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectDescription" TEXT NOT NULL,
    "proposedStartDate" TIMESTAMP(3),
    "proposedCompletionDate" TIMESTAMP(3),
    "status" "ArchitecturalRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionSummary" TEXT,
    "conditions" TEXT,
    "expirationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchitecturalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchitecturalRequestComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchitecturalRequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchitecturalRequestStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "ArchitecturalRequestStatus",
    "toStatus" "ArchitecturalRequestStatus" NOT NULL,
    "changedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchitecturalRequestStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchitecturalRequest_organizationId_idx" ON "ArchitecturalRequest"("organizationId");

-- CreateIndex
CREATE INDEX "ArchitecturalRequest_organizationId_propertyId_idx" ON "ArchitecturalRequest"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "ArchitecturalRequest_organizationId_status_idx" ON "ArchitecturalRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ArchitecturalRequestComment_organizationId_idx" ON "ArchitecturalRequestComment"("organizationId");

-- CreateIndex
CREATE INDEX "ArchitecturalRequestComment_requestId_idx" ON "ArchitecturalRequestComment"("requestId");

-- CreateIndex
CREATE INDEX "ArchitecturalRequestStatusHistory_organizationId_idx" ON "ArchitecturalRequestStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "ArchitecturalRequestStatusHistory_requestId_idx" ON "ArchitecturalRequestStatusHistory"("requestId");

-- AddForeignKey
ALTER TABLE "ArchitecturalRequest" ADD CONSTRAINT "ArchitecturalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitecturalRequest" ADD CONSTRAINT "ArchitecturalRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitecturalRequest" ADD CONSTRAINT "ArchitecturalRequest_submittedByOrgMemberId_fkey" FOREIGN KEY ("submittedByOrgMemberId") REFERENCES "OrgMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitecturalRequestComment" ADD CONSTRAINT "ArchitecturalRequestComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitecturalRequestComment" ADD CONSTRAINT "ArchitecturalRequestComment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ArchitecturalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitecturalRequestStatusHistory" ADD CONSTRAINT "ArchitecturalRequestStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchitecturalRequestStatusHistory" ADD CONSTRAINT "ArchitecturalRequestStatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ArchitecturalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
