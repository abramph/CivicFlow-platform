import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";
import {
  getMeetingIntelligenceEnrollments,
  getMeetingIntelligenceStaticDiagnostics,
  getMeetingIntelligenceJobStatusCounts,
  getMeetingIntelligenceStuckJobs,
  getMeetingIntelligenceFailedJobs,
  getMeetingIntelligenceRetentionStatus,
  getMeetingIntelligenceUsageEstimate,
  getMeetingIntelligenceFeedbackSummary,
  getMeetingIntelligenceRecentActivity,
} from "@/lib/platform-operations/meeting-intelligence";
import { RunLiveDiagnosticsButton, RetryFailedJobButton } from "@/components/admin/MeetingIntelligenceOpsControls";

const JOB_STAGE_ORDER = [
  "CREATED",
  "UPLOAD_PENDING",
  "UPLOADED",
  "QUEUED",
  "SUBMITTED_TO_PROVIDER",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_MINUTES",
  "DRAFT_READY",
  "IN_REVIEW",
  "APPROVED",
  "FAILED",
  "CANCELLED",
  "DELETED",
];

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function MeetingIntelligenceOpsPage() {
  await requireSuperAdmin();

  const [enrollments, diagnostics, statusCounts, stuckJobs, failedJobs, retention, usage, feedback, activity] = await Promise.all([
    getMeetingIntelligenceEnrollments(),
    Promise.resolve(getMeetingIntelligenceStaticDiagnostics()),
    getMeetingIntelligenceJobStatusCounts(),
    getMeetingIntelligenceStuckJobs(),
    getMeetingIntelligenceFailedJobs(25),
    getMeetingIntelligenceRetentionStatus(),
    getMeetingIntelligenceUsageEstimate(),
    getMeetingIntelligenceFeedbackSummary(),
    getMeetingIntelligenceRecentActivity(25),
  ]);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Meeting Intelligence Pilot" }]} />
      <PageHeader
        title="Meeting Intelligence — Internal Pilot"
        description="Operational status for the APH Technologies internal pilot. No transcript content, draft content, recording filenames, or participant names are ever shown here. See docs/meeting-intelligence-pilot.md for the full runbook."
      />

      <SectionCard title="Enrollment" description="Organizations enrolled in the meetingIntelligence Labs feature. Change enrollment from the Unestra Labs page.">
        {enrollments.length === 0 ? (
          <EmptyState title="No organization is enrolled" description="Meeting Intelligence is deployed but inert until an organization is explicitly enrolled from /admin/platform/labs." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Enabled at</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((row) => (
                  <tr key={row.organizationId} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">
                      {row.organizationName} <span className="text-xs text-slate-500">({row.organizationSlug})</span>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={row.status.toLowerCase()} label={row.status} /></td>
                    <td className="px-4 py-3 text-slate-700">{row.enabledAt ? formatDateTime(row.enabledAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Provider diagnostics" description="Config-presence checks (always safe, no network calls). Use the button below for an explicit live reachability check — never automatic, never billable.">
        <div className="mb-4 space-y-2">
          {diagnostics.map((service) => (
            <div key={service.service} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{service.service}</p>
                <p className="text-xs text-slate-600">{service.message}</p>
              </div>
              <StatusPill status={service.status} />
            </div>
          ))}
        </div>
        <RunLiveDiagnosticsButton />
      </SectionCard>

      <SectionCard title="Job status" description={`${statusCounts.total} job(s) total across every organization.`}>
        <div className="grid gap-3 md:grid-cols-4">
          {JOB_STAGE_ORDER.filter((stage) => statusCounts.counts[stage]).map((stage) => (
            <StatCard key={stage} label={stage.replace(/_/g, " ")} value={statusCounts.counts[stage] ?? 0} />
          ))}
          {statusCounts.total === 0 ? <EmptyState title="No jobs have been created yet" /> : null}
        </div>
      </SectionCard>

      <SectionCard title="Stuck / stale claims" description="Jobs whose worker claim is older than the staleness threshold (10 minutes) without advancing. The next scheduled cron tick reclaims these automatically — this is visibility, not necessarily an error.">
        {stuckJobs.length === 0 ? (
          <EmptyState title="No stuck jobs" description="No QUEUED or TRANSCRIBING job has an unusually old claim." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Claimed at</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {stuckJobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{job.organizationName}</td>
                    <td className="px-4 py-3"><StatusPill status={job.status.toLowerCase()} label={job.status} /></td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(job.claimedAt ?? job.pollClaimedAt ?? job.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Failed jobs" description="Retry is bounded and server-validated: only a FAILED job with a retryable failure code can be retried, and retry always routes through the same state-machine transition the tenant-facing retry uses — no duplicate provider submission is possible.">
        {failedJobs.length === 0 ? (
          <EmptyState title="No failed jobs" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Failure code</th>
                  <th className="px-4 py-3">Failed at</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {failedJobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{job.organizationName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{job.failureCode ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{job.failedAt ? formatDateTime(job.failedAt) : "—"}</td>
                    <td className="px-4 py-3">
                      <RetryFailedJobButton jobId={job.id} retryable={job.retryable} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Retention" description={`Recordings are deleted ${30} days after a job reaches a settled stage (never the transcript or minutes).`}>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard label="Last recording deletion" value={retention.lastRecordingDeletionAt ? formatDateTime(retention.lastRecordingDeletionAt) : "Never"} />
          <StatCard label="Recordings still stored" value={retention.recordingsPendingDeletion} helper="Settled-stage jobs with a storage object still present." />
          <StatCard label="Due for deletion now" value={retention.recordingsDueForDeletion} helper="Past the 30-day retention window — will be removed on the next retention cron run." />
        </div>
      </SectionCard>

      <SectionCard title="Estimated pilot usage & cost" description="Illustrative estimates only — see cost-constants.ts. Not connected to Stripe or any customer invoice.">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Audio minutes uploaded" value={usage.audioMinutesUploaded.toFixed(1)} />
          <StatCard label="Audio minutes transcribed" value={usage.audioMinutesTranscribed.toFixed(1)} />
          <StatCard label="Transcription jobs" value={usage.transcriptionJobs} />
          <StatCard label="Minutes-generation jobs" value={usage.minutesGenerationJobs} />
          <StatCard label="Est. transcription cost" value={centsToDollars(usage.estimatedTranscriptionCostCents)} />
          <StatCard label="Est. generation cost" value={centsToDollars(usage.estimatedGenerationCostCents)} />
        </div>
      </SectionCard>

      <SectionCard title="Pilot feedback" description="Submitted by APH pilot users reviewing job output — see the Feedback panel on a job's detail page.">
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <StatCard label="Feedback submissions" value={feedback.count} />
          <StatCard label="Average overall rating" value={feedback.averageOverallRating != null ? feedback.averageOverallRating.toFixed(1) : "—"} />
        </div>
        {feedback.count === 0 ? (
          <EmptyState title="No feedback submitted yet" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(feedback.issueCategoryBreakdown).map(([category, count]) => (
                <span key={category} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {category}: {count}
                </span>
              ))}
            </div>
            <div className="space-y-2">
              {feedback.recent.map((row) => (
                <div key={row.id} className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                  <p className="font-semibold text-slate-900">Rating: {row.overallRating}/5 {row.issueCategory ? `· ${row.issueCategory}` : ""}</p>
                  {row.comments ? <p className="mt-1 text-slate-700">{row.comments}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(row.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent audit activity" description="Job, minutes-draft, and feedback lifecycle events — never transcript or draft content.">
        {activity.length === 0 ? (
          <EmptyState title="No activity recorded yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{row.action}</td>
                    <td className="px-4 py-3 text-slate-700">{row.actorEmail ?? "system"}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </main>
  );
}
