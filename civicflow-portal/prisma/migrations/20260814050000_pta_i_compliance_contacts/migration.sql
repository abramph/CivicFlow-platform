-- CreateEnum
CREATE TYPE "PtaComplianceRecurrence" AS ENUM ('NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttachmentEntityType" ADD VALUE 'ORGANIZATION_CONTACT';
ALTER TYPE "AttachmentEntityType" ADD VALUE 'COMPLIANCE_REQUIREMENT';

-- CreateTable
CREATE TABLE "PtaComplianceRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "recurrence" "PtaComplianceRecurrence" NOT NULL DEFAULT 'NONE',
    "isApplicable" BOOLEAN NOT NULL DEFAULT true,
    "lastCompletedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaComplianceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "isVendor" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaComplianceRequirement_organizationId_idx" ON "PtaComplianceRequirement"("organizationId");

-- CreateIndex
CREATE INDEX "PtaComplianceRequirement_organizationId_dueDate_idx" ON "PtaComplianceRequirement"("organizationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PtaComplianceRequirement_organizationId_title_key" ON "PtaComplianceRequirement"("organizationId", "title");

-- CreateIndex
CREATE INDEX "OrganizationContact_organizationId_idx" ON "OrganizationContact"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationContact_organizationId_isVendor_idx" ON "OrganizationContact"("organizationId", "isVendor");

-- CreateIndex
CREATE INDEX "OrganizationContact_organizationId_isActive_idx" ON "OrganizationContact"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationContact_organizationId_name_key" ON "OrganizationContact"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "PtaComplianceRequirement" ADD CONSTRAINT "PtaComplianceRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationContact" ADD CONSTRAINT "OrganizationContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

