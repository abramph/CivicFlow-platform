-- Data-only migration: mark Unestra Demo Union billing-exempt and enroll it
-- in the memberIntake Labs feature. No schema changes.
--
-- Why: closing out live Member Intake verification (2026-08-18) required a
-- Union-vertical org with the feature enabled -- Unestra Demo Union
-- (cwa-union-local-1040) already exists as a synthetic demo org but, unlike
-- Demo Church/PTA/Community, was never marked billing-exempt. Same
-- mechanism as those three (20260813023000, 20260815160000): internalOnly
-- is a hard ceiling on Organization.billingExempt, checked both at access
-- time (src/lib/labs/access.ts) and at enrollment time itself
-- (src/lib/platform-operations/labs.ts) -- enrollment alone would be
-- rejected without this.
--
-- Mirrors the same guard discipline: targets by immutable organization id,
-- name cross-check, idempotent re-run, audited.
DO $$
DECLARE
  target_org_id TEXT := 'cmsahovbf001tao2xskll0jt4';
  expected_name TEXT := 'Unestra Demo Union';
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
      'system:migration:20260818060000_mark_demo_union_billing_exempt_and_member_intake',
      'organization.billing_exempt_set',
      'organization',
      target_org_id,
      jsonb_build_object('billingExempt', false),
      jsonb_build_object('billingExempt', true, 'reason', 'Permanent synthetic Union demo organization needed for Member Intake vertical verification -- same convention as the other Demo orgs'),
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
      'Union-vertical Member Intake verification (live production smoke test pass).',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
  ELSE
    UPDATE "OrganizationLabFeature"
    SET "status" = 'ENABLED', "enabledAt" = CURRENT_TIMESTAMP, "disabledAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = target_org_id AND "featureKey" = 'memberIntake';
  END IF;
END $$;
