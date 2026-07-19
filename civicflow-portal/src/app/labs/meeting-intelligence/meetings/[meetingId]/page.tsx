import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill } from "@/components/admin/OperationsUI";
import { getMeetingIntelligencePageGate } from "@/lib/labs/meeting-intelligence/page-gate";
import { InternalPilotBanner } from "@/components/labs/meeting-intelligence/InternalPilotBanner";
import { UploadRecordingForm } from "@/components/labs/meeting-intelligence/UploadRecordingForm";
import { formatDateTime } from "@/lib/formatting";

export default async function MeetingIntelligenceForMeetingPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { organizationId, can, access } = await getMeetingIntelligencePageGate("meetingIntelligence:read");
  const { meetingId } = await params;

  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId } });
  if (!meeting) notFound();

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Meeting Intelligence" description="Not available for this organization." actions={[{ href: `/meetings/${meetingId}`, label: "Back to Meeting" }]} />
        <SectionCard title="Not available">
          <p className="text-sm text-slate-700">
            Reason: <code className="rounded bg-slate-100 px-1">{access.denialReason}</code>
          </p>
        </SectionCard>
      </main>
    );
  }

  const jobs = await prisma.meetingIntelligenceJob.findMany({
    where: { meetingId, organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, provider: true, originalFilename: true, createdAt: true, failureCode: true },
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title={`Meeting Intelligence — ${meeting.title}`}
        description="Upload a recording to generate draft minutes for human review and approval."
        actions={[{ href: `/meetings/${meetingId}`, label: "Back to Meeting" }]}
      />
      <InternalPilotBanner />

      {can("meetingIntelligence:create") ? (
        <SectionCard title="Upload a new recording" description="Supported formats: MP3, WAV, M4A, MP4, WEBM. Maximum 150 MB.">
          <UploadRecordingForm meetingId={meetingId} />
        </SectionCard>
      ) : null}

      <SectionCard title="Jobs for this meeting" description={`${jobs.length} job(s).`}>
        {jobs.length === 0 ? (
          <p className="text-sm text-slate-600">No recordings submitted yet.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{job.originalFilename}</p>
                  <p className="text-xs text-slate-600">{job.provider} · {formatDateTime(job.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={job.status.toLowerCase()} label={job.status.replace(/_/g, " ")} />
                  <Link href={`/labs/meeting-intelligence/jobs/${job.id}`} className="text-sm font-medium text-emerald-700 hover:underline">
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
