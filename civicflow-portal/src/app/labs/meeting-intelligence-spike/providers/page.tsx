import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { MeetingIntelligenceSpikeNav } from "@/components/labs/MeetingIntelligenceSpikeNav";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import { listMeetingTranscriptionProviders, resolveDefaultProviderId } from "@/lib/labs/meeting-intelligence/providers";
import { centsToDollarsDisplay } from "@/lib/labs/meeting-intelligence/cost-model";

export default async function ProviderDiagnosticsPage() {
  const { access } = await getMeetingIntelligenceSpikeGate();
  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Provider Diagnostics" description="Not available for this organization." />
      </main>
    );
  }

  const providers = listMeetingTranscriptionProviders();
  const defaultProviderId = resolveDefaultProviderId();
  const sampleDurationMs = 60 * 60_000;

  return (
    <main className="space-y-6">
      <PageHeader title="Provider Diagnostics" description="Capability and cost comparison between the two prototyped transcription providers." actions={[{ href: "/labs/meeting-intelligence-spike", label: "Back to Overview" }]} />
      <PrototypeBanner note="No provider API keys are configured or used — every figure below is either a capability fact from public documentation or an illustrative cost estimate." />
      <MeetingIntelligenceSpikeNav />

      <SectionCard title="Comparison" description={`Default provider (via MEETING_INTELLIGENCE_PROVIDER, or the recommendation if unset): ${defaultProviderId}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Speaker diarization</th>
                <th className="px-4 py-3">Webhook support</th>
                <th className="px-4 py-3">Formats</th>
                <th className="px-4 py-3">Max file size</th>
                <th className="px-4 py-3">Enterprise readiness</th>
                <th className="px-4 py-3">Est. cost / 60 min</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className={`border-t border-slate-100 ${provider.id === defaultProviderId ? "bg-emerald-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {provider.displayName}
                    {provider.id === defaultProviderId ? <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">Recommended</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{provider.capabilities.speakerDiarization ? "Native" : "Requires separate pass"}</td>
                  <td className="px-4 py-3 text-slate-700">{provider.capabilities.webhookSupport ? "Yes" : "No (synchronous only)"}</td>
                  <td className="px-4 py-3 text-slate-700">{provider.capabilities.supportedFormats.join(", ")}</td>
                  <td className="px-4 py-3 text-slate-700">{provider.capabilities.maxFileSizeMb} MB</td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{provider.capabilities.enterpriseReadiness}</td>
                  <td className="px-4 py-3 text-slate-700">{centsToDollarsDisplay(provider.estimateCostCents(sampleDurationMs))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((provider) => (
          <SectionCard key={provider.id} title={provider.displayName} description="Privacy controls (publicly documented, confirm before production commitment).">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
              {provider.capabilities.privacyControls.map((control) => (
                <li key={control}>{control}</li>
              ))}
            </ul>
          </SectionCard>
        ))}
      </div>
    </main>
  );
}
