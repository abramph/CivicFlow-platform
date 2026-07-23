import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getPtaDashboardMetrics } from "@/lib/labs/pta/dashboard";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { formatDateTime } from "@/lib/formatting";

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function PtaDashboardPage() {
  const { organizationId, access } = await getPtaPageGate("pta:analytics:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="PTA Dashboard" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  if (!profile) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="PTA Dashboard" />
        <EmptyState title="Set up your PTA profile first" description="Configure your school/PTA name and current school year." />
        <Link href="/labs/pta/settings" className="text-sm font-semibold text-emerald-700 hover:underline">Go to PTA settings →</Link>
      </main>
    );
  }

  const metrics = await getPtaDashboardMetrics(organizationId, profile.currentSchoolYear);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title={`${profile.schoolOrPtaName} Dashboard`} description={`School year ${profile.currentSchoolYear}. All metrics below are aggregate counts — never a student name.`} />

      <SectionCard title="Membership">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Active households" value={metrics.activeHouseholds} />
          <StatCard label="Paid" value={metrics.paidHouseholds} />
          <StatCard label="Unpaid" value={metrics.unpaidHouseholds} />
          <StatCard label="Upcoming events" value={metrics.upcomingEventsCount} />
        </div>
      </SectionCard>

      <SectionCard title="Volunteers">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Slots open" value={metrics.volunteerSlotsOpen} />
          <StatCard label="Slots filled" value={metrics.volunteerSlotsFilled} />
          <StatCard label="Hours logged" value={metrics.volunteerHoursLogged.toFixed(1)} />
        </div>
      </SectionCard>

      <SectionCard title="Fundraising">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Active campaigns" value={metrics.activeFundraisingCampaigns} />
          <StatCard label="Amount raised" value={centsToDollars(metrics.amountRaisedCents)} />
        </div>
      </SectionCard>

      <SectionCard title="Governance">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Announcements (30d)" value={metrics.recentAnnouncementsCount} />
          <StatCard label="Upcoming meeting" value={metrics.upcomingMeetingTitle ?? "None scheduled"} helper={metrics.upcomingMeetingDate ? formatDateTime(metrics.upcomingMeetingDate) : undefined} />
          <StatCard label="Recently approved minutes" value={metrics.recentlyApprovedMinutesCount} />
        </div>
      </SectionCard>

      <p className="text-sm text-slate-600">
        <Link href="/labs/pta/households" className="text-emerald-700 hover:underline">Household directory</Link>
        {" · "}
        <Link href="/labs/pta/volunteers" className="text-emerald-700 hover:underline">Volunteer opportunities</Link>
        {" · "}
        <Link href="/labs/pta/settings" className="text-emerald-700 hover:underline">Settings</Link>
      </p>
    </main>
  );
}
