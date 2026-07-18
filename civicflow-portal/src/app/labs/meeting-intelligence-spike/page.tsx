import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { MeetingIntelligenceSpikeNav } from "@/components/labs/MeetingIntelligenceSpikeNav";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import { MEETING_JOB_STAGES } from "@/lib/labs/meeting-intelligence/workflow";
import { RunSpikeJobButton } from "@/components/labs/RunSpikeJobButton";

export default async function MeetingIntelligenceSpikePage() {
  const { access } = await getMeetingIntelligenceSpikeGate();

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Meeting Intelligence Spike" description="Internal technical spike — not available." actions={[{ href: "/dashboard", label: "Back to Dashboard" }]} />
        <SectionCard title="Not available" description="This organization does not currently have access to this internal spike.">
          <p className="text-sm text-slate-700">
            Reason: <code className="rounded bg-slate-100 px-1">{access.denialReason}</code>. An APH platform operator can enable{" "}
            <code className="rounded bg-slate-100 px-1">meetingIntelligence</code> for this organization from the Operations Center.
          </p>
        </SectionCard>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Meeting Intelligence Spike"
        description="Technical spike validating architecture, providers, privacy, cost, and workflow — not the production feature."
        actions={[{ href: "/dashboard", label: "Back to Dashboard" }, { href: "/admin/platform/labs", label: "Labs Operations Center" }]}
      />
      <PrototypeBanner />
      <MeetingIntelligenceSpikeNav />

      <SectionCard title="What this spike proves" description="Every piece below is a working prototype, not a mockup screenshot — but none of it is connected to real customer data, billing, or AI provider credentials.">
        <ul className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <li>Provider abstraction with two swappable adapters (OpenAI, AssemblyAI) — see Provider Diagnostics.</li>
          <li>A 14-stage workflow state machine with documented failure handling for every stage.</li>
          <li>A transcript-to-structured-minutes generator producing draft-only output with an AI disclaimer.</li>
          <li>A speaker-labeling heuristic with a clear, low-confidence starting suggestion for human confirmation.</li>
          <li>A cost model for per-meeting and monthly estimates — see Cost Estimates.</li>
          <li>A privacy validation gate and full privacy checklist — see Privacy Information.</li>
          <li>Full Labs framework integration — this page itself only renders because of a real requireOrganizationLabFeature() check.</li>
          <li>A usage-metering call for every synthetic job run, composing the generic Labs usage interface.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Run a synthetic job" description="Generates a mock transcript and draft minutes end to end, records one usage event, and does not persist anything (Recent Jobs below is a fixed fixture list, not a queue).">
        <RunSpikeJobButton />
      </SectionCard>

      <SectionCard title="Workflow stages" description="See docs/meeting-intelligence-spike.md for the full diagram and per-stage failure handling.">
        <div className="flex flex-wrap gap-2">
          {MEETING_JOB_STAGES.map((stage) => (
            <span key={stage} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">
              {stage}
            </span>
          ))}
        </div>
      </SectionCard>
    </main>
  );
}
