-- CreateEnum
CREATE TYPE "HouseholdGivingPrivacyMode" AS ENUM ('INDIVIDUAL_PRIVATE', 'HOUSEHOLD_SHARED', 'HOUSEHOLD_STATEMENT_ONLY');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "householdId" TEXT;

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "householdGivingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "householdGivingPrivacyMode" "HouseholdGivingPrivacyMode" NOT NULL DEFAULT 'INDIVIDUAL_PRIVATE';

-- AlterTable
ALTER TABLE "ContributionStatement" ADD COLUMN     "householdId" TEXT;

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Household_organizationId_idx" ON "Household"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Household_organizationId_name_key" ON "Household"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ContributionStatement_householdId_idx" ON "ContributionStatement"("householdId");

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionStatement" ADD CONSTRAINT "ContributionStatement_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

