-- feature/pta-family-agreement-buyout follow-up (FA4 §2). A new, additive
-- migration -- neither
-- 20260830190000_pta_family_agreement_contract_linked_buyout nor
-- 20260831120000_pta_family_agreement_retention_hardening is rewritten.
--
-- Purpose: signerDisplayNameAtAcceptance is permanent historical evidence
-- of who acknowledged the agreement. The prior migration gave it a
-- NOT NULL DEFAULT '' purely so its own ALTER TABLE was unconditionally
-- safe regardless of existing row count -- it was never meant to be a
-- value any real acceptance actually receives. The service layer
-- (acceptAgreement, agreements.ts) has already been corrected to fail the
-- acceptance outright (PTA_VOLUNTEER_AGREEMENT_SIGNER_UNRESOLVED) rather
-- than ever writing a blank/whitespace-only name. This migration makes
-- that guarantee a database-level fact, not just an application-level
-- promise:
--   1. Verify no existing row already has a blank/whitespace-only
--      signerDisplayNameAtAcceptance. If one is found, abort loudly
--      (RAISE EXCEPTION) rather than silently proceeding or fabricating a
--      name to satisfy the constraint we're about to add. Because
--      migration files run inside an implicit transaction, this abort
--      rolls back cleanly -- neither the DROP DEFAULT nor the ADD
--      CONSTRAINT below take effect if this check fails.
--   2. Drop the now-obsolete empty-string column default.
--   3. Add a CHECK constraint requiring signerDisplayNameAtAcceptance to
--      contain at least one non-whitespace character, so no future write
--      path -- this service function, a different one, a raw admin
--      command, or a future migration -- can ever insert a blank signer
--      name again.
--
-- Both the existence check and the CHECK constraint use the POSIX regex
-- `~ '\S'` (contains at least one non-whitespace character) rather than
-- `btrim(...) <> ''`. Postgres's single-argument btrim() only strips the
-- SPACE character by default -- a tab-only or newline-only value (e.g.
-- '\t') passes `btrim(x) <> ''` (btrim leaves the tab untouched, so the
-- result is non-empty) while still being exactly the "whitespace-only,
-- not a real name" case this constraint exists to reject. `~ '\S'`
-- correctly rejects any string made up entirely of spaces, tabs,
-- newlines, carriage returns, form feeds, or vertical tabs, matching the
-- application layer's own `.trim()` semantics far more closely.
--
-- Confirmed via read-only production row counts (mirroring the FA3 §1
-- discipline) immediately before writing this migration: the
-- PtaVolunteerAgreementAcceptance table has zero rows in production (the
-- feature remains dormant -- no period has ever had an agreement
-- assigned). The verification step below is therefore expected to be a
-- no-op against production; it exists so this migration is also safe to
-- run against any OTHER environment (a developer's local database, a
-- future staging environment) where a blank row might already exist,
-- rather than assuming production's current empty state forever. No
-- existing row's data is altered anywhere in this migration -- every
-- change here is schema-only.

-- ── 1. Verify no blank signer snapshot exists; abort loudly if one does ──

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PtaVolunteerAgreementAcceptance"
    WHERE "signerDisplayNameAtAcceptance" !~ '\S'
  ) THEN
    RAISE EXCEPTION
      'Migration aborted: one or more PtaVolunteerAgreementAcceptance rows have a blank or whitespace-only signerDisplayNameAtAcceptance. This migration refuses to fabricate a signer name to satisfy the constraint it is about to add -- investigate and repair (or backfill from acceptedByAdult/typedName) the affected row(s) manually, then re-run this migration.';
  END IF;
END $$;

-- ── 2. Drop the now-obsolete empty-string column default ───────────────

ALTER TABLE "PtaVolunteerAgreementAcceptance"
  ALTER COLUMN "signerDisplayNameAtAcceptance" DROP DEFAULT;

-- ── 3. Require a non-blank signer name for every row, permanently ──────

ALTER TABLE "PtaVolunteerAgreementAcceptance"
  ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_signer_nonblank_check"
  CHECK ("signerDisplayNameAtAcceptance" ~ '\S');
