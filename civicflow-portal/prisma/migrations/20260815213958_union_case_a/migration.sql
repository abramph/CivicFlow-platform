-- CreateEnum
CREATE TYPE "UnionCaseStatus" AS ENUM ('NEW', 'TRIAGE', 'ASSIGNED', 'ACTIVE', 'PENDING', 'RESOLVED', 'CLOSED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'UNION_CASE';

-- AlterEnum
ALTER TYPE "ReminderType" ADD VALUE 'UNION_CASE_DEADLINE';

-- CreateTable
CREATE TABLE "UnionCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberOrgMemberId" TEXT NOT NULL,
    "assignedToOrgMemberId" TEXT,
    "caseNumber" SERIAL NOT NULL,
    "caseType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "UnionCaseStatus" NOT NULL DEFAULT 'NEW',
    "isFormalGrievance" BOOLEAN NOT NULL DEFAULT false,
    "representationRequested" BOOLEAN NOT NULL DEFAULT false,
    "incidentDate" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionSummary" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnionCaseComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnionCaseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnionCaseStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStatus" "UnionCaseStatus",
    "toStatus" "UnionCaseStatus" NOT NULL,
    "changedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnionCaseStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnionCaseContractReference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnionCaseContractReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnionCaseDeadline" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "deadlineType" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "responsibleOrgMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnionCaseDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnionCase_organizationId_idx" ON "UnionCase"("organizationId");

-- CreateIndex
CREATE INDEX "UnionCase_organizationId_status_idx" ON "UnionCase"("organizationId", "status");

-- CreateIndex
CREATE INDEX "UnionCase_organizationId_memberOrgMemberId_idx" ON "UnionCase"("organizationId", "memberOrgMemberId");

-- CreateIndex
CREATE INDEX "UnionCase_organizationId_assignedToOrgMemberId_idx" ON "UnionCase"("organizationId", "assignedToOrgMemberId");

-- CreateIndex
CREATE INDEX "UnionCaseComment_organizationId_idx" ON "UnionCaseComment"("organizationId");

-- CreateIndex
CREATE INDEX "UnionCaseComment_caseId_idx" ON "UnionCaseComment"("caseId");

-- CreateIndex
CREATE INDEX "UnionCaseStatusHistory_organizationId_idx" ON "UnionCaseStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "UnionCaseStatusHistory_caseId_idx" ON "UnionCaseStatusHistory"("caseId");

-- CreateIndex
CREATE INDEX "UnionCaseContractReference_organizationId_idx" ON "UnionCaseContractReference"("organizationId");

-- CreateIndex
CREATE INDEX "UnionCaseContractReference_caseId_idx" ON "UnionCaseContractReference"("caseId");

-- CreateIndex
CREATE INDEX "UnionCaseDeadline_organizationId_idx" ON "UnionCaseDeadline"("organizationId");

-- CreateIndex
CREATE INDEX "UnionCaseDeadline_caseId_idx" ON "UnionCaseDeadline"("caseId");

-- CreateIndex
CREATE INDEX "UnionCaseDeadline_organizationId_dueAt_idx" ON "UnionCaseDeadline"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "UnionCaseDeadline_organizationId_completedAt_idx" ON "UnionCaseDeadline"("organizationId", "completedAt");

-- AddForeignKey
ALTER TABLE "UnionCase" ADD CONSTRAINT "UnionCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCase" ADD CONSTRAINT "UnionCase_memberOrgMemberId_fkey" FOREIGN KEY ("memberOrgMemberId") REFERENCES "OrgMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCase" ADD CONSTRAINT "UnionCase_assignedToOrgMemberId_fkey" FOREIGN KEY ("assignedToOrgMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseComment" ADD CONSTRAINT "UnionCaseComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseComment" ADD CONSTRAINT "UnionCaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "UnionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseStatusHistory" ADD CONSTRAINT "UnionCaseStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseStatusHistory" ADD CONSTRAINT "UnionCaseStatusHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "UnionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseContractReference" ADD CONSTRAINT "UnionCaseContractReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseContractReference" ADD CONSTRAINT "UnionCaseContractReference_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "UnionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseDeadline" ADD CONSTRAINT "UnionCaseDeadline_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseDeadline" ADD CONSTRAINT "UnionCaseDeadline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "UnionCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseDeadline" ADD CONSTRAINT "UnionCaseDeadline_responsibleOrgMemberId_fkey" FOREIGN KEY ("responsibleOrgMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
