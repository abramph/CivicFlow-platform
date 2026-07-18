import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { MeetingIntelligenceSpikeNav } from "@/components/labs/MeetingIntelligenceSpikeNav";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import { listMeetingTranscriptionProviders } from "@/lib/labs/meeting-intelligence/providers";
import { centsToDollarsDisplay, estimateMeetingCostCents, estimateMonthlyCostCents } from "@/lib/labs/meeting-intelligence/cost-model";

const PER_MEETING_MINUTES = [15, 30, 60, 90];
const MONTHLY_VOLUMES = [100, 500, 1000, 5000];
const AVG_MEETING_MINUTES = 45;

export default async function CostEstimatesPage() {
  const { access } = await getMeetingIntelligenceSpikeGate();
  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Cost Estimates" description="Not available for this organization." />
      </main>
    );
  }

  const providers = listMeetingTranscriptionProviders();

  return (
    <main className="space-y-6">
      <PageHeader title="Cost Estimates" description="Illustrative approximations — no billing, invoicing, or Stripe integration exists anywhere in this spike." actions={[{ href: "/labs/meeting-intelligence-spike", label: "Back to Overview" }]} />
      <PrototypeBanner note="Confirm current vendor and DigitalOcean pricing before treating any figure below as a production budget." />
      <MeetingIntelligenceSpikeNav />

      <SectionCard title="Cost per meeting" description="Transcription + summarization + storage + bandwidth, by duration.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Provider</th>
                {PER_MEETING_MINUTES.map((m) => (
                  <th key={m} className="px-4 py-3">{m} min</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{provider.displayName}</td>
                  {PER_MEETING_MINUTES.map((minutes) => (
                    <td key={minutes} className="px-4 py-3 text-slate-700">
                      {centsToDollarsDisplay(estimateMeetingCostCents(minutes * 60_000, provider.id as "openai" | "assemblyai").totalCents)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Monthly operating cost" description={`At an assumed average meeting length of ${AVG_MEETING_MINUTES} minutes.`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Provider</th>
                {MONTHLY_VOLUMES.map((v) => (
                  <th key={v} className="px-4 py-3">{v.toLocaleString()} meetings/mo</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{provider.displayName}</td>
                  {MONTHLY_VOLUMES.map((volume) => (
                    <td key={volume} className="px-4 py-3 text-slate-700">
                      {centsToDollarsDisplay(estimateMonthlyCostCents(volume, AVG_MEETING_MINUTES, provider.id as "openai" | "assemblyai").totalCents)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
