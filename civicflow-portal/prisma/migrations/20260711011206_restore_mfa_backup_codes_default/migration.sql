-- The 20260708210703_sms_consent_opt_in migration dropped this column's
-- DEFAULT to match a schema.prisma that never had @default([]) annotated,
-- which broke every User creation path that doesn't explicitly pass
-- mfaBackupCodes (e.g. accept-invite, organization-memberships). Existing
-- rows are untouched; this only restores the insert-time default.
ALTER TABLE "User" ALTER COLUMN "mfaBackupCodes" SET DEFAULT '{}';
