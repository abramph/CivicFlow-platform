-- CreateTable
CREATE TABLE "ContributionRefundEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "providerRefundId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionRefundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContributionRefundEvent_providerRefundId_key" ON "ContributionRefundEvent"("providerRefundId");

-- CreateIndex
CREATE INDEX "ContributionRefundEvent_organizationId_idx" ON "ContributionRefundEvent"("organizationId");

-- CreateIndex
CREATE INDEX "ContributionRefundEvent_contributionId_idx" ON "ContributionRefundEvent"("contributionId");

-- AddForeignKey
ALTER TABLE "ContributionRefundEvent" ADD CONSTRAINT "ContributionRefundEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionRefundEvent" ADD CONSTRAINT "ContributionRefundEvent_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "Contribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
