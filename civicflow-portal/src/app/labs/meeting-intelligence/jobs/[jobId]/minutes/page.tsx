import { notFound } from "next/navigation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill } from "@/components/admin/OperationsUI";
import { getMeetingIntelligencePageGate } from "@/lib/labs/meeting-intelligence/page-gate";
import { InternalPilotBanner } from "@/components/labs/meeting-intelligence/InternalPilotBanner";
import { MinutesEditor } from "@/components/labs/meeting-intelligence/MinutesEditor";
import { getLatestMeetingMinutesDraft, getMeetingMinutesDraftHistory } from "@/lib/labs/meeting-intelligence/minutes-review";
import type { StructuredMeetingMinutes } from "@/lib/labs/meeting-intelligence/minutes";
import { formatDateTime } from "@/lib/formatting";

export default async function MeetingIntelligenceMinutesPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { organizationId, can, access } = await getMeetingIntelligencePageGate("meetingIntelligence:review");
  const { jobId } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Draft Minutes" description="Not available for this organization." />
      </main>
    );
  }

  const draft = await getLatestMeetingMinutesDraft(organizationId, jobId);
  if (!draft) notFound();

  const history = await getMeetingMinutesDraftHistory(organizationId, jobId);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Draft Minutes"
        description={`Version ${draft.version} — ${draft.status}`}
        actions={[{ href: `/labs/meeting-intelligence/jobs/${jobId}`, label: "Back to Job" }, { href: `/labs/meeting-intelligence/jobs/${jobId}/transcript`, label: "View Transcript" }]}
      />
      <InternalPilotBanner />

      <SectionCard title="Minutes">
        <MinutesEditor
          jobId={jobId}
          draftId={draft.id}
          status={draft.status}
          canApprove={can("meetingIntelligence:approve")}
          content={draft.editableContentJson as unknown as StructuredMeetingMinutes}
        />
      </SectionCard>

      {history.length > 1 ? (
        <SectionCard title="Version history">
          <ul className="space-y-2 text-sm">
            {history.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2">
                <span>Version {row.version}</span>
                <div className="flex items-center gap-3">
                  <StatusPill status={row.status.toLowerCase()} label={row.status} />
                  <span className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </main>
  );
}
