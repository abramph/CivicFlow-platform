-- AlterEnum
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT_CARD';
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'DEBIT_CARD';
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'ZELLE';
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'CASH_APP';
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'VENMO';
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'PAYPAL';
ALTER TYPE "DuesPaymentMethod" ADD VALUE IF NOT EXISTS 'STRIPE';

-- AlterTable
ALTER TABLE "OrgMember"
ADD COLUMN "membershipCategoryManualOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Category"
ADD COLUMN "minAge" INTEGER,
ADD COLUMN "maxAge" INTEGER,
ADD COLUMN "autoAssignByAge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "effectiveDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentMethodConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "method" "DuesPaymentMethod" NOT NULL,
  "label" TEXT NOT NULL,
  "instructions" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentMethodConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodConfig_organizationId_method_key" ON "PaymentMethodConfig"("organizationId", "method");

-- CreateIndex
CREATE INDEX "PaymentMethodConfig_organizationId_idx" ON "PaymentMethodConfig"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentMethodConfig_organizationId_isActive_sortOrder_idx" ON "PaymentMethodConfig"("organizationId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_organizationId_type_autoAssignByAge_priority_idx" ON "Category"("organizationId", "type", "autoAssignByAge", "priority");

-- AddForeignKey
ALTER TABLE "PaymentMethodConfig"
ADD CONSTRAINT "PaymentMethodConfig_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
