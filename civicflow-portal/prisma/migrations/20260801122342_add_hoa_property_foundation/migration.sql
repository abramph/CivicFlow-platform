-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('SINGLE_FAMILY', 'CONDO_UNIT', 'TOWNHOME', 'VACANT_LOT', 'COMMON_PROPERTY', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PropertyResidentType" AS ENUM ('OWNER', 'CO_OWNER', 'RESIDENT', 'TENANT', 'NON_RESIDENT_OWNER', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyResidentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "country" TEXT,
    "unitLabel" TEXT,
    "buildingLabel" TEXT,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'SINGLE_FAMILY',
    "displayName" TEXT,
    "billingMemberId" TEXT,
    "status" "PropertyStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyResident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "orgMemberId" TEXT NOT NULL,
    "relationshipType" "PropertyResidentType" NOT NULL,
    "status" "PropertyResidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "ownershipPercentage" DECIMAL(5,2),
    "moveInDate" TIMESTAMP(3),
    "moveOutDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyResident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_organizationId_idx" ON "Property"("organizationId");

-- CreateIndex
CREATE INDEX "Property_organizationId_status_idx" ON "Property"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Property_organizationId_propertyType_idx" ON "Property"("organizationId", "propertyType");

-- CreateIndex
CREATE INDEX "Property_billingMemberId_idx" ON "Property"("billingMemberId");

-- CreateIndex
CREATE INDEX "PropertyResident_organizationId_idx" ON "PropertyResident"("organizationId");

-- CreateIndex
CREATE INDEX "PropertyResident_propertyId_idx" ON "PropertyResident"("propertyId");

-- CreateIndex
CREATE INDEX "PropertyResident_propertyId_status_idx" ON "PropertyResident"("propertyId", "status");

-- CreateIndex
CREATE INDEX "PropertyResident_orgMemberId_idx" ON "PropertyResident"("orgMemberId");

-- CreateIndex
CREATE INDEX "PropertyResident_organizationId_status_idx" ON "PropertyResident"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_billingMemberId_fkey" FOREIGN KEY ("billingMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyResident" ADD CONSTRAINT "PropertyResident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyResident" ADD CONSTRAINT "PropertyResident_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyResident" ADD CONSTRAINT "PropertyResident_orgMemberId_fkey" FOREIGN KEY ("orgMemberId") REFERENCES "OrgMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes (not expressible in Prisma's schema DSL) enforcing
-- two invariants at the database level rather than only in application code
-- -- both are real concurrency scenarios (see docs/hoa-domain-model.md and
-- the PR #43 concurrency test suite), so a race between two simultaneous
-- requests must fail closed via a real constraint violation, not a
-- check-then-insert race window.

-- CreateIndex: at most one ACTIVE relationship between a given property and
-- member at a time (a member can still have multiple ENDED historical rows,
-- or a fresh ACTIVE row after a prior one ends).
CREATE UNIQUE INDEX "PropertyResident_property_member_one_active"
  ON "PropertyResident"("propertyId", "orgMemberId")
  WHERE "status" = 'ACTIVE';

-- CreateIndex: at most one ACTIVE primary contact per property.
CREATE UNIQUE INDEX "PropertyResident_property_one_primary_contact"
  ON "PropertyResident"("propertyId")
  WHERE "isPrimaryContact" = true AND "status" = 'ACTIVE';
