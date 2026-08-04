-- CreateEnum
CREATE TYPE "ViolationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACKNOWLEDGED', 'IN_REVIEW', 'CURED', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'HOA_VIOLATION';

-- CreateTable
CREATE TABLE "Violation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "violationType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ViolationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cureByDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "fineChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Violation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "noticeType" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByUserId" TEXT,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "fromStatus" "ViolationStatus",
    "toStatus" "ViolationStatus" NOT NULL,
    "changedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Violation_fineChargeId_key" ON "Violation"("fineChargeId");

-- CreateIndex
CREATE INDEX "Violation_organizationId_idx" ON "Violation"("organizationId");

-- CreateIndex
CREATE INDEX "Violation_organizationId_propertyId_idx" ON "Violation"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "Violation_organizationId_status_idx" ON "Violation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ViolationNotice_organizationId_idx" ON "ViolationNotice"("organizationId");

-- CreateIndex
CREATE INDEX "ViolationNotice_violationId_idx" ON "ViolationNotice"("violationId");

-- CreateIndex
CREATE INDEX "ViolationComment_organizationId_idx" ON "ViolationComment"("organizationId");

-- CreateIndex
CREATE INDEX "ViolationComment_violationId_idx" ON "ViolationComment"("violationId");

-- CreateIndex
CREATE INDEX "ViolationStatusHistory_organizationId_idx" ON "ViolationStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "ViolationStatusHistory_violationId_idx" ON "ViolationStatusHistory"("violationId");

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Violation" ADD CONSTRAINT "Violation_fineChargeId_fkey" FOREIGN KEY ("fineChargeId") REFERENCES "DuesCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationNotice" ADD CONSTRAINT "ViolationNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationNotice" ADD CONSTRAINT "ViolationNotice_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationComment" ADD CONSTRAINT "ViolationComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationComment" ADD CONSTRAINT "ViolationComment_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationStatusHistory" ADD CONSTRAINT "ViolationStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationStatusHistory" ADD CONSTRAINT "ViolationStatusHistory_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
