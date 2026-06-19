-- Check org isolation: each table that holds org data should have organizationId FK
-- 1. Orgs and their unique slugs
SELECT id, name, slug, plan, status FROM "Organization" ORDER BY "createdAt";

-- 2. Check for any members not scoped to an org (orphaned users)
SELECT u.id, u.email FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMembership" om WHERE om."userId" = u.id);

-- 3. Verify org-scoped tables all have organizationId
SELECT
  table_name,
  COUNT(*) as row_count
FROM (
  SELECT 'Member' as table_name, "organizationId" FROM "Member"
  UNION ALL SELECT 'Event', "organizationId" FROM "Event"
  UNION ALL SELECT 'Campaign', "organizationId" FROM "Campaign"
  UNION ALL SELECT 'Meeting', "organizationId" FROM "Meeting"
  UNION ALL SELECT 'Contribution', "organizationId" FROM "Contribution"
  UNION ALL SELECT 'Expenditure', "organizationId" FROM "Expenditure"
) t
GROUP BY table_name
ORDER BY table_name;

-- 4. Check for any cross-org data leakage (records with null organizationId)
SELECT 'Member nulls' as check_name, COUNT(*) FROM "Member" WHERE "organizationId" IS NULL
UNION ALL SELECT 'Contribution nulls', COUNT(*) FROM "Contribution" WHERE "organizationId" IS NULL
UNION ALL SELECT 'Event nulls', COUNT(*) FROM "Event" WHERE "organizationId" IS NULL;
