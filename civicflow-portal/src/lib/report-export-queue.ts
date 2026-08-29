import { prisma } from "@/lib/prisma";
import { deleteObjectFromSpaces } from "@/lib/storage";
import { PtaError } from "@/lib/labs/pta/errors";

/**
 * fix/report-export-queue-hardening (+ follow-up: claim-ID-conditioned
 * ownership on every transition, lease duration grounded in the platform's
 * documented HTTP timeout, and durable failed-artifact cleanup).
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
 * exactly one sees count===1 and the other count===0.
 *
 * EVERY state transition past the initial claim (renew, complete, fail) is
 * additionally conditioned on `claimId` matching the row's current value —
 * not just `status='PROCESSING'`. This is what makes ownership loss safe: a
 * worker whose lease was reclaimed by someone else still holds its OLD
 * claimId, so every one of its subsequent conditional updates matches zero
 * rows once the new owner's claim has taken effect, regardless of what that
 * worker still believes its own status to be.
 */

/**
 * DigitalOcean App Platform enforces a hard, non-configurable 100-second
 * HTTP request timeout for `web` services (this app's current deployment
 * type) — confirmed via DigitalOcean's own community support threads
 * (multiple independent, consistent reports; the current published Limits
 * page documents the related-but-distinct 600s file-upload timeout without
 * separately restating this one). Not an assumption: this is the documented
 * ceiling on how long ANY single invocation of `/api/cron/reports` —
 * and therefore any single claimed job's actual processing window within
 * that invocation — can possibly run before the platform itself terminates
 * the connection, regardless of what the application code does.
 */
export const PLATFORM_HTTP_REQUEST_TIMEOUT_MS = 100_000;

/**
 * Workbook generation (buildVolunteerReportExportFile -> exceljs's
 * workbook.xlsx.writeBuffer()) is CPU-bound XML/zip construction that, while
 * it returns a Promise, does the bulk of its work synchronously on the
 * event loop — it does not yield in a way a setInterval-based heartbeat
 * could reliably fire during. This means the lease CANNOT depend on a timer
 * firing mid-generation; it must instead be sized so that a full worst-case
 * generation-plus-upload comfortably fits within one platform-enforced
 * request lifetime, with room to spare. Renewal (renewReportExportLease) is
 * still used at the real async boundaries this code does have — immediately
 * after claim, before upload, and after upload before completion — as
 * defense in depth and because it's the mechanism a FUTURE long-running
 * dedicated worker (which won't have this 100s ceiling at all) would rely
 * on more heavily. For the CURRENT web-service-request architecture, the
 * dominant safety property is structural: the lease is set to comfortably
 * exceed PLATFORM_HTTP_REQUEST_TIMEOUT_MS, so the platform is *guaranteed*
 * to have already killed a legitimately-still-processing invocation's HTTP
 * request before any other invocation could treat its claim as stale. This
 * is the "Alternative model" the design review asked for, chosen because
 * the "renewable lease as primary defense" model requires reliable
 * mid-generation heartbeats that synchronous exceljs work cannot provide —
 * implemented ALONGSIDE renewal-at-boundaries, not instead of it.
 */
export const REPORT_EXPORT_LEASE_MS = 3 * PLATFORM_HTTP_REQUEST_TIMEOUT_MS; // 300,000ms / 5 minutes — unchanged from the original value, now with documented justification rather than an undocumented "generous" guess

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

/** Backoff between durable failed-artifact cleanup retries. Deliberately
 * NOT bounded to a fixed number of total attempts — "a permanently failed
 * export cannot be forgotten merely because its initial deletion failed" —
 * so this retries indefinitely at this fixed cadence. Operational
 * visibility into a persistently-failing cleanup is via
 * artifactCleanupAttempts + artifactCleanupError, not via giving up. */
export const REPORT_EXPORT_CLEANUP_RETRY_BACKOFF_MS = 10 * 60_000;

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

/**
 * Extends the lease for the CURRENT owner only — conditioned on status
 * PROCESSING and the exact claimId matching. Returns false (never throws)
 * if ownership has already moved on (reclaimed by someone else) or the
 * export reached a terminal state — the caller (processQueuedReportExport)
 * must treat `false` as "stop immediately, I am no longer the owner," per
 * the design's explicit requirement: never complete, never fail, never
 * delete an object, never touch retry state once ownership is lost. Never
 * revives a completed/failed/differently-claimed export, since the WHERE
 * clause requires status='PROCESSING' AND claimId=<caller's own value>,
 * which a COMPLETED/FAILED row or a row now owned by a different claimId
 * can never satisfy.
 */
