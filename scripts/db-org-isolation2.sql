-- 1. All orgs with unique slugs
SELECT id, name, slug, plan, status FROM "Organization" ORDER BY "createdAt";

-- 2. Orphaned users (no org membership)
SELECT u.id, u.email FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMembership" om WHERE om."userId" = u.id);

-- 3. Row counts per org for core tables
SELECT o.name as org_name,
  (SELECT COUNT(*) FROM "OrgMember" m WHERE m."organizationId" = o.id) as members,
  (SELECT COUNT(*) FROM "Contribution" c WHERE c."organizationId" = o.id) as contributions,
  (SELECT COUNT(*) FROM "Event" e WHERE e."organizationId" = o.id) as events,
  (SELECT COUNT(*) FROM "Campaign" ca WHERE ca."organizationId" = o.id) as campaigns,
  (SELECT COUNT(*) FROM "Expenditure" ex WHERE ex."organizationId" = o.id) as expenditures
FROM "Organization" o ORDER BY o."createdAt";

-- 4. Check for null organizationId in core tables
SELECT 'OrgMember nulls' as check_name, COUNT(*) FROM "OrgMember" WHERE "organizationId" IS NULL
UNION ALL SELECT 'Contribution nulls', COUNT(*) FROM "Contribution" WHERE "organizationId" IS NULL
UNION ALL SELECT 'Event nulls', COUNT(*) FROM "Event" WHERE "organizationId" IS NULL
UNION ALL SELECT 'Campaign nulls', COUNT(*) FROM "Campaign" WHERE "organizationId" IS NULL
UNION ALL SELECT 'Expenditure nulls', COUNT(*) FROM "Expenditure" WHERE "organizationId" IS NULL;

-- 5. Confirm org slugs are unique
SELECT slug, COUNT(*) FROM "Organization" GROUP BY slug HAVING COUNT(*) > 1;
