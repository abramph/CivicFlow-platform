-- AlterTable
ALTER TABLE "Organization"
ADD COLUMN "organizationType" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "zipCode" TEXT,
ADD COLUMN "country" TEXT;

-- AlterTable
ALTER TABLE "OrgMember"
ADD COLUMN "dateOfBirth" TIMESTAMP(3),
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "zipCode" TEXT,
ADD COLUMN "county" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "membershipCategoryId" TEXT,
ADD COLUMN "householdName" TEXT,
ADD COLUMN "emergencyContactName" TEXT,
ADD COLUMN "emergencyContactPhone" TEXT;

-- AlterTable
ALTER TABLE "Campaign"
ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "Event"
ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "Category"
ADD COLUMN "description" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notes" TEXT,
ADD COLUMN "amountDefault" DECIMAL(12,2),
ADD COLUMN "frequency" TEXT,
ADD COLUMN "standardDuesCategoryId" TEXT;

-- AlterTable
ALTER TABLE "DuesAccount"
ADD COLUMN "memberId" TEXT,
ADD COLUMN "categoryId" TEXT;

-- AlterTable
ALTER TABLE "Contribution"
ADD COLUMN "paymentMethod" "DuesPaymentMethod",
ADD COLUMN "receiptRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "OrgMember_membershipCategoryId_idx" ON "OrgMember"("membershipCategoryId");

-- CreateIndex
CREATE INDEX "OrgMember_organizationId_city_idx" ON "OrgMember"("organizationId", "city");

-- CreateIndex
CREATE INDEX "OrgMember_organizationId_state_idx" ON "OrgMember"("organizationId", "state");

-- CreateIndex
CREATE INDEX "OrgMember_organizationId_zipCode_idx" ON "OrgMember"("organizationId", "zipCode");

-- CreateIndex
CREATE INDEX "OrgMember_organizationId_county_idx" ON "OrgMember"("organizationId", "county");

-- CreateIndex
CREATE INDEX "OrgMember_organizationId_joinDate_idx" ON "OrgMember"("organizationId", "joinDate");

-- CreateIndex
CREATE INDEX "Category_organizationId_type_isActive_idx" ON "Category"("organizationId", "type", "isActive");

-- CreateIndex
CREATE INDEX "Category_standardDuesCategoryId_idx" ON "Category"("standardDuesCategoryId");

-- CreateIndex
CREATE INDEX "DuesAccount_memberId_idx" ON "DuesAccount"("memberId");

-- CreateIndex
CREATE INDEX "DuesAccount_categoryId_idx" ON "DuesAccount"("categoryId");

-- CreateIndex
CREATE INDEX "DuesAccount_organizationId_memberId_isActive_idx" ON "DuesAccount"("organizationId", "memberId", "isActive");

-- AddForeignKey
ALTER TABLE "OrgMember"
ADD CONSTRAINT "OrgMember_membershipCategoryId_fkey"
FOREIGN KEY ("membershipCategoryId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category"
ADD CONSTRAINT "Category_standardDuesCategoryId_fkey"
FOREIGN KEY ("standardDuesCategoryId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesAccount"
ADD CONSTRAINT "DuesAccount_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuesAccount"
ADD CONSTRAINT "DuesAccount_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
