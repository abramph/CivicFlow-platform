-- CreateTable
CREATE TABLE "PtaHouseholdAdultInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdAdultId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaHouseholdAdultInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PtaHouseholdAdultInvite_tokenHash_key" ON "PtaHouseholdAdultInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "PtaHouseholdAdultInvite_organizationId_idx" ON "PtaHouseholdAdultInvite"("organizationId");

-- CreateIndex
CREATE INDEX "PtaHouseholdAdultInvite_householdAdultId_idx" ON "PtaHouseholdAdultInvite"("householdAdultId");

-- CreateIndex
CREATE INDEX "PtaHouseholdAdultInvite_expiresAt_idx" ON "PtaHouseholdAdultInvite"("expiresAt");

-- AddForeignKey
ALTER TABLE "PtaHouseholdAdultInvite" ADD CONSTRAINT "PtaHouseholdAdultInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHouseholdAdultInvite" ADD CONSTRAINT "PtaHouseholdAdultInvite_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHouseholdAdultInvite" ADD CONSTRAINT "PtaHouseholdAdultInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
