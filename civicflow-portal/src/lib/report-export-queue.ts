import { prisma } from "@/lib/prisma";
import { deleteObjectFromSpaces } from "@/lib/storage";
import { PtaError } from "@/lib/labs/pta/errors";

/**
 * fix/report-export-queue-hardening.
 *
 * Shared queue-safety primitives for ReportExport, used by BOTH the PTA
 * volunteer-hours async export branch and the generic CSV branch in
 * src/lib/reports.ts — the race this fixes (two overlapping scheduler calls
 * processing the same row) is type-agnostic, so the claim/lease/retry
 * mechanics live here at the queue level rather than being duplicated per
 * report type. Deterministic object-key generation stays report-type-
 * specific (see buildDeterministicVolunteerReportObjectKey below) since only
 * the PTA volunteer branch has been asked to adopt it this phase — the
 * generic CSV branch's existing random-suffix buildSafeObjectKey is
 * untouched, per this branch's explicit "don't touch the other 11 cron
 * queues / don't expand scope" instruction.
 *
 * Mirrors the exact atomic-claim idiom already proven in
 * src/lib/imports/engine.ts's claimBatchForProcessing — a conditional
 * `updateMany` (WHERE status = expected AND ...) whose `count` tells the
 * caller whether THIS invocation won the claim. Two concurrent callers
 * racing the same row: Postgres serializes the two UPDATE statements, so
 * exactly one sees count===1 and the other count===0. This is provably
 * atomic without needing SELECT ... FOR UPDATE SKIP LOCKED, and stays
 * consistent with the one atomic-claim pattern this codebase already uses
 * and already has can already reason about.
 */

/** How long a claimed row may sit in PROCESSING before another invocation
 * may treat it as abandoned (crashed worker) and reclaim it. Generous
 * relative to a real .xlsx build+upload, matching the CLAIM_STALE_AFTER_MS
 * precedent's own reasoning (imports.ts) — long enough that a merely-slow
 * export is never preempted mid-flight, short enough that a genuine crash
 * doesn't strand a job for hours. Centralized constant, not a per-row
 * value — env-configurable only if a real operational need for tuning
 * arises; hardcoding here means every deploy gets the same, reviewed value
 * rather than a misconfigured env var silently changing queue behavior.
 */
export const REPORT_EXPORT_LEASE_MS = 5 * 60_000;

/** Bounded retries — a transient failure (network blip, a momentary Spaces
 * 5xx) gets up to this many total attempts before the job is marked
 * permanently FAILED. */
export const REPORT_EXPORT_MAX_ATTEMPTS = 3;

/** Fixed backoff between attempts. Deliberately not exponential: the queue
 * is swept on a fixed external cadence (every few minutes per
 * DEPLOYMENT.md), so a short fixed delay already spreads retries across
 * separate sweeps without the added complexity of tracking a growing
 * interval for a job type that retries at most twice. */
export const REPORT_EXPORT_RETRY_BACKOFF_MS = 2 * 60_000;

/** Default retention window for a completed export's downloadable file,
 * matching this phase's recommended default. Bounded to a safe range by
 * clampRetentionDays below — never trust an env override blindly. */
const DEFAULT_RETENTION_DAYS = 7;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 30;

