-- Data-only migration: mark the two permanent app-store review/demo
-- organizations as billing-exempt. No schema changes.
--
-- Why: these are vendor-owned, fully synthetic organizations used as the
-- Google Play / Apple App Review environment ("Unestra Demo Community" and
-- "Unestra Demo PTA", both owned by the reviewer accounts
-- appreview@getunestra.com / demo-admin@getunestra.com). billingExempt does
-- two load-bearing things for them:
--   1. Removes the free-trial expiration wall (src/app/(portal)/layout.tsx,
--      src/lib/plan-gate.ts) so the review environment never dies when the
--      30-day trial ends — store reviewers reuse these credentials for every
--      future release.
--   2. Satisfies the internalOnly hard ceiling in src/lib/labs/access.ts so
--      the orgs can be enrolled in the internal-only "mobileAdmin" Labs
--      feature — without it, staff-role memberships (the org owners/admins)
--      have no admin capabilities and /api/mobile/organizations deliberately
--      omits the org from the mobile org picker, making the Community demo
--      org unreachable in the mobile app for both reviewer accounts.
--
-- Mirrors migration 20260717050000_add_organization_billing_exempt (APH
-- Technologies) exactly: targets by immutable organization id, never by
-- name/slug (both tenant-editable); the pinned name is only a cross-check.
-- Guards per organization:
--   - No row with that id: RAISE NOTICE and skip (fresh/dev/CI databases
--     legitimately don't have these rows).
--   - Row exists but name differs: RAISE EXCEPTION — refuse to exempt an
--     organization we can't positively identify.
--   - Already exempt: NOTICE, skip (idempotent re-run).
--   - Exact match: set billingExempt = true + write an audit event (guarded
--     by the actual-change check above, so never double-written).
DO $$
DECLARE
  org RECORD;
  existing_name TEXT;
  already_exempt BOOLEAN;
BEGIN
  FOR org IN
    SELECT * FROM (VALUES
      ('cmsqpj8wk003vbg2ygib7e3y3', 'Unestra Demo Community'),
      ('cmsqpnfsc004rbg2yohe01yqf', 'Unestra Demo PTA')
    ) AS t(org_id, org_name)
  LOOP
    SELECT "name", "billingExempt" INTO existing_name, already_exempt
    FROM "Organization" WHERE "id" = org.org_id;

    IF existing_name IS NULL THEN
      RAISE NOTICE 'No organization found with id %. Skipping billing-exempt backfill.', org.org_id;
    ELSIF existing_name != org.org_name THEN
      RAISE EXCEPTION 'Organization % has name "%", expected "%". Aborting — refusing to guess which organization should be billing-exempt.', org.org_id, existing_name, org.org_name;
    ELSIF already_exempt THEN
      RAISE NOTICE 'Organization % is already billingExempt — skipping (idempotent re-run).', org.org_id;
    ELSE
      UPDATE "Organization" SET "billingExempt" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = org.org_id;

      INSERT INTO "AuditEvent" ("id", "organizationId", "actorId", "actorEmail", "action", "resource", "resourceId", "before", "after", "createdAt")
      VALUES (
        'cuid_audit_billing_exempt_' || substr(md5(random()::text), 1, 16),
        org.org_id,
        NULL,
        'system:migration:20260813023000_mark_demo_review_orgs_billing_exempt',
        'organization.billing_exempt_set',
        'organization',
        org.org_id,
        jsonb_build_object('billingExempt', false),
        jsonb_build_object('billingExempt', true, 'reason', 'Permanent synthetic app-store review/demo organization — must not be gated by tenant trial/subscription rules, and must satisfy the internalOnly Labs ceiling for the mobileAdmin feature'),
        CURRENT_TIMESTAMP
      );
    END IF;
  END LOOP;
END $$;
