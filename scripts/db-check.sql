SELECT u.id, u.email, u."emailVerified", o.id as org_id, o.name as org_name, om.role
FROM "User" u
LEFT JOIN "OrganizationMembership" om ON om."userId" = u.id
LEFT JOIN "Organization" o ON o.id = om."organizationId"
ORDER BY u."createdAt";
