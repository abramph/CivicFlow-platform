import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import { findMockJob } from "@/lib/labs/meeting-intelligence/fixtures";
import { runMeetingIntelligenceSpikePipeline } from "@/lib/labs/meeting-intelligence/pipeline";

export default async function TranscriptReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { access } = await getMeetingIntelligenceSpikeGate();
  const { jobId } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Transcript Review" description="Not available for this organization." />
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
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title={`Transcript Review — ${job.meetingTitle}`}
        description={`Provider: ${result.providerId} · Duration: ${(result.transcript.durationMs / 60_000).toFixed(1)} minutes`}
        actions={[
          { href: "/labs/meeting-intelligence-spike/jobs", label: "Back to Jobs" },
          { href: `/labs/meeting-intelligence-spike/jobs/${job.jobId}/draft-minutes`, label: "View Draft Minutes" },
        ]}
      />
      <PrototypeBanner note="This transcript is generated locally from a deterministic mock — no audio was recorded, uploaded, or sent to any provider." />

      <SectionCard title="Speaker mapping (suggested, unconfirmed)" description="Low-confidence heuristic suggestions only — a secretary must confirm or correct these before they appear on official minutes.">
        <ul className="space-y-2 text-sm">
          {result.speakerMapping.map((mapping) => (
            <li key={mapping.speakerLabel} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="font-medium text-slate-900">{mapping.speakerLabel}</span>
              <span className="text-slate-700">
                {mapping.suggestedAttendeeName ?? "Unassigned"}{" "}
                <span className="text-xs text-slate-500">({Math.round(mapping.confidence * 100)}% confidence, {mapping.method})</span>
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Transcript" description="Segment-by-segment, with per-segment provider confidence.">
        <ul className="space-y-3 text-sm">
          {result.transcript.segments.map((segment, index) => (
            <li key={index} className="rounded-lg border border-slate-100 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {segment.speakerLabel} · {(segment.startMs / 1000).toFixed(0)}s–{(segment.endMs / 1000).toFixed(0)}s · {Math.round(segment.confidence * 100)}% confidence
              </p>
              <p className="mt-1 text-slate-900">{segment.text}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <p className="text-sm text-slate-600">
        <Link href={`/labs/meeting-intelligence-spike/jobs/${job.jobId}/draft-minutes`} className="font-medium text-emerald-700 hover:underline">
          View the AI-drafted minutes generated from this transcript →
        </Link>
      </p>
    </main>
  );
}
