-- Data-only migration: mark Harris PTA billing-exempt and enroll it in the
-- memberIntake Labs feature. No schema changes.
--
-- Why: sync-verification pass (2026-08-17) found the org's owner (the
-- account holder, abramph1@me.com) had no way to reach Member Intake in
-- production -- the feature is deliberately lifecycle INTERNAL /
-- internalOnly:true in the Labs registry (src/lib/labs/registry.ts), which
-- is a hard ceiling on Organization.billingExempt checked BEFORE enrollment
-- (src/lib/labs/access.ts). Unlike the two prior billing-exempt migrations
-- (20260813023000 for the app-store review demo orgs, 20260815160000 for
-- Demo Church), Harris PTA is a REAL organization with real members --
-- explicitly confirmed with the account owner before running this, who
-- chose to test the Member Intake admin workflow on their own real org
-- rather than switch to one of the existing synthetic demo orgs. This also
-- permanently removes any trial/subscription wall for Harris PTA (the same
-- side effect billingExempt always has, per plan-gate.ts) -- accepted as
-- part of the same confirmation.
--
-- Mirrors 20260813023000's guard discipline exactly: targets by immutable
-- organization id, never by name/slug (both tenant-editable); the pinned
-- name is only a cross-check. Guards:
--   - No row with that id: RAISE NOTICE and skip.
--   - Row exists but name differs: RAISE EXCEPTION -- refuse to guess.
--   - Already exempt / already enrolled: NOTICE, skip that part (idempotent
--     re-run) -- the two changes are independently idempotent.
DO $$
DECLARE
  target_org_id TEXT := 'cmskuxq3100499u2ywhhr57jb';
  expected_name TEXT := 'Harris PTA';
  existing_name TEXT;
  already_exempt BOOLEAN;
  existing_feature_status TEXT;
BEGIN
  SELECT "name", "billingExempt" INTO existing_name, already_exempt
  FROM "Organization" WHERE "id" = target_org_id;

  IF existing_name IS NULL THEN
    RAISE NOTICE 'No organization found with id %. Skipping.', target_org_id;
    RETURN;
  ELSIF existing_name != expected_name THEN
    RAISE EXCEPTION 'Organization % has name "%", expected "%". Aborting -- refusing to guess which organization to modify.', target_org_id, existing_name, expected_name;
  END IF;

  IF already_exempt THEN
    RAISE NOTICE 'Organization % is already billingExempt -- skipping (idempotent re-run).', target_org_id;
  ELSE
    UPDATE "Organization" SET "billingExempt" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = target_org_id;

    INSERT INTO "AuditEvent" ("id", "organizationId", "actorId", "actorEmail", "action", "resource", "resourceId", "before", "after", "createdAt")
    VALUES (
      'cuid_audit_billing_exempt_' || substr(md5(random()::text), 1, 16),
      target_org_id,
      NULL,
      'system:migration:20260817120000_mark_harris_pta_billing_exempt_and_member_intake',
      'organization.billing_exempt_set',
      'organization',
      target_org_id,
      jsonb_build_object('billingExempt', false),
      jsonb_build_object('billingExempt', true, 'reason', 'Account owner requested Member Intake access on their own real org, explicitly confirmed the trial/billing-wall side effect'),
      CURRENT_TIMESTAMP
    );
  END IF;

  SELECT "status" INTO existing_feature_status
  FROM "OrganizationLabFeature" WHERE "organizationId" = target_org_id AND "featureKey" = 'memberIntake';

  IF existing_feature_status = 'ENABLED' THEN
    RAISE NOTICE 'Organization % is already enrolled in memberIntake -- skipping (idempotent re-run).', target_org_id;
  ELSIF existing_feature_status IS NULL THEN
    INSERT INTO "OrganizationLabFeature" ("id", "organizationId", "featureKey", "status", "enabledAt", "enrollmentSource", "notes", "createdAt", "updatedAt")
    VALUES (
      'cuid_labfeat_' || substr(md5(random()::text), 1, 16),
      target_org_id,
      'memberIntake',
      'ENABLED',
      CURRENT_TIMESTAMP,
      'operations_center',
      'Account owner requested access to verify the Member Intake admin workflow (Create Form -> Publish -> QR -> submissions) on their own real org.',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
  ELSE
    UPDATE "OrganizationLabFeature"
    SET "status" = 'ENABLED', "enabledAt" = CURRENT_TIMESTAMP, "disabledAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = target_org_id AND "featureKey" = 'memberIntake';
  END IF;
END $$;