function clampRetentionDays(raw: string | undefined): number {
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_RETENTION_DAYS;
  if (parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

/** Fails closed to the documented safe default on any invalid/out-of-range
 * configuration — never silently accepts e.g. a negative or absurdly large
 * value that would immediately expire everything or never expire anything. */
export function getReportExportRetentionDays(): number {
  return clampRetentionDays(process.env.REPORT_EXPORT_RETENTION_DAYS);
}

export interface ClaimedReportExport {
  id: string;
  organizationId: string;
  reportType: string;
  filters: unknown;
  outputFormat: string;
  createdByUserId: string | null;
  attemptCount: number;
  claimId: string;
}

function randomClaimId(): string {
  return `claim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function claimableWhereClause(now: Date) {
  return [
    { status: "QUEUED" as const, nextAttemptAt: null },
    { status: "QUEUED" as const, nextAttemptAt: { lte: now } },
    { status: "PROCESSING" as const, leaseExpiresAt: { lt: now } },
  ];
}

/**
 * Single-row atomic claim attempt — the one place the actual conditional
 * UPDATE lives. Used both by claimReportExportBatch (looping over a
 * candidate list) and directly by processQueuedReportExport (so that
 * function stays safe to call on its own, e.g. from a test or a future
 * direct-invocation path, without first going through the batch claim).
 * Either caller gets the same guarantee: of any number of concurrent
 * attempts to claim the same id, exactly one sees `claimed: true`.
 */
export async function attemptClaimReportExport(id: string): Promise<{ claimed: boolean; claimId: string }> {
  const now = new Date();
  const claimId = randomClaimId();
  const result = await prisma.reportExport.updateMany({
    where: { id, OR: claimableWhereClause(now) },
    data: {
      status: "PROCESSING",
      claimedAt: now,
      leaseExpiresAt: new Date(now.getTime() + REPORT_EXPORT_LEASE_MS),
      claimId,
      attemptCount: { increment: 1 },
    },
  });
  return { claimed: result.count === 1, claimId };
}

/**
 * Atomically claims up to `limit` exports: either freshly QUEUED-and-due
 * (respecting backoff via nextAttemptAt) or PROCESSING-with-an-expired-
 * lease (a crashed/abandoned prior attempt). Each row is claimed with its
 * own independent attemptClaimReportExport call — a row two concurrent
 * invocations both see as a candidate is only ever actually claimed by one
 * of them; the loser's attempt returns claimed:false and it's simply
 * skipped for this tick (never an error, never double-processed).
 */
export async function claimReportExportBatch(limit: number): Promise<ClaimedReportExport[]> {
  const candidates = await prisma.reportExport.findMany({
    where: { OR: claimableWhereClause(new Date()) },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const claimed: ClaimedReportExport[] = [];
  for (const candidate of candidates) {
    const { claimed: won, claimId } = await attemptClaimReportExport(candidate.id);
    if (!won) continue;

    const row = await prisma.reportExport.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        organizationId: true,
        reportType: true,
        filters: true,
        outputFormat: true,
        createdByUserId: true,
        attemptCount: true,
      },
    });
    if (!row) continue; // vanishingly unlikely (deleted between claim and read) — just skip
    claimed.push({ ...row, claimId });
  }
  return claimed;
}

const PERMANENT_ERROR_CODES = new Set([
  "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED",
  "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
  "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
  "PTA_VOLUNTEER_REPORTS_DISABLED",
  "PTA_VOLUNTEER_PERIOD_NOT_FOUND",
  "PTA_HOUSEHOLD_NOT_FOUND",
]);

/** A permanent error (org unallowlisted, reports disabled, bad/missing
 * period, tenant mismatch, ...) will never succeed on retry — burning
 * attempts on it just delays the FAILED state and risks a stale-lease
 * window where the row looks "in flight" for no benefit. Anything else
 * (a network blip, a transient Spaces error, an unexpected exception) is
 * treated as transient and gets the normal bounded-retry treatment. */
export function isPermanentReportExportError(error: unknown): boolean {
  return error instanceof PtaError && PERMANENT_ERROR_CODES.has(error.code);
}

const SENSITIVE_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /https?:\/\/[^\s"']*(?:X-Amz-|Signature=|Expires=)[^\s"']*/gi,
  /AKIA[0-9A-Z]{16}/g,
  /DO00[0-9A-Z]+/g,
  /Bearer\s+\S+/gi,
];

/** Never persist a raw provider response, connection string, signed URL, or
 * bearer token into the row a support engineer (or, worse, an org's own
 * admin via a future "view export errors" UI) might read. Truncated to keep
 * the column reasonably sized and to avoid accidentally capturing a large
 * stack trace with embedded request/response bodies. */
export function sanitizeReportExportErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let cleaned = raw;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[redacted]");
  }
  return cleaned.slice(0, 500);
}

/**
 * Terminal-or-retry decision for a failed processing attempt. Permanent
 * errors and attempt-exhaustion both go straight to FAILED; anything else
 * returns to QUEUED with nextAttemptAt set (bounded fixed backoff) so a
 * later sweep retries it — never re-claimable before that instant, and
 * never claimable by the SAME invocation again this tick since status is
 * QUEUED, not PROCESSING-with-expired-lease, until nextAttemptAt passes.
 */
export async function resolveReportExportFailure(
  exportId: string,
  attemptCount: number,
  error: unknown
): Promise<{ terminal: boolean; sanitizedMessage: string }> {
  const sanitizedMessage = sanitizeReportExportErrorMessage(error);
  const permanent = isPermanentReportExportError(error);
  const exhausted = attemptCount >= REPORT_EXPORT_MAX_ATTEMPTS;

  if (permanent || exhausted) {
    await prisma.reportExport.update({
      where: { id: exportId },
      data: { status: "FAILED", errorMessage: sanitizedMessage, leaseExpiresAt: null },
    });
    return { terminal: true, sanitizedMessage };
  }

  await prisma.reportExport.update({
    where: { id: exportId },
    data: {
      status: "QUEUED",
      errorMessage: sanitizedMessage,
      nextAttemptAt: new Date(Date.now() + REPORT_EXPORT_RETRY_BACKOFF_MS),
      leaseExpiresAt: null,
    },
  });
  return { terminal: false, sanitizedMessage };
}

export async function completeReportExport(exportId: string, objectKey: string): Promise<void> {
  const retentionDays = getReportExportRetentionDays();
  const now = new Date();
  await prisma.reportExport.update({
    where: { id: exportId },
    data: {
      status: "COMPLETED",
      fileUrl: objectKey,
      completedAt: now,
      expiresAt: new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000),
      leaseExpiresAt: null,
      errorMessage: null,
    },
  });
}

/**
 * Fully deterministic — no random component, no PII (organizationId and
 * exportId are both opaque cuids). This is what makes the upload path
 * idempotent-by-construction: a retry (or a reclaim after a crash) recomputes
 * the IDENTICAL key and re-PUTs to it, which S3-compatible object storage
 * treats as a plain overwrite, not a new object. There is deliberately no
 * separate "did the object already get created" check before upload —
 * S3 PUT is atomic per-object (a reader never observes a partially-written
 * object) and idempotent (PUTting the same bytes to the same key twice is a
 * no-op difference), so re-running the exact same upload on retry is always
 * safe and never orphans a second object. This key is never persisted ahead
 * of time in a dedicated column because it doesn't need to be — it's always
 * deterministically reconstructible from (organizationId, exportId) alone,
 * which is the "or make it deterministically reconstructible" option this
 * phase's design explicitly allows instead of an extra schema field.
 */
export function buildDeterministicVolunteerReportObjectKey(organizationId: string, exportId: string): string {
  return `pta-volunteer-reports/${organizationId}/${exportId}.xlsx`;
}

/**
 * Best-effort delete of the deterministic key a permanently-FAILED PTA
 * volunteer export attempt might have uploaded before a LATER step in the
 * same or an earlier attempt failed. Safe unconditionally: DeleteObject on a
 * key that was never written (build failed before upload ever ran) is a
 * normal no-op under S3-compatible semantics, not an error — so this never
 * needs to first check whether the object exists. Never touches any other
 * export's object, since the key is namespaced by this exact exportId.
 */
export async function bestEffortCleanupFailedVolunteerReportUpload(organizationId: string, exportId: string): Promise<void> {
  const key = buildDeterministicVolunteerReportObjectKey(organizationId, exportId);
  try {
    await deleteObjectFromSpaces(key);
  } catch {
    // Deliberately swallowed: this is best-effort tidy-up on a path that's
    // already terminal-FAILED. A delete failure here must never mask or
    // replace the real failure reason already recorded on the row. FAILED
    // rows have no expiresAt, so the cleanup sweep's own retry-on-next-pass
    // logic doesn't cover this path — a stray object from a failed delete
    // here is a known, narrow residual gap, documented rather than silently
    // claimed as fully handled (see docs/report-export-queue-hardening.md).
  }
}

/**
 * Deletes the exact storage object for every COMPLETED export whose
 * retention window has passed, and clears fileUrl (not the row) so a later
 * sweep never re-attempts the same deletion — this is what makes the sweep
 * idempotent under concurrent/overlapping calls: after the first successful
 * clear, fileUrl is null and the row no longer matches this query's `fileUrl:
 * { not: null }` clause at all. The ReportExport row itself (who requested
 * it, report type, organization, every timestamp, the fact that it
 * completed) is never deleted — only the object it pointed to. Never uses a
 * prefix or bucket-wide delete; every call is a single exact-key
 * DeleteObject, and DeleteObject on an already-missing key is itself a safe
 * no-op under S3-compatible semantics, so a row whose object was already
 * removed by an earlier/concurrent sweep is silently, correctly skipped.
 */
export async function runReportExportCleanup(limit: number): Promise<{ checked: number; deleted: number }> {
  const now = new Date();
  const expired = await prisma.reportExport.findMany({
    where: { status: "COMPLETED", expiresAt: { lt: now }, fileUrl: { not: null } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true, fileUrl: true },
  });

  let deleted = 0;
  for (const row of expired) {
    if (!row.fileUrl) continue;
    try {
      await deleteObjectFromSpaces(row.fileUrl);
    } catch {
      continue; // leave fileUrl set so the next sweep retries this exact row
    }
    await prisma.reportExport.updateMany({ where: { id: row.id }, data: { fileUrl: null } });
    deleted += 1;
  }
  return { checked: expired.length, deleted };
}
