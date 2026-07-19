import { notFound } from "next/navigation";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { getMeetingIntelligencePageGate } from "@/lib/labs/meeting-intelligence/page-gate";
import { InternalPilotBanner } from "@/components/labs/meeting-intelligence/InternalPilotBanner";
import { SpeakerLabelForm } from "@/components/labs/meeting-intelligence/SpeakerLabelForm";
import { TranscriptSegmentList } from "@/components/labs/meeting-intelligence/TranscriptSegmentList";
import { getMeetingIntelligenceTranscript } from "@/lib/labs/meeting-intelligence/transcript";

export default async function MeetingIntelligenceTranscriptPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { organizationId, access } = await getMeetingIntelligencePageGate("meetingIntelligence:review");
  const { jobId } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Transcript" description="Not available for this organization." />
      </main>
    );
  }

  const transcript = await getMeetingIntelligenceTranscript(organizationId, jobId);
  if (!transcript) notFound();

  const speakerLabels = Array.from(new Set(transcript.segments.map((segment) => segment.speakerLabel)));

  return (
    <main className="space-y-6">
      <PageHeader
        title="Transcript"
        description={`Provider: ${transcript.provider} · Language: ${transcript.language ?? "unknown"} · ${transcript.speakerCount ?? speakerLabels.length} speaker(s)`}
        actions={[{ href: `/labs/meeting-intelligence/jobs/${jobId}`, label: "Back to Job" }, { href: `/labs/meeting-intelligence/jobs/${jobId}/minutes`, label: "View Draft Minutes" }]}
      />
      <InternalPilotBanner />

      <SectionCard title="Speaker labels">
        <SpeakerLabelForm jobId={jobId} speakerLabels={speakerLabels} currentMap={transcript.speakerLabelMap} />
      </SectionCard>

      <SectionCard title="Full transcript">
        <TranscriptSegmentList segments={transcript.segments} speakerLabelMap={transcript.speakerLabelMap} />
      </SectionCard>
    </main>
  );
}
