-- CreateEnum
CREATE TYPE "OrganizationMembershipStatus" AS ENUM ('active', 'suspended');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "memberNumber" TEXT;

-- AlterTable
ALTER TABLE "OrganizationMembership" ADD COLUMN     "status" "OrganizationMembershipStatus" NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_organizationId_memberNumber_key" ON "OrgMember"("organizationId", "memberNumber");
