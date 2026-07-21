import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveMeetingIntelligenceProviderId, getOpenAiApiKey } from "@/lib/labs/meeting-intelligence/config";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { CLAIM_STALE_AFTER_MS } from "@/lib/labs/meeting-intelligence/worker";
import { SETTLED_STAGES } from "@/lib/labs/meeting-intelligence/retention";
import { RECORDING_RETENTION_DAYS } from "@/lib/labs/meeting-intelligence/storage";
import { verifySpacesBucketAccess } from "@/lib/storage";
import { withTimeout } from "./health";
import type { ServiceHealth } from "./types";

/**
 * Meeting Intelligence internal-pilot Operations Center data layer.
 * Every function here is platform-admin-scoped (cross-tenant by design —
 * this is an operator surface, not a tenant one) and every returned shape
 * is hand-picked, never a raw Prisma record: no transcript/draft content,
 * no signed URLs, no recording filenames, no participant names, no secrets.
 * See docs/meeting-intelligence-pilot.md.
 */

const DEFAULT_TIMEOUT_MS = 5000;

function safeMessage(service: string, error: unknown): string {
  console.error(`[platform-operations/meeting-intelligence] ${service} check failed:`, error);
  return "Check failed — see server logs for detail";
}

// ─── Enrollment ───────────────────────────────────────────────────────────

export interface MeetingIntelligenceEnrollmentSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  status: string;
  enabledAt: string | null;
}

