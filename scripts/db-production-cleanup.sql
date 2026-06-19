BEGIN;

-- 1. Rename org and update slug
UPDATE "Organization"
SET name = 'ThrivePath Foundation', slug = 'thrivepath-foundation'
WHERE id = 'cmpuddywy0001z10wfpfn820u';

-- 2. Remove seed portal user memberships
DELETE FROM "OrganizationMembership"
WHERE "userId" IN (
  'cmpuddyv60000z10w921tgr0w', -- superadmin@civicflow.example
  'cmpuddz6a0004z10woghummfm', -- owner@sample-org.example
  'cmpuddze80007z10wo0nlioqq', -- admin@sample-org.example
  'cmpuddzm7000az10wu543n6fd', -- finance@sample-org.example
  'cmpuddzu3000dz10w23ywmv8h', -- staff@sample-org.example
  'cmpude022000gz10w37sslntm'  -- readonly@sample-org.example
);

-- 3. Delete seed portal user accounts
DELETE FROM "AccountVerificationToken" WHERE "userId" IN (
  'cmpuddyv60000z10w921tgr0w','cmpuddz6a0004z10woghummfm',
  'cmpuddze80007z10wo0nlioqq','cmpuddzm7000az10wu543n6fd',
  'cmpuddzu3000dz10w23ywmv8h','cmpude022000gz10w37sslntm'
);
DELETE FROM "MfaChallengeToken" WHERE "userId" IN (
  'cmpuddyv60000z10w921tgr0w','cmpuddz6a0004z10woghummfm',
  'cmpuddze80007z10wo0nlioqq','cmpuddzm7000az10wu543n6fd',
  'cmpuddzu3000dz10w23ywmv8h','cmpude022000gz10w37sslntm'
);
DELETE FROM "User" WHERE id IN (
  'cmpuddyv60000z10w921tgr0w','cmpuddz6a0004z10woghummfm',
  'cmpuddze80007z10wo0nlioqq','cmpuddzm7000az10wu543n6fd',
  'cmpuddzu3000dz10w23ywmv8h','cmpude022000gz10w37sslntm'
);

-- 4. Delete Test Civic Club org and its user
DELETE FROM "OrganizationMembership" WHERE "organizationId" = 'cmqdcp5tm0000z1gg7ug1qlci';
DELETE FROM "OrgSettings" WHERE "organizationId" = 'cmqdcp5tm0000z1gg7ug1qlci';
DELETE FROM "Organization" WHERE id = 'cmqdcp5tm0000z1gg7ug1qlci';
DELETE FROM "AccountVerificationToken" WHERE "userId" = 'cmqdcopcp0000z18k1cj5a6ww';
DELETE FROM "User" WHERE id = 'cmqdcopcp0000z18k1cj5a6ww'; -- wizard-test@civicflow.test

-- 5. Delete orphaned user (no org)
DELETE FROM "AccountVerificationToken" WHERE "userId" = 'cmqdbapxf0000z1qc73c6qhy4';
DELETE FROM "User" WHERE id = 'cmqdbapxf0000z1qc73c6qhy4'; -- test+f1b875ed@civicflowtest.invalid

-- 6. Verify final state
SELECT u.email, o.name as org_name, om.role
FROM "User" u
LEFT JOIN "OrganizationMembership" om ON om."userId" = u.id
LEFT JOIN "Organization" o ON o.id = om."organizationId"
ORDER BY u."createdAt";

SELECT id, name, slug, plan, status FROM "Organization";

COMMIT;
