-- Sample of members in Sample Community Organization
SELECT "firstName", "lastName", email, status
FROM "OrgMember"
WHERE "organizationId" = 'cmpuddywy0001z10wfpfn820u'
ORDER BY "createdAt"
LIMIT 10;

-- Count by status
SELECT status, COUNT(*) FROM "OrgMember"
WHERE "organizationId" = 'cmpuddywy0001z10wfpfn820u'
GROUP BY status;
