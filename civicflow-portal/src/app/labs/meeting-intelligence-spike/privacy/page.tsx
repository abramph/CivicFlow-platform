import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { MeetingIntelligenceSpikeNav } from "@/components/labs/MeetingIntelligenceSpikeNav";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import {
  DEFAULT_RECORDING_RETENTION_DAYS,
  DEFAULT_TRANSCRIPT_RETENTION_DAYS,
  PRIVACY_CHECKLIST,
  RECORDING_NOTICE_TEXT,
} from "@/lib/labs/meeting-intelligence/privacy";

const STATUS_LABEL: Record<string, string> = {
  documented: "Documented",
  prototyped: "Prototyped",
  not_built: "Not built",
};

export default async function PrivacyInformationPage() {
  const { access } = await getMeetingIntelligenceSpikeGate();
  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Privacy Information" description="Not available for this organization." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader title="Privacy Information" description="Full privacy review for the Meeting Intelligence spike." actions={[{ href: "/labs/meeting-intelligence-spike", label: "Back to Overview" }]} />
      <PrototypeBanner note="No customer recordings and no real PHI have been used anywhere in this spike." />
      <MeetingIntelligenceSpikeNav />

      <SectionCard title="Recording notice (shown to participants before recording starts)">
        <p className="text-sm text-slate-800">{RECORDING_NOTICE_TEXT}</p>
      </SectionCard>

      <SectionCard title="Retention windows">
        <ul className="text-sm text-slate-800">
          <li>Raw audio recordings: deleted {DEFAULT_RECORDING_RETENTION_DAYS} days after processing completes.</li>
          <li>Transcripts and generated minutes: retained up to {DEFAULT_TRANSCRIPT_RETENTION_DAYS} days, organization-configurable in a production implementation.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Full privacy checklist" description="See docs/meeting-intelligence-spike.md for the complete prose review and sourcing.">
        <ul className="space-y-3 text-sm">
          {PRIVACY_CHECKLIST.map((item) => (
            <li key={item.topic} className="rounded-lg border border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{item.topic}</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    item.status === "prototyped" ? "bg-emerald-100 text-emerald-800" : item.status === "documented" ? "bg-sky-100 text-sky-800" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              <p className="mt-1 text-slate-700">{item.detail}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
    </main>
  );
}
