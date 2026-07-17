-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "PlatformAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "PlatformAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccess_userId_role_key" ON "PlatformAccess"("userId", "role");

-- CreateIndex
CREATE INDEX "PlatformAccess_role_status_idx" ON "PlatformAccess"("role", "status");

-- AddForeignKey
ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccess" ADD CONSTRAINT "PlatformAccess_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: copy the current production SUPER_ADMIN OrganizationMembership
-- (abramph1@me.com on APH Technologies, LLC) into a global PlatformAccess
-- record. Guarded so it never runs against unexpected state: fails loudly
-- (raises an exception, aborting the migration) if there are zero or more
-- than one SUPER_ADMIN memberships at migration time, rather than silently
-- backfilling the wrong thing. Safe to re-run: ON CONFLICT DO NOTHING
-- against the (userId, role) unique constraint makes this idempotent.
DO $$
DECLARE
  admin_count INTEGER;
  admin_user_id TEXT;
  admin_user_email TEXT;
  new_access_id TEXT;
BEGIN
  SELECT COUNT(*) INTO admin_count FROM "OrganizationMembership" WHERE "role" = 'SUPER_ADMIN';

  IF admin_count = 0 THEN
    RAISE NOTICE 'No SUPER_ADMIN OrganizationMembership found — skipping PlatformAccess backfill.';
  ELSIF admin_count > 1 THEN
    RAISE EXCEPTION 'Expected exactly 0 or 1 SUPER_ADMIN OrganizationMembership for backfill, found %. Aborting migration — resolve manually before re-running.', admin_count;
  ELSE
    SELECT "userId" INTO admin_user_id FROM "OrganizationMembership" WHERE "role" = 'SUPER_ADMIN' LIMIT 1;
    SELECT "email" INTO admin_user_email FROM "User" WHERE "id" = admin_user_id;
    new_access_id := 'cuid_platform_access_bootstrap_' || substr(md5(random()::text), 1, 16);

    INSERT INTO "PlatformAccess" ("id", "userId", "role", "status", "grantedAt", "reason", "createdAt", "updatedAt")
    VALUES (
      new_access_id,
      admin_user_id,
      'SUPER_ADMIN',
      'ACTIVE',
      CURRENT_TIMESTAMP,
      'Bootstrap backfill from existing SUPER_ADMIN OrganizationMembership (agent/global-platform-access migration)',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId", "role") DO NOTHING;

    -- Only record the audit event if a row was actually inserted (FOUND is
    -- false when ON CONFLICT DO NOTHING skipped it on a re-run) — keeps a
    -- re-applied/idempotent migration from writing duplicate audit entries.
    IF FOUND THEN
      INSERT INTO "AuditEvent" ("id", "organizationId", "actorId", "actorEmail", "action", "resource", "resourceId", "after", "createdAt")
      VALUES (
        'cuid_audit_bootstrap_' || substr(md5(random()::text), 1, 16),
        NULL,
        NULL,
        'system:migration:20260717013000_add_platform_access',
        'platform_access.bootstrap_migrated',
        'platform_access',
        new_access_id,
        jsonb_build_object('userId', admin_user_id, 'userEmail', admin_user_email, 'role', 'SUPER_ADMIN', 'status', 'ACTIVE', 'source', 'OrganizationMembership backfill'),
        CURRENT_TIMESTAMP
      );
    END IF;
  END IF;
END $$;
