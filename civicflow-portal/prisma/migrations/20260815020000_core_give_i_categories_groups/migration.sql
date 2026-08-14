-- CreateEnum
CREATE TYPE "OrganizationCategory" AS ENUM ('COMMUNITY', 'PTA_PTO', 'UNION', 'HOA', 'CHURCH_RELIGIOUS', 'CULTURAL', 'ALUMNI', 'PROFESSIONAL_ASSOCIATION', 'CIVIC_ASSOCIATION', 'FRATERNAL', 'CLUB', 'NONPROFIT', 'OTHER');

-- CreateEnum
CREATE TYPE "OrgGroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "category" "OrganizationCategory";

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "memberTerminology" TEXT;

-- CreateTable
CREATE TABLE "OrgGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kindLabel" TEXT NOT NULL DEFAULT 'Group',
    "status" "OrgGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgGroup_organizationId_status_idx" ON "OrgGroup"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrgGroup_organizationId_name_key" ON "OrgGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "OrgGroupMember_memberId_idx" ON "OrgGroupMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgGroupMember_groupId_memberId_key" ON "OrgGroupMember"("groupId", "memberId");

-- AddForeignKey
ALTER TABLE "OrgGroup" ADD CONSTRAINT "OrgGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGroupMember" ADD CONSTRAINT "OrgGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OrgGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGroupMember" ADD CONSTRAINT "OrgGroupMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

