-- CreateEnum
CREATE TYPE "ContributionStatementStatus" AS ENUM ('GENERATED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "ContributionStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "contributorUserId" TEXT,
    "year" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContributionStatementStatus" NOT NULL DEFAULT 'GENERATED',
    "supersededById" TEXT,
    "reason" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "contributionCount" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributionStatement_organizationId_idx" ON "ContributionStatement"("organizationId");

-- CreateIndex
CREATE INDEX "ContributionStatement_organizationId_year_idx" ON "ContributionStatement"("organizationId", "year");

-- CreateIndex
CREATE INDEX "ContributionStatement_memberId_idx" ON "ContributionStatement"("memberId");

-- CreateIndex
CREATE INDEX "ContributionStatement_contributorUserId_idx" ON "ContributionStatement"("contributorUserId");

-- AddForeignKey
ALTER TABLE "ContributionStatement" ADD CONSTRAINT "ContributionStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionStatement" ADD CONSTRAINT "ContributionStatement_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionStatement" ADD CONSTRAINT "ContributionStatement_contributorUserId_fkey" FOREIGN KEY ("contributorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionStatement" ADD CONSTRAINT "ContributionStatement_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

