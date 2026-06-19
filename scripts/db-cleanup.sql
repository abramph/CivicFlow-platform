-- Delete test signup account and its org
DELETE FROM "AccountVerificationToken" WHERE "userId" = 'cmqkyff6p00085m2yp30cgitx';
DELETE FROM "OrganizationMembership" WHERE "userId" = 'cmqkyff6p00085m2yp30cgitx';
DELETE FROM "OrgSettings" WHERE "organizationId" = 'cmqkyff6v00095m2ysb7cukip';
DELETE FROM "Organization" WHERE id = 'cmqkyff6v00095m2ysb7cukip';
DELETE FROM "User" WHERE id = 'cmqkyff6p00085m2yp30cgitx';
SELECT 'Test account cleaned up' AS status;