export async function renewReportExportLease(exportId: string, claimId: string): Promise<boolean> {
  const result = await prisma.reportExport.updateMany({
    where: { id: exportId, status: "PROCESSING", claimId },
    data: { leaseExpiresAt: new Date(Date.now() + REPORT_EXPORT_LEASE_MS) },
  });
  return result.count === 1;
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
 * Terminal-or-retry decision for a failed processing attempt — conditioned
 * on the caller's claimId still owning the row. Permanent errors and
 * attempt-exhaustion both go straight to FAILED; anything else returns to
 * QUEUED with nextAttemptAt set (bounded fixed backoff) so a later sweep
 * retries it. `ownershipRetained: false` means the caller lost its claim
 * before this ran (or the export was already terminal) — the caller must
 * NOT treat this as if it successfully failed/retried the job (no audit
 * event, no best-effort artifact cleanup, since the object at the
 * deterministic key may now belong to whoever DOES currently own the row).
 */
export async function resolveReportExportFailure(
  exportId: string,
  claimId: string,
  attemptCount: number,
  error: unknown
): Promise<{ ownershipRetained: boolean; terminal: boolean; sanitizedMessage: string }> {
  const sanitizedMessage = sanitizeReportExportErrorMessage(error);
  const permanent = isPermanentReportExportError(error);
  const exhausted = attemptCount >= REPORT_EXPORT_MAX_ATTEMPTS;
  const terminal = permanent || exhausted;

  const result = await prisma.reportExport.updateMany({
    where: { id: exportId, status: "PROCESSING", claimId },
    data: terminal
      ? { status: "FAILED", errorMessage: sanitizedMessage, leaseExpiresAt: null }
      : {
          status: "QUEUED",
          errorMessage: sanitizedMessage,
          nextAttemptAt: new Date(Date.now() + REPORT_EXPORT_RETRY_BACKOFF_MS),
          leaseExpiresAt: null,
        },
  });

  return { ownershipRetained: result.count === 1, terminal, sanitizedMessage };
}

/**
 * Marks completion — conditioned on the caller's claimId still owning the
 * row. Returns false (never throws) if ownership was lost before this ran;
 * the caller must not treat that as a normal success (no "COMPLETED" audit
 * event) — the file this call just uploaded may be exactly what the actual
 * current owner's own upload also produced (same deterministic key), so
 * nothing needs to be undone, but this invocation didn't finalize anything.
 */
export async function completeReportExport(exportId: string, claimId: string, objectKey: string): Promise<boolean> {
  const retentionDays = getReportExportRetentionDays();
  const now = new Date();
  const result = await prisma.reportExport.updateMany({
    where: { id: exportId, status: "PROCESSING", claimId },
    data: {
      status: "COMPLETED",
      fileUrl: objectKey,
      completedAt: now,
      expiresAt: new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000),
      leaseExpiresAt: null,
      errorMessage: null,
    },
  });
  return result.count === 1;
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
 * Returns whether the delete itself succeeded — the caller uses this to
 * decide whether a durable, retryable cleanup record is needed (see
 * markReportExportArtifactCleanupPending).
 */
export async function bestEffortCleanupFailedVolunteerReportUpload(organizationId: string, exportId: string): Promise<boolean> {
  const key = buildDeterministicVolunteerReportObjectKey(organizationId, exportId);
  try {
    await deleteObjectFromSpaces(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists a durable, retryable cleanup record for a permanently-FAILED PTA
 * volunteer export whose immediate best-effort delete (above) failed. Not
 * conditioned on claimId — by the time this runs the export is already
 * terminal (FAILED), so there's no active ownership left to protect; this
 * only ever marks a FAILED row, never a PROCESSING or COMPLETED one.
 */
export async function markReportExportArtifactCleanupPending(exportId: string, error: unknown): Promise<void> {
  await prisma.reportExport.updateMany({
    where: { id: exportId, status: "FAILED" },
    data: {
      artifactCleanupPending: true,
      artifactCleanupError: sanitizeReportExportErrorMessage(error),
    },
  });
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
 *
 * If the sweep is interrupted after the DeleteObject succeeds but before
 * the fileUrl-clearing update runs (process killed mid-sweep), the row is
 * simply picked up again by the NEXT sweep: expiresAt is still in the past,
 * fileUrl is still (stale-)non-null, so DeleteObject runs again — against
 * an already-missing key, which is a safe no-op — and the update completes
 * that time. Self-healing across sweep interruptions without any special
 * casing.
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

/**
 * Durable retry sweep for permanently-FAILED PTA volunteer exports whose
 * immediate best-effort artifact delete failed (artifactCleanupPending).
 * Retries indefinitely at REPORT_EXPORT_CLEANUP_RETRY_BACKOFF_MS — "a
 * permanently failed export cannot be forgotten merely because its initial
 * deletion failed" — with attempt count + sanitized error persisted for
 * operational visibility rather than a hard give-up ceiling. Same
 * exact-key-only, idempotent-if-absent, never-touches-another-export's-
 * object guarantees as runReportExportCleanup, reusing the identical
 * deterministic-key derivation so it can never target the wrong object.
 */
export async function runFailedArtifactCleanup(limit: number): Promise<{ checked: number; cleaned: number }> {
  const now = new Date();
  const pending = await prisma.reportExport.findMany({
    where: {
      artifactCleanupPending: true,
      artifactCleanupCompletedAt: null,
      OR: [{ artifactCleanupNextAttemptAt: null }, { artifactCleanupNextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, artifactCleanupAttempts: true },
  });

  let cleaned = 0;
  for (const row of pending) {
    const key = buildDeterministicVolunteerReportObjectKey(row.organizationId, row.id);
    try {
      await deleteObjectFromSpaces(key);
      await prisma.reportExport.updateMany({
        where: { id: row.id },
        data: {
          artifactCleanupPending: false,
          artifactCleanupCompletedAt: new Date(),
          artifactCleanupError: null,
        },
      });
      cleaned += 1;
    } catch (error) {
      await prisma.reportExport.updateMany({
        where: { id: row.id },
        data: {
          artifactCleanupAttempts: row.artifactCleanupAttempts + 1,
          artifactCleanupNextAttemptAt: new Date(Date.now() + REPORT_EXPORT_CLEANUP_RETRY_BACKOFF_MS),
          artifactCleanupError: sanitizeReportExportErrorMessage(error),
        },
      });
    }
  }
  return { checked: pending.length, cleaned };
}
