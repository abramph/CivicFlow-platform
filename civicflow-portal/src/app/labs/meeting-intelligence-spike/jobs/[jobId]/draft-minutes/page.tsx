import { notFound } from "next/navigation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import { findMockJob } from "@/lib/labs/meeting-intelligence/fixtures";
import { runMeetingIntelligenceSpikePipeline } from "@/lib/labs/meeting-intelligence/pipeline";

export default async function DraftMinutesPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { access } = await getMeetingIntelligenceSpikeGate();
  const { jobId } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Draft Minutes" description="Not available for this organization." />
      </main>
    );
  }

  const job = findMockJob(jobId);
  if (!job) notFound();

  const result = await runMeetingIntelligenceSpikePipeline({
    organizationId: "spike-fixture-org",
    meetingId: job.jobId,
    meetingTitle: job.meetingTitle,
    audioUrl: `synthetic://${job.jobId}`,
    providerId: job.providerId,
    attendees: [
      { id: "fixture-1", name: "Alex Chair" },
      { id: "fixture-2", name: "Bailey Secretary" },
    ],
    agenda: ["Call to order", "Old business", "New business", "Adjournment"],
  });
  const minutes = result.draftMinutes;

  return (
    <main className="space-y-6">
      <PageHeader
        title={`Draft Minutes — ${minutes.meetingTitle}`}
        description="Draft only. Not an official record."
        actions={[{ href: `/labs/meeting-intelligence-spike/jobs/${job.jobId}`, label: "Back to Transcript" }]}
      />
      <PrototypeBanner />

      <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
        <p className="text-sm font-semibold text-amber-900">Status: {minutes.status.toUpperCase()}</p>
        <p className="mt-1 text-sm text-amber-800">{minutes.aiDisclaimer}</p>
      </div>

      <SectionCard title="Attendance">
        <ul className="text-sm text-slate-800">
          {minutes.attendance.map((row) => (
            <li key={row.speakerLabel}>{row.attendeeName ?? row.speakerLabel}</li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Agenda">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
          {minutes.agenda.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Discussion summary">
        {minutes.discussionSummaries.map((summary, index) => (
          <div key={index} className="text-sm text-slate-800">
            <p className="font-semibold">{summary.topic}</p>
            <p>{summary.summary}</p>
          </div>
        ))}
      </SectionCard>

      <SectionCard title="Motions & votes">
        {minutes.motions.length === 0 ? (
          <p className="text-sm text-slate-600">No motions detected in this transcript.</p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-800">
            {minutes.motions.map((motion, index) => (
              <li key={index}>
                {motion.text} — <span className="font-semibold">{minutes.votes[index]?.result ?? "unrecorded"}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Action items">
        {minutes.actionItems.length === 0 ? (
          <p className="text-sm text-slate-600">No action items detected in this transcript.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            {minutes.actionItems.map((item, index) => (
              <li key={index}>{item.description}</li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Decisions, unresolved issues, follow-ups">
        <div className="grid gap-4 md:grid-cols-3 text-sm text-slate-800">
          <div>
            <p className="font-semibold text-slate-900">Decisions</p>
            <ul className="list-disc pl-5">{minutes.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Unresolved</p>
            <ul className="list-disc pl-5">{minutes.unresolvedIssues.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Follow-ups</p>
            <ul className="list-disc pl-5">{minutes.followUpTasks.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Adjournment">
        <p className="text-sm text-slate-800">{minutes.adjournment.mentioned ? "Meeting adjournment was mentioned in the transcript." : "No adjournment language detected."}</p>
      </SectionCard>
    </main>
  );
}
