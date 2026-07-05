-- CreateTable
CREATE TABLE "OrgRolePermissionSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "permissions" TEXT[],
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRolePermissionSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgRolePermissionSet_organizationId_idx" ON "OrgRolePermissionSet"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRolePermissionSet_organizationId_role_key" ON "OrgRolePermissionSet"("organizationId", "role");

-- AddForeignKey
ALTER TABLE "OrgRolePermissionSet" ADD CONSTRAINT "OrgRolePermissionSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

