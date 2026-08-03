import Link from "next/link";
import { cookies } from "next/headers";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getPtaDashboardMetrics } from "@/lib/labs/pta/dashboard";
import { prisma } from "@/lib/prisma";
import { setupBannerDismissCookieName } from "@/lib/dashboard-setup";
import { DismissSetupBannerButton } from "@/components/app/DismissSetupBannerButton";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { formatDateTime } from "@/lib/formatting";

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function PtaDashboardPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:analytics:read");

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

  // Parity fix: the generic (portal)/dashboard, /settings/dues, and HOA/Union
  // dashboards all show an ongoing "Finish organization setup" nag banner
  // (see src/app/(portal)/dashboard/page.tsx) driven by real DB counts and
  // dismissible via the same cookie every vertical shares
  // (setupBannerDismissCookieName / dismiss-setup-banner route) -- PTA had
  // the one-time /labs/pta/onboarding checklist but no equivalent recurring
  // nudge once an officer navigates away without finishing setup. Reuses the
  // exact same householdsCount/duesChargeCount signals the onboarding
  // checklist already uses, and the same generic dismiss cookie/route (no
  // new infrastructure).
  const [householdsCount, duesChargeCount] = await Promise.all([
    prisma.ptaHousehold.count({ where: { organizationId, schoolYear: profile.currentSchoolYear } }),
    prisma.duesCharge.count({ where: { organizationId, member: { ptaHouseholdBilling: { isNot: null } } } }),
  ]);
  const noHouseholdsYet = householdsCount === 0;
  const noDuesSetUpYet = duesChargeCount === 0;
  const setupBannerDismissed = Boolean((await cookies()).get(setupBannerDismissCookieName(organizationId))?.value);
  const showSetupBanner = !setupBannerDismissed && (noHouseholdsYet || noDuesSetUpYet);

  const quickActions: { href: string; label: string; visible: boolean }[] = [
    { href: "/labs/pta/households/new", label: "Add a household", visible: can("pta:households:manage") },
    { href: "/labs/pta/dues", label: "Review dues & payments", visible: can("pta:dues:manage") },
    { href: "/labs/pta/volunteers/manage", label: "Post a volunteer opportunity", visible: can("pta:volunteers:manage") },
    { href: "/labs/pta/volunteers/approvals", label: "Review volunteer hours", visible: can("pta:volunteer-hours:approve") },
    { href: "/labs/pta/committees", label: "Manage committees", visible: can("pta:committees:manage") },
    { href: "/labs/pta/onboarding", label: "Setup checklist", visible: can("pta:households:manage") },
  ].filter((a) => a.visible);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title={`${profile.schoolOrPtaName} Dashboard`} description={`School year ${profile.currentSchoolYear}. All metrics below are aggregate counts — never a student name.`} />

      {showSetupBanner && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-lg font-semibold text-amber-950">Finish PTA setup</h3>
            <DismissSetupBannerButton />
          </div>
          <p className="mt-2 text-sm leading-6 text-amber-900">Some setup areas still need attention before this school year is fully configured.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {noHouseholdsYet && <li>Add your first household.</li>}
            {noDuesSetUpYet && <li>Create this year&apos;s dues charges.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/labs/pta/households/new" className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">Add a Household</Link>
            <Link href="/labs/pta/dues" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Go to Dues</Link>
          </div>
        </div>
      )}

      {quickActions.length > 0 ? (
        <SectionCard title="Quick actions">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((a) => (
              <Link key={a.href} href={a.href} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                {a.label}
              </Link>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Membership">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Active households" value={metrics.activeHouseholds} />
          <StatCard label="Paid" value={metrics.paidHouseholds} />
          <StatCard label="Unpaid" value={metrics.unpaidHouseholds} helper={metrics.outstandingDuesCents > 0 ? `${centsToDollars(metrics.outstandingDuesCents)} outstanding` : undefined} />
          <StatCard label="Upcoming events" value={metrics.upcomingEventsCount} />
        </div>
      </SectionCard>

      <SectionCard title="Volunteers &amp; Committees">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Slots open" value={metrics.volunteerSlotsOpen} />
          <StatCard label="Slots filled" value={metrics.volunteerSlotsFilled} />
          <StatCard label="Approved hours this year" value={(metrics.approvedVolunteerMinutes / 60).toFixed(1)} />
          <StatCard label="Committees" value={metrics.committeesCount} />
        </div>
        {metrics.pendingVolunteerHourApprovals > 0 || metrics.understaffedShiftsCount > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <StatCard
              label="Pending hour approvals"
              value={metrics.pendingVolunteerHourApprovals}
              helper={metrics.pendingVolunteerHourApprovals > 0 ? <Link href="/labs/pta/volunteers/approvals" className="text-emerald-700 hover:underline">Review now →</Link> : undefined}
            />
            <StatCard label="Understaffed shifts" value={metrics.understaffedShiftsCount} />
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Payments">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            label="Pending payment reports"
            value={metrics.pendingPaymentReportsCount}
            helper={metrics.pendingPaymentReportsCount > 0 ? "Awaiting officer review in Payment Reports" : undefined}
          />
          <StatCard label="Outstanding dues" value={centsToDollars(metrics.outstandingDuesCents)} />
        </div>
      </SectionCard>

      <SectionCard title="Fundraising">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Active campaigns" value={metrics.activeFundraisingCampaigns} />
          <StatCard label="Amount raised" value={centsToDollars(metrics.amountRaisedCents)} />
        </div>
      </SectionCard>

      <SectionCard title="Governance">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Announcements (30d)" value={metrics.recentAnnouncementsCount} />
          <StatCard label="Upcoming meeting" value={metrics.upcomingMeetingTitle ?? "None scheduled"} helper={metrics.upcomingMeetingDate ? formatDateTime(metrics.upcomingMeetingDate) : undefined} />
          <StatCard label="Recently approved minutes" value={metrics.recentlyApprovedMinutesCount} />
          <StatCard label="Teachers on file" value={metrics.teachersCount} />
        </div>
      </SectionCard>
    </main>
  );
}
