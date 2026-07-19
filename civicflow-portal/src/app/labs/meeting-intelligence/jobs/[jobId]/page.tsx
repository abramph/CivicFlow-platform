import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { StatusPill } from "@/components/admin/OperationsUI";
import { getMeetingIntelligencePageGate } from "@/lib/labs/meeting-intelligence/page-gate";
import { InternalPilotBanner } from "@/components/labs/meeting-intelligence/InternalPilotBanner";
import { JobActions } from "@/components/labs/meeting-intelligence/JobActions";
import { FAILURE_HANDLING, type MeetingIntelligenceStage } from "@/lib/labs/meeting-intelligence/state-machine";
import { formatDateTime } from "@/lib/formatting";

const STAGE_LABELS: Record<string, string> = {
  CREATED: "Waiting for upload",
  UPLOAD_PENDING: "Waiting for upload",
  UPLOADED: "Upload complete",
  QUEUED: "Queued",
  SUBMITTED_TO_PROVIDER: "Submitting for transcription",
  TRANSCRIBING: "Transcribing",
  TRANSCRIBED: "Transcribed",
  GENERATING_MINUTES: "Generating draft minutes",
  DRAFT_READY: "Draft ready",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  DELETED: "Recording deleted",
};

export default async function MeetingIntelligenceJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { organizationId, access } = await getMeetingIntelligencePageGate("meetingIntelligence:read");
  const { jobId } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Meeting Intelligence Job" description="Not available for this organization." />
      </main>
    );
  }

  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: jobId, organizationId } });
  if (!job) notFound();

  const handling = FAILURE_HANDLING[job.status as MeetingIntelligenceStage];
  const retryAvailable = job.status === "FAILED" && (handling?.retryable ?? false);

  return (
    <main className="space-y-6">
      <PageHeader
        title={job.originalFilename}
        description="Meeting Intelligence processing status."
        actions={[{ href: `/labs/meeting-intelligence/meetings/${job.meetingId}`, label: "Back to Meeting Intelligence" }]}
      />
      <InternalPilotBanner />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Stage" value={STAGE_LABELS[job.status] ?? job.status} />
        <StatCard label="Created" value={formatDateTime(job.createdAt)} />
        <StatCard label="Last update" value={formatDateTime(job.updatedAt)} />
        <StatCard label="Duration" value={job.audioDurationSeconds ? `${Math.round(job.audioDurationSeconds / 60)} min` : "Unknown"} />
      </div>

      <SectionCard title="Status">
        <div className="flex items-center gap-3">
          <StatusPill status={job.status.toLowerCase()} label={job.status.replace(/_/g, " ")} />
          <span className="text-sm text-slate-600">Provider: {job.provider}</span>
        </div>
        {job.status === "FAILED" ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {handling?.organizationFacingMessage ?? job.failureMessage ?? "Processing failed."}
          </p>
        ) : null}
        <div className="mt-4">
          <JobActions jobId={job.id} status={job.status} retryAvailable={retryAvailable} />
        </div>
      </SectionCard>

      {["TRANSCRIBED", "GENERATING_MINUTES", "DRAFT_READY", "IN_REVIEW", "APPROVED"].includes(job.status) ? (
        <SectionCard title="Next steps">
          <div className="flex flex-wrap gap-3">
            <Link href={`/labs/meeting-intelligence/jobs/${job.id}/transcript`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              View Transcript
            </Link>
            {["DRAFT_READY", "IN_REVIEW", "APPROVED"].includes(job.status) ? (
              <Link href={`/labs/meeting-intelligence/jobs/${job.id}/minutes`} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                Review Draft Minutes
              </Link>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </main>
  );
}
