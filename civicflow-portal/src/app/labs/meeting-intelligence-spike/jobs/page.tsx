import Link from "next/link";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PrototypeBanner } from "@/components/labs/PrototypeBanner";
import { MeetingIntelligenceSpikeNav } from "@/components/labs/MeetingIntelligenceSpikeNav";
import { getMeetingIntelligenceSpikeGate } from "@/lib/labs/meeting-intelligence/gate";
import { MOCK_RECENT_JOBS } from "@/lib/labs/meeting-intelligence/fixtures";
import { formatDateTime } from "@/lib/formatting";

export default async function MeetingIntelligenceSpikeJobsPage() {
  const { access } = await getMeetingIntelligenceSpikeGate();
  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Recent Jobs" description="Not available for this organization." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader title="Recent Jobs" description="Synthetic fixture jobs — nothing here is backed by a real database table." actions={[{ href: "/labs/meeting-intelligence-spike", label: "Back to Overview" }]} />
      <PrototypeBanner note="These four jobs are fixed fixture data, not a live queue." />
      <MeetingIntelligenceSpikeNav />

      <SectionCard title="Jobs" description={`${MOCK_RECENT_JOBS.length} synthetic job(s).`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Meeting</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_RECENT_JOBS.map((job) => (
                <tr key={job.jobId} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{job.meetingTitle}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800">{job.stage}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{job.providerId}</td>
                  <td className="px-4 py-3 text-slate-700">{job.durationMinutes} min</td>
                  <td className="px-4 py-3 text-slate-700">{formatDateTime(job.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/labs/meeting-intelligence-spike/jobs/${job.jobId}`} className="text-emerald-700 hover:underline">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
