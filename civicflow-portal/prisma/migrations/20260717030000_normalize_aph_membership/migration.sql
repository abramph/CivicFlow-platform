-- Normalize the APH Technologies, LLC OrganizationMembership from the
-- legacy SUPER_ADMIN org role to ORG_OWNER. Platform-wide authorization is
-- now exclusively PlatformAccess (see 20260717013000_add_platform_access,
-- already deployed and verified) — this org's own membership should
-- represent only its own tenant-scoped administrative role, same as any
-- other organization's owner. APH Technologies' PlatformAccess grant is
-- untouched by this migration; only the OrganizationMembership row changes.
--
-- Targets by organization name + role rather than a hardcoded row ID so
-- this migration is safe and idempotent to (re-)run against any
-- environment:
--   - No "APH Technologies, LLC" org, or no SUPER_ADMIN membership on it:
--     skips (RAISE NOTICE), not an error — a fresh/dev database with no
--     seeded platform-owner org, or one already normalized, is a valid
--     starting state.
--   - More than one SUPER_ADMIN membership on that org: fails loudly
--     (RAISE EXCEPTION) rather than guessing which one to change — should
--     be structurally impossible (@@unique([organizationId, userId])) but
--     guarded anyway, matching the previous migration's convention.
--   - Exactly one: updates it to ORG_OWNER and records an audit event.
--     Safe to re-run: a later re-run finds zero remaining SUPER_ADMIN rows
--     on that org and just skips.
--
-- Does not touch ThrivePath, any customer organization, or any other
-- membership — the WHERE clause below is scoped to this one organization's
-- SUPER_ADMIN row only.
DO $$
DECLARE
  aph_org_id TEXT;
  match_count INTEGER;
  membership_id TEXT;
BEGIN
  SELECT "id" INTO aph_org_id FROM "Organization" WHERE "name" = 'APH Technologies, LLC' LIMIT 1;

  IF aph_org_id IS NULL THEN
    RAISE NOTICE 'No "APH Technologies, LLC" organization found — skipping membership normalization.';
  ELSE
    SELECT COUNT(*) INTO match_count FROM "OrganizationMembership" WHERE "organizationId" = aph_org_id AND "role" = 'SUPER_ADMIN';

    IF match_count = 0 THEN
      RAISE NOTICE 'No SUPER_ADMIN OrganizationMembership on APH Technologies, LLC — skipping (already normalized or never set).';
    ELSIF match_count > 1 THEN
      RAISE EXCEPTION 'Expected at most one SUPER_ADMIN OrganizationMembership on APH Technologies, LLC, found %. Aborting — resolve manually before re-running.', match_count;
    ELSE
      SELECT "id" INTO membership_id FROM "OrganizationMembership" WHERE "organizationId" = aph_org_id AND "role" = 'SUPER_ADMIN' LIMIT 1;

      UPDATE "OrganizationMembership"
      SET "role" = 'ORG_OWNER', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = membership_id;

      INSERT INTO "AuditEvent" ("id", "organizationId", "actorId", "actorEmail", "action", "resource", "resourceId", "before", "after", "createdAt")
      VALUES (
        'cuid_audit_normalize_' || substr(md5(random()::text), 1, 16),
        aph_org_id,
        NULL,
        'system:migration:20260717030000_normalize_aph_membership',
        'organization_membership.role_normalized',
        'organization_membership',
        membership_id,
        jsonb_build_object('role', 'SUPER_ADMIN'),
        jsonb_build_object('role', 'ORG_OWNER', 'reason', 'Platform authorization migrated to PlatformAccess; APH Technologies membership normalized to a standard tenant-scoped role'),
        CURRENT_TIMESTAMP
      );
    END IF;
  END IF;
END $$;
