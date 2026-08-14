import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { getGivingSettings } from "@/lib/giving/module";
import { prisma } from "@/lib/prisma";
import { MemberGiveNow } from "@/components/giving/MemberGiveNow";
import { listMySchedules } from "@/lib/giving/recurring";
import { listMyPledges } from "@/lib/giving/pledges";

/**
 * CORE-GIVE-B — the member Give Now surface (docs/core-contributions-giving.md
 * §2). Voluntary giving only: nothing here ever shows a balance owed.
 */
export default async function MemberGivingPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="giving" title="Giving" />
      </div>
    );
  }

  const settings = await getGivingSettings(memberSession.organizationId);
  if (!settings.contributionsEnabled) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-2xl font-bold text-slate-900">Giving</h1>
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
          {memberSession.organizationName} has not enabled online giving yet.
        </p>
      </main>
    );
  }

  const [funds, myContributions, mySchedules, myPledges] = await Promise.all([
    prisma.fund.findMany({
      where: { organizationId: memberSession.organizationId, status: "ACTIVE", allowOneTime: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        suggestedAmounts: true,
        minimumAmount: true,
        maximumAmount: true,
        allowRecurring: true,
        allowPledges: true,
      },
    }),
    prisma.contribution.findMany({
      where: {
        organizationId: memberSession.organizationId,
        voidedAt: null,
        OR: [{ memberId: memberSession.memberId }, { contributorUserId: memberSession.userId }],
      },
      orderBy: { contributionDate: "desc" },
      select: {
        id: true,
        contributionNumber: true,
        amount: true,
        contributionDate: true,
        fund: { select: { name: true } },
        campaign: { select: { name: true } },
      },
      take: 25,
    }),
    listMySchedules(memberSession.organizationId, memberSession.userId),
    listMyPledges(memberSession.organizationId, memberSession.userId),
  ]);

  const yearTotal = myContributions
    .filter((row) => row.contributionDate.getFullYear() === new Date().getFullYear())
    .reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">{settings.terminology}</h1>
      <p className="text-sm text-slate-600">
        Every gift here is voluntary — you choose what to give, and changing your mind never creates a balance owed.
      </p>
      <MemberGiveNow
        organizationId={memberSession.organizationId}
        terminology={settings.terminology}
        funds={funds.map((fund) => ({
          id: fund.id,
          name: fund.name,
          description: fund.description,
          suggestedAmounts: fund.suggestedAmounts.map((amount) => Number(amount)),
          minimumAmount: fund.minimumAmount != null ? Number(fund.minimumAmount) : null,
          maximumAmount: fund.maximumAmount != null ? Number(fund.maximumAmount) : null,
          allowRecurring: fund.allowRecurring,
          allowPledges: fund.allowPledges,
        }))}
        pledges={myPledges.map((pledge) => ({
          id: pledge.id,
          fundId: pledge.fundId,
          fundName: pledge.fundName,
          campaignName: pledge.campaignName,
          pledged: pledge.pledged,
          contributed: pledge.contributed,
          remainingTowardPledge: pledge.remainingTowardPledge,
          progressPercent: pledge.progressPercent,
          status: pledge.status,
        }))}
        schedules={mySchedules.map((schedule) => ({
          id: schedule.id,
          fundName: schedule.fund.name,
          amount: Number(schedule.amount),
          frequency: schedule.frequency,
          status: schedule.status,
          nextContributionDate: schedule.nextContributionDate?.toISOString() ?? null,
          paymentMethodDescriptor: schedule.paymentMethodDescriptor,
        }))}
        yearTotal={yearTotal}
        history={myContributions.map((row) => ({
          id: row.id,
          contributionNumber: row.contributionNumber,
          amount: Number(row.amount),
          date: row.contributionDate.toISOString(),
          designation: row.fund?.name ?? row.campaign?.name ?? "General",
        }))}
      />
    </main>
  );
}
