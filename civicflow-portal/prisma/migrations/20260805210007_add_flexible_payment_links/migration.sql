-- CreateTable
CREATE TABLE "PaymentLinkMethod" (
    "id" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "paymentMethodConfigId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLinkMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLinkOfflineReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "paymentMethodConfigId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "payerEmail" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "referenceNumber" TEXT,
    "message" TEXT,
    "proofAttachmentId" TEXT,
    "status" "PaymentReportStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "resultingContributionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLinkOfflineReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentLinkMethod_paymentMethodConfigId_idx" ON "PaymentLinkMethod"("paymentMethodConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLinkMethod_paymentLinkId_paymentMethodConfigId_key" ON "PaymentLinkMethod"("paymentLinkId", "paymentMethodConfigId");

-- CreateIndex
CREATE INDEX "PaymentLinkOfflineReport_organizationId_idx" ON "PaymentLinkOfflineReport"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentLinkOfflineReport_organizationId_status_idx" ON "PaymentLinkOfflineReport"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PaymentLinkOfflineReport_paymentLinkId_idx" ON "PaymentLinkOfflineReport"("paymentLinkId");

-- CreateIndex
CREATE INDEX "PaymentLinkOfflineReport_createdAt_idx" ON "PaymentLinkOfflineReport"("createdAt");

-- AddForeignKey
ALTER TABLE "PaymentLinkMethod" ADD CONSTRAINT "PaymentLinkMethod_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkMethod" ADD CONSTRAINT "PaymentLinkMethod_paymentMethodConfigId_fkey" FOREIGN KEY ("paymentMethodConfigId") REFERENCES "PaymentMethodConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkOfflineReport" ADD CONSTRAINT "PaymentLinkOfflineReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkOfflineReport" ADD CONSTRAINT "PaymentLinkOfflineReport_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "PaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkOfflineReport" ADD CONSTRAINT "PaymentLinkOfflineReport_paymentMethodConfigId_fkey" FOREIGN KEY ("paymentMethodConfigId") REFERENCES "PaymentMethodConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkOfflineReport" ADD CONSTRAINT "PaymentLinkOfflineReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkOfflineReport" ADD CONSTRAINT "PaymentLinkOfflineReport_proofAttachmentId_fkey" FOREIGN KEY ("proofAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLinkOfflineReport" ADD CONSTRAINT "PaymentLinkOfflineReport_resultingContributionId_fkey" FOREIGN KEY ("resultingContributionId") REFERENCES "Contribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: every existing PaymentLink implicitly means "Stripe only"
-- today (the checkout route offered Stripe unconditionally). To keep every
-- pre-existing link working identically after this deploy (same URL, same
-- behavior), backfill each such organization's PaymentMethodConfig(STRIPE)
-- row and connect every existing PaymentLink to it. Idempotent (safe to
-- re-run) via NOT EXISTS guards -- see docs/flexible-payment-links.md.

-- Ensure a STRIPE config row exists for every org that has a PaymentLink.
INSERT INTO "PaymentMethodConfig" ("id", "organizationId", "method", "label", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'STRIPE', 'Stripe', true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "PaymentLink" pl WHERE pl."organizationId" = o."id")
  AND NOT EXISTS (
    SELECT 1 FROM "PaymentMethodConfig" pmc
    WHERE pmc."organizationId" = o."id" AND pmc."method" = 'STRIPE'
  );

-- Reactivate an existing-but-inactive STRIPE config for any such org -- every
-- pre-existing link worked via Stripe regardless of any isActive concept
-- (which this PR is the first to introduce a behavioral dependency on), so
-- preserving behavior requires the config to be active post-migration.
UPDATE "PaymentMethodConfig" pmc
SET "isActive" = true
WHERE pmc."method" = 'STRIPE'
  AND pmc."isActive" = false
  AND EXISTS (SELECT 1 FROM "PaymentLink" pl WHERE pl."organizationId" = pmc."organizationId");

-- Connect every existing PaymentLink to its org's STRIPE config.
INSERT INTO "PaymentLinkMethod" ("id", "paymentLinkId", "paymentMethodConfigId", "createdAt")
SELECT gen_random_uuid()::text, pl."id", pmc."id", CURRENT_TIMESTAMP
FROM "PaymentLink" pl
JOIN "PaymentMethodConfig" pmc ON pmc."organizationId" = pl."organizationId" AND pmc."method" = 'STRIPE'
WHERE NOT EXISTS (
  SELECT 1 FROM "PaymentLinkMethod" plm
  WHERE plm."paymentLinkId" = pl."id" AND plm."paymentMethodConfigId" = pmc."id"
);
