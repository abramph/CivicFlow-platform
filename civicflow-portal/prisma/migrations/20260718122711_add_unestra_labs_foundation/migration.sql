-- CreateEnum
CREATE TYPE "LabEnrollmentStatus" AS ENUM ('ENABLED', 'DISABLED', 'PENDING', 'SUSPENDED');

-- CreateTable
CREATE TABLE "OrganizationLabFeature" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "status" "LabEnrollmentStatus" NOT NULL DEFAULT 'DISABLED',
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "enabledByUserId" TEXT,
    "disabledByUserId" TEXT,
    "enrollmentSource" TEXT NOT NULL DEFAULT 'operations_center',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLabFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabUsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationLabFeature_featureKey_idx" ON "OrganizationLabFeature"("featureKey");

-- CreateIndex
CREATE INDEX "OrganizationLabFeature_status_idx" ON "OrganizationLabFeature"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationLabFeature_organizationId_featureKey_key" ON "OrganizationLabFeature"("organizationId", "featureKey");

-- CreateIndex
CREATE INDEX "LabUsageEvent_organizationId_featureKey_recordedAt_idx" ON "LabUsageEvent"("organizationId", "featureKey", "recordedAt");

-- CreateIndex
CREATE INDEX "LabUsageEvent_featureKey_idx" ON "LabUsageEvent"("featureKey");

-- AddForeignKey
ALTER TABLE "OrganizationLabFeature" ADD CONSTRAINT "OrganizationLabFeature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationLabFeature" ADD CONSTRAINT "OrganizationLabFeature_enabledByUserId_fkey" FOREIGN KEY ("enabledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationLabFeature" ADD CONSTRAINT "OrganizationLabFeature_disabledByUserId_fkey" FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabUsageEvent" ADD CONSTRAINT "LabUsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: enroll APH Technologies, LLC (and only that organization) in the
-- internal-only "labsFrameworkPreview" test feature (see
-- src/lib/labs/registry.ts). This proves the enrollment framework end to
-- end without any customer organization ever being auto-enrolled in
-- anything — no other organization is touched by this migration.
--
-- Targeted by immutable organization id, never by name/slug (both are
-- tenant-editable) — same guard convention as
-- 20260717050000_add_organization_billing_exempt:
--   - No organization with this id: skips (RAISE NOTICE), not an error.
--   - Organization exists but the name doesn't match: aborts (RAISE
--     EXCEPTION) rather than risk enrolling the wrong organization.
--   - Exact id+name match: inserts the enrollment row (idempotent via
--     ON CONFLICT DO NOTHING against the organizationId+featureKey unique
--     index) and records an audit event, guarded so a re-applied migration
--     never double-writes the audit trail.
DO $$
DECLARE
  aph_org_id CONSTANT TEXT := 'cmro8p4v20000z18sbpjy9f4o';
  aph_org_name CONSTANT TEXT := 'APH Technologies, LLC';
  found_name TEXT;
  inserted_id TEXT;
BEGIN
  SELECT name INTO found_name FROM "Organization" WHERE id = aph_org_id;

  IF found_name IS NULL THEN
    RAISE NOTICE 'labsFrameworkPreview seed: no organization with id % found — skipping (expected on a fresh/dev/CI database).', aph_org_id;
  ELSIF found_name <> aph_org_name THEN
    RAISE EXCEPTION 'labsFrameworkPreview seed: organization % exists but its name is "%", not "%" — refusing to enroll an unexpected organization.', aph_org_id, found_name, aph_org_name;
  ELSE
    INSERT INTO "OrganizationLabFeature" (
      id, "organizationId", "featureKey", status, "enabledAt", "enrollmentSource", notes, "createdAt", "updatedAt"
    ) VALUES (
      concat('labfeat_seed_', aph_org_id, '_labsframeworkpreview'),
      aph_org_id,
      'labsFrameworkPreview',
      'ENABLED',
      now(),
      'seed',
      'Seeded by migration 20260718122711_add_unestra_labs_foundation to validate the Labs enrollment framework end to end.',
      now(),
      now()
    )
    ON CONFLICT ("organizationId", "featureKey") DO NOTHING
    RETURNING id INTO inserted_id;

    IF inserted_id IS NOT NULL THEN
      INSERT INTO "AuditEvent" (id, "organizationId", "actorId", "actorEmail", action, resource, "resourceId", after, "createdAt")
      VALUES (
        concat('audit_seed_labsframeworkpreview_', aph_org_id),
        aph_org_id,
        NULL,
        'system@migration',
        'labs.enrollment.seeded',
        'organization_lab_feature',
        inserted_id,
        jsonb_build_object('featureKey', 'labsFrameworkPreview', 'status', 'ENABLED', 'enrollmentSource', 'seed'),
        now()
      );
    END IF;
  END IF;
END $$;
