import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { getAnalytics } from "@/lib/apiClient";

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function toDisplayDate(value: Date | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  const hasLegacySession = Boolean(session?.org_id && session?.api_key);
  const hasSaasSession = Boolean(session?.userId && session?.organizationId);

  if (!hasLegacySession && !hasSaasSession) {
    redirect("/login");
  }

  if (hasLegacySession) {
    const analytics = await getAnalytics({
      org_id: String(session?.org_id || ""),
      api_key: String(session?.api_key || ""),
      api_base: String(session?.api_base || process.env.NEXT_PUBLIC_API_BASE || "https://api.civicflowapp.com/api"),
    });

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="mt-1 text-sm text-slate-600">Organization analytics snapshot</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Total Revenue</p>
            <p className="mt-2 text-3xl font-semibold">{toCurrency(analytics.total_amount)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Total Payments</p>
            <p className="mt-2 text-3xl font-semibold">{analytics.total_payments}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold">Payments by Method</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {analytics.payments_by_method.length === 0 ? (
                <li className="text-slate-500">No data.</li>
              ) : analytics.payments_by_method.map((row) => (
                <li key={row.method} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>{row.method}</span>
                  <span className="font-medium">{row.count} ({toCurrency(row.total)})</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold">Monthly Totals</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {analytics.monthly_totals.length === 0 ? (
                <li className="text-slate-500">No data.</li>
              ) : analytics.monthly_totals.map((row) => (
                <li key={row.month} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>{row.month}</span>
                  <span className="font-medium">{toCurrency(row.total)} ({row.count})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const orgId = String(session?.organizationId || "");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      name: true,
      email: true,
      phone: true,
      addressLine1: true,
      city: true,
      state: true,
      zipCode: true,
    },
  });

  const [memberCount, delinquentMembers, pendingLifecycleActionCount] = await Promise.all([
    prisma.orgMember.count({ where: { organizationId: orgId } }),
    prisma.orgMember.count({ where: { organizationId: orgId, isDelinquent: true } }),
    prisma.orgMember.count({
      where: {
        organizationId: orgId,
        isDelinquent: true,
        membershipStatus: { in: ["active", "pending", "suspended"] },
      },
    }),
  ]);

  const [membershipCategoryCount, duesSetupCount] = await Promise.all([
    prisma.category.count({ where: { organizationId: orgId, type: "MEMBERSHIP" } }),
    prisma.category.count({ where: { organizationId: orgId, type: "DUES" } }),
  ]);

  const [contributionTotal, expendituresThisMonth, outstandingDues, duesCollectedThisMonth] =
    await Promise.all([
      prisma.contribution.aggregate({
        where: { organizationId: orgId },
        _sum: { amount: true },
      }),
      prisma.expenditure.aggregate({
        where: { organizationId: orgId, date: { gte: monthStart } },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.duesCharge.aggregate({
        where: { organizationId: orgId, status: { in: ["PENDING", "PARTIAL"] } },
        _sum: { amountDue: true, amountPaid: true },
        _count: { id: true },
      }),
      prisma.duesPayment.aggregate({
        where: { organizationId: orgId, paymentDate: { gte: monthStart } },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

  const [recentCommunications, upcomingFollowUps] = await Promise.all([
    prisma.communicationLog.findMany({
      where: { organizationId: orgId },
      orderBy: [{ communicationDate: "desc" }, { createdAt: "desc" }],
      include: { member: true },
      take: 5,
    }),
    prisma.communicationLog.findMany({
      where: { organizationId: orgId, followUpRequired: true },
      orderBy: [{ followUpDate: "asc" }, { communicationDate: "desc" }],
      include: { member: true },
      take: 5,
    }),
  ]);

  const [recentAttendance, attendanceThisMonth] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { organizationId: orgId },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, event: true },
      take: 5,
    }),
    prisma.attendanceRecord.count({
      where: { organizationId: orgId, meetingDate: { gte: monthStart } },
    }),
  ]);

  const [upcomingMeetings, recentMeetings] = await Promise.all([
    prisma.meeting.findMany({
      where: { organizationId: orgId, meetingDate: { gte: new Date() } },
      orderBy: { meetingDate: "asc" },
      take: 5,
    }),
    prisma.meeting.findMany({
      where: { organizationId: orgId },
      orderBy: { meetingDate: "desc" },
      take: 5,
    }),
  ]);

  const [recentFinancialCorrections, recentTimelineEvents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        organizationId: orgId,
        resource: { in: ["expenditure", "dues_charge", "dues_payment", "contribution", "contribution_receipt"] },
        action: { in: ["update", "void", "correction"] },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.memberTimelineEvent.findMany({
      where: { organizationId: orgId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: { member: true },
    }),
  ]);

  const totalContributions = Number(contributionTotal._sum.amount || 0);
  const profileIncomplete = !organization?.email || !organization?.phone || !organization?.addressLine1 || !organization?.city || !organization?.state || !organization?.zipCode;
  const showSetupBanner = profileIncomplete || membershipCategoryCount === 0 || duesSetupCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-600">SaaS organization snapshot</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Members</p>
          <p className="mt-2 text-3xl font-semibold">{memberCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Contributions</p>
          <p className="mt-2 text-3xl font-semibold">{toCurrency(totalContributions)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Communications</p>
          <p className="mt-2 text-3xl font-semibold">{recentCommunications.length}</p>
          <p className="mt-1 text-sm text-slate-600">{upcomingFollowUps.length} follow-ups open</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Attendance This Month</p>
          <p className="mt-2 text-3xl font-semibold">{attendanceThisMonth}</p>
          <p className="mt-1 text-sm text-slate-600">{recentAttendance.length} recent records loaded</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Expenditures This Month</p>
          <p className="mt-2 text-3xl font-semibold">{toCurrency(Number(expendituresThisMonth._sum.amount || 0))}</p>
          <p className="mt-1 text-sm text-slate-600">{expendituresThisMonth._count.id} expenditure records</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Outstanding Dues</p>
          <p className="mt-2 text-3xl font-semibold">{toCurrency(Number(outstandingDues._sum.amountDue || 0) - Number(outstandingDues._sum.amountPaid || 0))}</p>
          <p className="mt-1 text-sm text-slate-600">{outstandingDues._count.id} open charges</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Delinquent Members</p>
          <p className="mt-2 text-3xl font-semibold">{delinquentMembers}</p>
          <p className="mt-1 text-sm text-slate-600">{pendingLifecycleActionCount} pending suspension/deactivation review</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Dues Collected This Month</p>
          <p className="mt-2 text-3xl font-semibold">{toCurrency(Number(duesCollectedThisMonth._sum.amount || 0))}</p>
          <p className="mt-1 text-sm text-slate-600">{duesCollectedThisMonth._count.id} dues payments</p>
        </div>
      </div>

      {showSetupBanner ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-amber-950">Finish organization setup</h3>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            Your SaaS workspace is active, but some setup areas still need attention before it fully mirrors the desktop workflow.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {profileIncomplete ? <li>Complete the organization profile with contact and address details.</li> : null}
            {membershipCategoryCount === 0 ? <li>Create at least one membership category.</li> : null}
            {duesSetupCount === 0 ? <li>Create at least one dues category or plan.</li> : null}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/settings/organization" className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">Organization Profile</Link>
            <Link href="/settings/categories" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Categories</Link>
            <Link href="/settings/dues" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Dues Setup</Link>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">Quick Actions</h3>
        <p className="mt-2 text-sm text-slate-600">Manage your organization data in SaaS modules.</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link href="/members" className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-700">Members</Link>
          <Link href="/dues" className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Dues</Link>
          <Link href="/contributions" className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Contributions</Link>
          <Link href="/communications" className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Communications</Link>
          <Link href="/attendance" className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Attendance</Link>
          <Link href="/meetings" className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Meetings</Link>
          <Link href="/expenditures/new" className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50">Add Expenditure</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Recent Communications</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {recentCommunications.length === 0 ? <li className="text-slate-500">No communications.</li> : recentCommunications.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/communications/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.subject || row.communicationType}</Link>
                <p className="text-slate-700">{row.member ? `${row.member.firstName} ${row.member.lastName}` : "No member"} · {toDisplayDate(row.communicationDate)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Upcoming Follow-ups</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {upcomingFollowUps.length === 0 ? <li className="text-slate-500">No follow-ups.</li> : upcomingFollowUps.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/communications/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.subject || row.communicationType}</Link>
                <p className="text-slate-700">{toDisplayDate(row.followUpDate)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Recent Attendance</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {recentAttendance.length === 0 ? <li className="text-slate-500">No attendance records.</li> : recentAttendance.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/attendance/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.event?.title || row.meetingTitle || "General meeting"}</Link>
                <p className="text-slate-700">{row.member.firstName} {row.member.lastName} · {row.attendanceStatus}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Upcoming Meetings</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {upcomingMeetings.length === 0 ? <li className="text-slate-500">No upcoming meetings.</li> : upcomingMeetings.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/meetings/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.title}</Link>
                <p className="text-slate-700">{toDisplayDate(row.meetingDate)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Recent Member Transitions</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {recentTimelineEvents.length === 0 ? <li className="text-slate-500">No transitions.</li> : recentTimelineEvents.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/members/${row.memberId}/timeline`} className="font-semibold text-emerald-700 hover:underline">{row.title}</Link>
                <p className="text-slate-700">{row.member.firstName} {row.member.lastName} · {toDisplayDate(row.occurredAt)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Recent Meetings</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {recentMeetings.length === 0 ? <li className="text-slate-500">No meetings.</li> : recentMeetings.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/meetings/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.title}</Link>
                <p className="text-slate-700">{toDisplayDate(row.meetingDate)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Recent Financial Corrections</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {recentFinancialCorrections.length === 0 ? <li className="text-slate-500">No corrections.</li> : recentFinancialCorrections.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">{row.resource}</p>
                <p className="text-slate-700">{row.action} · {toDisplayDate(row.createdAt)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
