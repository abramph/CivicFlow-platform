-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark APH Technologies, LLC (and only that one organization) as
-- billing-exempt — the internal, platform-owning organization must not be
-- gated by the ordinary free-trial-expiration wall (see
-- src/app/(portal)/layout.tsx and src/lib/plan-gate.ts).
--
-- Targets by immutable organization id, NOT by name or slug — both of those
-- fields are ordinary tenant-editable data (see updateOrganizationSchema in
-- src/app/api/organization/route.ts) and must never be trusted as a
-- billing-exemption key. The id below is APH Technologies' actual,
-- already-established production id (created by the PlatformAccess
-- bootstrap work, migration 20260717013000_add_platform_access's
-- prerequisite setup) — this migration does not create the organization,
-- only flags the one that already exists.
--
-- Guarded so it never runs against unexpected state:
--   - No organization with this id: skips (RAISE NOTICE), not an error — a
--     fresh/dev/CI database has no such row, and that's a valid starting
--     state, not a problem to fix.
--   - An organization exists with this id but a different name: aborts
--     (RAISE EXCEPTION) rather than silently exempting the wrong
--     organization from billing — this would only happen if this exact id
--     were somehow reused for an unrelated org, which should be practically
--     impossible with cuid primary keys, but is guarded anyway.
--   - Exact id+name match: sets billingExempt = true and records an audit
--     event. Safe to re-run: idempotent (setting true twice is a no-op),
--     and the audit insert is guarded by an actual-change check so a
--     re-applied migration never double-writes it.
DO $$
DECLARE
  aph_org_id CONSTANT TEXT := 'cmro8p4v20000z18sbpjy9f4o';
  aph_org_name CONSTANT TEXT := 'APH Technologies, LLC';
  existing_name TEXT;
  already_exempt BOOLEAN;
BEGIN
  SELECT "name", "billingExempt" INTO existing_name, already_exempt
  FROM "Organization" WHERE "id" = aph_org_id;

  IF existing_name IS NULL THEN
    RAISE NOTICE 'No organization found with id %. Skipping billing-exempt backfill.', aph_org_id;
  ELSIF existing_name != aph_org_name THEN
    RAISE EXCEPTION 'Organization % has name "%", expected "%". Aborting — refusing to guess which organization should be billing-exempt.', aph_org_id, existing_name, aph_org_name;
  ELSIF already_exempt THEN
    RAISE NOTICE 'Organization % is already billingExempt — skipping (idempotent re-run).', aph_org_id;
  ELSE
    UPDATE "Organization" SET "billingExempt" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = aph_org_id;

    INSERT INTO "AuditEvent" ("id", "organizationId", "actorId", "actorEmail", "action", "resource", "resourceId", "before", "after", "createdAt")
    VALUES (
      'cuid_audit_billing_exempt_' || substr(md5(random()::text), 1, 16),
      aph_org_id,
      NULL,
      'system:migration:20260717050000_add_organization_billing_exempt',
      'organization.billing_exempt_set',
      'organization',
      aph_org_id,
      jsonb_build_object('billingExempt', false),
      jsonb_build_object('billingExempt', true, 'reason', 'APH Technologies, LLC is the internal platform-owning organization and must not be gated by ordinary tenant trial/subscription rules'),
      CURRENT_TIMESTAMP
    );
  END IF;
END $$;
