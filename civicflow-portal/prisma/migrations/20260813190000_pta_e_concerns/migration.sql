-- CreateEnum
CREATE TYPE "PtaConcernCategory" AS ENUM ('BYLAWS_CONCERN', 'OFFICER_CONDUCT', 'MEMBER_CONDUCT', 'ELECTION_CONCERN', 'FINANCIAL_CONCERN', 'VOLUNTEER_CONCERN', 'EVENT_ISSUE', 'POLICY_VIOLATION', 'CONFLICT_OF_INTEREST', 'MEMBERSHIP_DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "PtaConcernStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'INFORMAL_RESOLUTION', 'FORMAL_REVIEW', 'AWAITING_RESPONSE', 'RESOLVED', 'DISMISSED', 'APPEALED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PtaConcernNoteKind" AS ENUM ('NOTE', 'COMMUNICATION', 'ACTION');

-- AlterTable
ALTER TABLE "PtaProfile" ADD COLUMN     "concernsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "concernsLabel" TEXT;

-- CreateTable
CREATE TABLE "PtaConcern" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "PtaConcernCategory" NOT NULL DEFAULT 'OTHER',
    "status" "PtaConcernStatus" NOT NULL DEFAULT 'SUBMITTED',
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "reporterName" TEXT,
    "reporterContact" TEXT,
    "subjectName" TEXT,
    "incidentDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseDeadline" TIMESTAMP(3),
    "assignedCommitteeId" TEXT,
    "applicableGovernanceDocumentId" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "appealNotes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaConcern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaConcernAssignee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "concernId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaConcernAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaConcernNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "concernId" TEXT NOT NULL,
    "kind" "PtaConcernNoteKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaConcernNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaConcern_organizationId_idx" ON "PtaConcern"("organizationId");

-- CreateIndex
CREATE INDEX "PtaConcern_organizationId_status_idx" ON "PtaConcern"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaConcern_organizationId_isRestricted_idx" ON "PtaConcern"("organizationId", "isRestricted");

-- CreateIndex
CREATE UNIQUE INDEX "PtaConcern_organizationId_caseNumber_key" ON "PtaConcern"("organizationId", "caseNumber");

-- CreateIndex
CREATE INDEX "PtaConcernAssignee_organizationId_idx" ON "PtaConcernAssignee"("organizationId");

-- CreateIndex
CREATE INDEX "PtaConcernAssignee_userId_idx" ON "PtaConcernAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaConcernAssignee_concernId_userId_key" ON "PtaConcernAssignee"("concernId", "userId");

-- CreateIndex
CREATE INDEX "PtaConcernNote_organizationId_idx" ON "PtaConcernNote"("organizationId");

-- CreateIndex
CREATE INDEX "PtaConcernNote_concernId_idx" ON "PtaConcernNote"("concernId");

-- AddForeignKey
ALTER TABLE "PtaConcern" ADD CONSTRAINT "PtaConcern_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcern" ADD CONSTRAINT "PtaConcern_assignedCommitteeId_fkey" FOREIGN KEY ("assignedCommitteeId") REFERENCES "PtaCommittee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcern" ADD CONSTRAINT "PtaConcern_applicableGovernanceDocumentId_fkey" FOREIGN KEY ("applicableGovernanceDocumentId") REFERENCES "GovernanceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcern" ADD CONSTRAINT "PtaConcern_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernAssignee" ADD CONSTRAINT "PtaConcernAssignee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernAssignee" ADD CONSTRAINT "PtaConcernAssignee_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "PtaConcern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernAssignee" ADD CONSTRAINT "PtaConcernAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernAssignee" ADD CONSTRAINT "PtaConcernAssignee_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernNote" ADD CONSTRAINT "PtaConcernNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernNote" ADD CONSTRAINT "PtaConcernNote_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "PtaConcern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaConcernNote" ADD CONSTRAINT "PtaConcernNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