export async function getMeetingIntelligenceEnrollments(): Promise<MeetingIntelligenceEnrollmentSummary[]> {
  const rows = await prisma.organizationLabFeature.findMany({
    where: { featureKey: "meetingIntelligence" },
    include: { organization: { select: { name: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    organizationSlug: row.organization.slug,
    status: row.status,
    enabledAt: row.enabledAt?.toISOString() ?? null,
  }));
}

// ─── Provider / infrastructure diagnostics (static — always safe, no network) ──

/** Config-presence checks only — safe to run on every page load, matches the System Health page's convention. */
export function getMeetingIntelligenceStaticDiagnostics(): ServiceHealth[] {
  const now = () => new Date().toISOString();

  let providerId: string | null = null;
  let providerError: string | null = null;
  try {
    providerId = resolveMeetingIntelligenceProviderId();
  } catch (error) {
    providerError = error instanceof MeetingIntelligenceError ? error.message : "Unable to resolve provider.";
  }

  const assemblyAiConfigured = Boolean(process.env.ASSEMBLYAI_API_KEY);
  const assemblyAi: ServiceHealth = {
    service: "AssemblyAI (transcription provider)",
    status: providerError ? "degraded" : assemblyAiConfigured ? "healthy" : "not_configured",
    checkedAt: now(),
    responseTimeMs: null,
    message: providerError
      ? providerError
      : assemblyAiConfigured
        ? `ASSEMBLYAI_API_KEY is set; selected provider: ${providerId}. No live call made — use "Run live diagnostics" to verify reachability.`
        : "ASSEMBLYAI_API_KEY is not set. Transcription is unavailable until an operator configures it.",
    freshness: "inferred",
  };

  const openAiConfigured = Boolean(getOpenAiApiKey());
  const openAi: ServiceHealth = {
    service: "OpenAI (minutes generation)",
    status: openAiConfigured ? "healthy" : "not_configured",
    checkedAt: now(),
    responseTimeMs: null,
    message: openAiConfigured
      ? "OPENAI_API_KEY is set. AI-generated minutes will be used."
      : "OPENAI_API_KEY is not set — the deterministic (non-AI) fallback generator will be used automatically. This is not an error.",
    freshness: "inferred",
  };

  const spacesConfigured = Boolean(process.env.DO_SPACES_ENDPOINT && process.env.DO_SPACES_BUCKET && process.env.DO_SPACES_ACCESS_KEY_ID);
  const spaces: ServiceHealth = {
    service: "Object storage (DigitalOcean Spaces)",
    status: spacesConfigured ? "healthy" : "not_configured",
    checkedAt: now(),
    responseTimeMs: null,
    message: spacesConfigured
      ? "Spaces credentials configured; no live connection test made. Use \"Run live diagnostics\" to verify bucket access."
      : "DO_SPACES_* env vars not fully set.",
    freshness: "inferred",
  };

  const cronConfigured = Boolean(process.env.CRON_SECRET);
  const cron: ServiceHealth = {
    service: "Cron authentication",
    status: cronConfigured ? "healthy" : "not_configured",
    checkedAt: now(),
    responseTimeMs: null,
    message: cronConfigured
      ? "CRON_SECRET is set. The two Meeting Intelligence cron endpoints can authenticate — confirm they are actually registered with an external scheduler (see docs/meeting-intelligence-pilot.md)."
      : "CRON_SECRET is not set — the cron endpoints will reject every request.",
    freshness: "inferred",
  };

  return [assemblyAi, openAi, spaces, cron];
}

/**
 * Live, explicitly-triggered reachability checks — never run automatically
 * on page load. AssemblyAI check is a metadata-only GET (list transcripts,
 * limit 1) — no audio is submitted, nothing billable happens. Spaces check
 * is a HeadBucket call. Neither ever logs or returns a credential value.
 */
export async function runMeetingIntelligenceLiveDiagnostics(): Promise<ServiceHealth[]> {
  const now = () => new Date().toISOString();
  const results: ServiceHealth[] = [];

  const assemblyAiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!assemblyAiKey) {
    results.push({
      service: "AssemblyAI (live reachability)",
      status: "not_configured",
      checkedAt: now(),
      responseTimeMs: null,
      message: "ASSEMBLYAI_API_KEY is not set — skipped.",
      freshness: "unavailable",
    });
  } else {
    const start = Date.now();
    try {
      const response = await withTimeout(
        fetch("https://api.assemblyai.com/v2/transcript?limit=1", {
          method: "GET",
          headers: { authorization: assemblyAiKey },
        }),
        DEFAULT_TIMEOUT_MS
      );
      results.push({
        service: "AssemblyAI (live reachability)",
        status: response.ok ? "healthy" : response.status === 401 ? "degraded" : "unavailable",
        checkedAt: now(),
        responseTimeMs: Date.now() - start,
        message: response.ok
          ? "Metadata endpoint reachable and authenticated (no audio submitted, non-billable)."
          : response.status === 401
            ? "Endpoint reachable, but authentication failed — the configured key may be invalid."
            : `Endpoint responded with HTTP ${response.status}.`,
        freshness: "live",
      });
    } catch (error) {
      results.push({
        service: "AssemblyAI (live reachability)",
        status: "unavailable",
        checkedAt: now(),
        responseTimeMs: Date.now() - start,
        message: safeMessage("AssemblyAI", error),
        freshness: "live",
      });
    }
  }

  const spacesConfigured = Boolean(process.env.DO_SPACES_ENDPOINT && process.env.DO_SPACES_BUCKET && process.env.DO_SPACES_ACCESS_KEY_ID);
  if (!spacesConfigured) {
    results.push({
      service: "Object storage (live reachability)",
      status: "not_configured",
      checkedAt: now(),
      responseTimeMs: null,
      message: "DO_SPACES_* env vars not fully set — skipped.",
      freshness: "unavailable",
    });
  } else {
    const start = Date.now();
    try {
      await withTimeout(verifySpacesBucketAccess(), DEFAULT_TIMEOUT_MS);
      results.push({
        service: "Object storage (live reachability)",
        status: "healthy",
        checkedAt: now(),
        responseTimeMs: Date.now() - start,
        message: "HeadBucket call succeeded.",
        freshness: "live",
      });
    } catch (error) {
      results.push({
        service: "Object storage (live reachability)",
        status: "unavailable",
        checkedAt: now(),
        responseTimeMs: Date.now() - start,
        message: safeMessage("Object storage", error),
        freshness: "live",
      });
    }
  }

  return results;
}

// ─── Job / worker visibility ──────────────────────────────────────────────

export interface MeetingIntelligenceJobStatusCounts {
  counts: Record<string, number>;
  total: number;
}

export async function getMeetingIntelligenceJobStatusCounts(): Promise<MeetingIntelligenceJobStatusCounts> {
  const rows = await prisma.meetingIntelligenceJob.groupBy({ by: ["status"], _count: { _all: true } });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    counts[row.status] = row._count._all;
    total += row._count._all;
  }
  return { counts, total };
}

export interface MeetingIntelligenceStuckJobSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  status: string;
  claimedAt: string | null;
  pollClaimedAt: string | null;
  createdAt: string;
}

/**
 * Jobs whose claim (submission or polling) is older than the worker's own
 * staleness threshold but the job hasn't advanced — either still actively
 * being processed by a slow-but-alive worker, or a genuinely abandoned claim
 * that the next scheduled tick will reclaim automatically (see worker.ts).
 * Surfaced here purely for visibility, not as an error state by itself.
 */
export async function getMeetingIntelligenceStuckJobs(): Promise<MeetingIntelligenceStuckJobSummary[]> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const rows = await prisma.meetingIntelligenceJob.findMany({
    where: {
      OR: [
        { status: "QUEUED", claimedAt: { lt: staleThreshold } },
        { status: "TRANSCRIBING", pollClaimedAt: { lt: staleThreshold } },
      ],
    },
    include: { organization: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    status: row.status,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    pollClaimedAt: row.pollClaimedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface MeetingIntelligenceFailedJobSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  failureCode: string | null;
  failureMessage: string | null;
  retryable: boolean;
  createdAt: string;
  failedAt: string | null;
}

const RETRYABLE_FAILURE_CODES = new Set([
  "MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE",
  "MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED",
  "MEETING_INTELLIGENCE_PROVIDER_TIMEOUT",
  "MEETING_INTELLIGENCE_TRANSCRIPTION_FAILED",
  "MEETING_INTELLIGENCE_GENERATION_FAILED",
]);

export async function getMeetingIntelligenceFailedJobs(limit = 25): Promise<MeetingIntelligenceFailedJobSummary[]> {
  const rows = await prisma.meetingIntelligenceJob.findMany({
    where: { status: "FAILED" },
    include: { organization: { select: { name: true } } },
    orderBy: { failedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    retryable: row.failureCode != null && RETRYABLE_FAILURE_CODES.has(row.failureCode),
    createdAt: row.createdAt.toISOString(),
    failedAt: row.failedAt?.toISOString() ?? null,
  }));
}

/** Platform-admin job lookup by id only (cross-tenant) — used solely to resolve organizationId server-side before delegating to the tenant-scoped retry function. Never exposes transcript/draft content. */
export async function getMeetingIntelligenceJobForAdmin(jobId: string) {
  return prisma.meetingIntelligenceJob.findUnique({
    where: { id: jobId },
    select: { id: true, organizationId: true, status: true, failureCode: true },
  });
}

// ─── Retention / recordings pending deletion ──────────────────────────────

export interface MeetingIntelligenceRetentionStatus {
  lastRecordingDeletionAt: string | null;
  recordingsPendingDeletion: number;
  recordingsDueForDeletion: number;
}

export async function getMeetingIntelligenceRetentionStatus(): Promise<MeetingIntelligenceRetentionStatus> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECORDING_RETENTION_DAYS);

  const [lastDeletion, pending, due] = await Promise.all([
    prisma.auditEvent.findFirst({
      where: { resource: "meeting_intelligence_job", action: "meeting_intelligence.recording_deleted" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.meetingIntelligenceJob.count({
      where: { status: { in: [...SETTLED_STAGES] }, storageObjectKey: { not: null } },
    }),
    prisma.meetingIntelligenceJob.count({
      where: { status: { in: [...SETTLED_STAGES] }, storageObjectKey: { not: null }, createdAt: { lt: cutoff } },
    }),
  ]);

  return {
    lastRecordingDeletionAt: lastDeletion?.createdAt.toISOString() ?? null,
    recordingsPendingDeletion: pending,
    recordingsDueForDeletion: due,
  };
}

// ─── Usage / cost estimate ─────────────────────────────────────────────────

export interface MeetingIntelligenceUsageEstimate {
  audioMinutesUploaded: number;
  audioMinutesTranscribed: number;
  transcriptionJobs: number;
  minutesGenerationJobs: number;
  estimatedTranscriptionCostCents: number;
  estimatedGenerationCostCents: number;
}

export async function getMeetingIntelligenceUsageEstimate(): Promise<MeetingIntelligenceUsageEstimate> {
  const rows = await prisma.labUsageEvent.groupBy({
    by: ["unit"],
    where: { featureKey: "meetingIntelligence" },
    _sum: { quantity: true },
  });
  const sums: Record<string, number> = {};
  for (const row of rows) sums[row.unit] = row._sum.quantity ?? 0;

  return {
    audioMinutesUploaded: sums.audio_minutes_uploaded ?? 0,
    audioMinutesTranscribed: sums.audio_minutes_transcribed ?? 0,
    transcriptionJobs: sums.transcription_jobs ?? 0,
    minutesGenerationJobs: sums.minutes_generation_jobs ?? 0,
    estimatedTranscriptionCostCents: sums.transcription_provider_cost_estimate ?? 0,
    estimatedGenerationCostCents: sums.generation_cost_estimate ?? 0,
  };
}

// ─── Feedback summary ──────────────────────────────────────────────────────

export interface MeetingIntelligenceFeedbackSummary {
  count: number;
  averageOverallRating: number | null;
  issueCategoryBreakdown: Record<string, number>;
  recent: { id: string; overallRating: number; issueCategory: string | null; comments: string | null; createdAt: string }[];
}

export async function getMeetingIntelligenceFeedbackSummary(): Promise<MeetingIntelligenceFeedbackSummary> {
  const [aggregate, categoryRows, recent] = await Promise.all([
    prisma.meetingIntelligenceFeedback.aggregate({ _avg: { overallRating: true }, _count: { _all: true } }),
    prisma.meetingIntelligenceFeedback.groupBy({ by: ["issueCategory"], _count: { _all: true } }),
    prisma.meetingIntelligenceFeedback.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, overallRating: true, issueCategory: true, comments: true, createdAt: true },
    }),
  ]);

  const issueCategoryBreakdown: Record<string, number> = {};
  for (const row of categoryRows) {
    issueCategoryBreakdown[row.issueCategory ?? "uncategorized"] = row._count._all;
  }

  return {
    count: aggregate._count._all,
    averageOverallRating: aggregate._avg.overallRating,
    issueCategoryBreakdown,
    recent: recent.map((row) => ({
      id: row.id,
      overallRating: row.overallRating,
      issueCategory: row.issueCategory,
      comments: row.comments,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

// ─── Recent audit activity ─────────────────────────────────────────────────

export interface MeetingIntelligenceAuditActivityItem {
  id: string;
  action: string;
  organizationId: string | null;
  actorEmail: string | null;
  createdAt: string;
}

const MEETING_INTELLIGENCE_AUDIT_RESOURCES = ["meeting_intelligence_job", "meeting_minutes_draft", "meeting_intelligence_feedback"];

export async function getMeetingIntelligenceRecentActivity(limit = 25): Promise<MeetingIntelligenceAuditActivityItem[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { resource: { in: MEETING_INTELLIGENCE_AUDIT_RESOURCES } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, organizationId: true, actorEmail: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    organizationId: row.organizationId,
    actorEmail: row.actorEmail,
    createdAt: row.createdAt.toISOString(),
  }));
}
