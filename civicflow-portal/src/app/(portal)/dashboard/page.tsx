import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { getAnalytics } from "@/lib/apiClient";
import type { Permission, Role } from "@/lib/rbac";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { setupBannerDismissCookieName } from "@/lib/dashboard-setup";
import { DismissSetupBannerButton } from "@/components/app/DismissSetupBannerButton";
import { getVerticalTerminology, getQuickActions, getHelpTopics, getEmptyStateCopy } from "@/lib/vertical-terminology";
import { getFinanceDashboard } from "@/lib/giving/finance-dashboard";
import { getLandingRoute } from "@/lib/vertical-navigation";
import { getUnionCaseDashboardCounts } from "@/lib/union/cases";
import type { OrganizationVertical } from "@prisma/client";
import {
  Users, Calendar, DollarSign, TrendingDown, AlertCircle, UserCheck,
  Target, Receipt, ChevronRight, Mail, Shield, FileText, Home, Scale,
} from "lucide-react";

/** Community and Church show the full widget set (both reuse the exact same
 * underlying data model -- see vertical-navigation.ts's CHURCH-VERT-A
 * comment). Union and HOA reuse the same underlying data but only the
 * widgets the spec calls for — "no fake metrics," so campaign/expenditure/
 * governance-breakdown widgets (which have no Union/HOA equivalent yet) are
 * hidden rather than relabeled into something they aren't. */
function dashboardWidgets(vertical: OrganizationVertical) {
  const showFundraisingAndGovernance = vertical === "COMMUNITY" || vertical === "CHURCH";
  return {
    fundraising: showFundraisingAndGovernance,
    // UNION-WEB-DASH: Union gets a membership-status breakdown too (same
    // underlying data every vertical already computes) even though it
    // doesn't get campaign fundraising or payment-method breakdown.
    governance: showFundraisingAndGovernance || vertical === "UNION",
    paymentMethodBreakdown: showFundraisingAndGovernance,
    // CHURCH-VERT-B: Church giving is voluntary -- a Delinquent/Past
    // Due/Outstanding-balance framing across the whole admin dashboard
    // contradicts "Church giving is not automatically a debt" just as much
    // for staff as it does for members (see the mobile Home reshape's same
    // reasoning). This still drives the setup banner's dues-vs-giving
    // nudge for every vertical except Church (Union genuinely does use
    // dues, just de-emphasized -- see duesSecondary below).
    duesFocused: vertical !== "CHURCH",
    // UNION-WEB-DASH: where the five dues/delinquency stat cards render.
    // Community/HOA keep them in the primary KPI grid (unchanged). Union
    // members typically pay via employer payroll checkoff, not Unestra, so
    // those cards move into their own secondary "Dues & Financial
    // Administration" section instead of leading the dashboard. Church
    // gets neither -- giving there is a separate, non-dues concept.
    duesInTopGrid: vertical === "COMMUNITY" || vertical === "HOA",
    duesSecondary: vertical === "UNION",
    // UNION-WEB-DASH: Case Center summary -- Union's actual primary
    // dashboard content (representation/grievance cases), reusing the same
    // getUnionCaseDashboardCounts() the Case Center's own page already
    // uses. Capability-gated separately at render time (union:cases:read),
    // not just vertical.
    unionCaseCenter: vertical === "UNION",
    // PR #43 -- HOA Property/Resident foundation widgets.
    hoaProperties: vertical === "HOA",
    // HOA Violations MVP.
    hoaViolations: vertical === "HOA",
    // HOA Architectural Requests.
    hoaArchitecturalRequests: vertical === "HOA",
  };
}

/** Small keyword match so each vertical's quick actions (Phase 7) get a
 * reasonable icon without a second per-vertical icon map to keep in sync. */
function quickActionIcon(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("invite")) return Users;
  if (lower.includes("event")) return Calendar;
  if (lower.includes("meeting")) return Calendar;
  if (lower.includes("announcement") || lower.includes("communication")) return Mail;
  if (lower.includes("upload") || lower.includes("document")) return FileText;
  if (lower.includes("dues") || lower.includes("volunteer")) return Receipt;
  if (lower.includes("student")) return UserCheck;
  return Target;
}

function toCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function toCurrencyDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function toDisplayDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

const colorMap = {
  emerald: { bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/20", text: "text-emerald-700", border: "border-emerald-200" },
  amber:   { bg: "bg-amber-500/10",   iconBg: "bg-amber-500/20",   text: "text-amber-700",   border: "border-amber-200"   },
  red:     { bg: "bg-red-500/10",     iconBg: "bg-red-500/20",     text: "text-red-700",     border: "border-red-200"     },
  sky:     { bg: "bg-sky-500/10",     iconBg: "bg-sky-500/20",     text: "text-sky-700",     border: "border-sky-200"     },
} as const;

type Color = keyof typeof colorMap;

function StatCard({
  label, value, subtext, icon: Icon, color, href,
}: {
  label: string; value: string | number; subtext: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  color: Color; href?: string;
}) {
  const c = colorMap[color];
  const inner = (
    <div className={`relative rounded-xl border-2 ${c.border} ${c.bg} p-6 shadow-sm transition-all ${href ? "hover:-translate-y-0.5 hover:shadow-md cursor-pointer" : ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{label}</h3>
          <p className="text-3xl font-bold text-slate-800 mt-2">{value}</p>
          <p className="text-sm text-slate-500 mt-1">{subtext}</p>
        </div>
        <div className={`rounded-xl p-3 ${c.iconBg}`}>
          <Icon className={`h-8 w-8 ${c.text}`} strokeWidth={2} />
        </div>
      </div>
      {href && <ChevronRight className="absolute right-4 bottom-4 h-4 w-4 text-slate-400" />}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  const hasLegacySession = Boolean(session?.org_id && session?.api_key);
  const hasSaasSession = Boolean(session?.userId && session?.organizationId);

  if (!hasLegacySession && !hasSaasSession) {
    if (session?.userId) redirect("/onboarding/organization");
    redirect("/login");
  }

  // Members have zero staff permissions and must never see this
  // organization-wide financial/member summary — send them to their own
  // member-facing view instead. A MEMBER-role session with no memberId is a
  // pure PTA household parent (no OrgMember record at all) — /m/dues has
  // nothing to show them, so send them to their household page instead.
  if (hasSaasSession && session?.role === "MEMBER") {
    redirect(session.memberId ? "/m/dues" : "/m/my-household");
  }

  // A PTA/PTO organization has its own dashboard (Unestra Labs) — a PTA
  // president landing here would see Community wording and metrics that
  // don't describe their organization. Redirect rather than duplicate.
  if (hasSaasSession && session?.primaryVertical) {
    const landingRoute = getLandingRoute(session.primaryVertical);
    if (landingRoute !== "/dashboard") redirect(landingRoute);
  }

  // ── Legacy API path ────────────────────────────────────────────────────────
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
            <p className="mt-2 text-3xl font-semibold">{toCurrencyDecimal(analytics.total_amount)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Total Payments</p>
            <p className="mt-2 text-3xl font-semibold">{analytics.total_payments}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── SaaS path ──────────────────────────────────────────────────────────────
  const orgId = String(session?.organizationId || "");
  const role = (session?.role ?? "READ_ONLY") as Role;
  const permissions = await getEffectivePermissions(orgId, role);
  const can = (permission: Permission) => permissions.includes(permission);
  const canSeeExpenditures = can("expenditures:read");
  const vertical: OrganizationVertical = session?.primaryVertical ?? "COMMUNITY";
  const terminology = getVerticalTerminology(vertical);
  // CORE-GIVE-I (§54): giving cards render ONLY for summary-capability
  // holders with the module enabled — an ordinary admin or member must never
  // receive organizational contribution totals accidentally.
  const canSeeGivingSummary = can("contributions:summary:view");
  const canSeeGroups = can("groups:view");
  // UNION-WEB-DASH: Case Center summary and financial-administration
  // visibility are capability-gated independently of each other -- e.g. a
  // FINANCE-role viewer deliberately holds zero union:cases:* permissions
  // (see rbac.ts's own comment on the FINANCE bundle) and must never see
  // case counts, while a STAFF-role steward holds case permissions but not
  // necessarily dues:read.
  const canSeeUnionCases = can("union:cases:read");
  const canSeeUnionCaseManage = can("union:cases:manage");
  const canSeeDues = can("dues:read");
  const widgets = dashboardWidgets(vertical);
  const quickActionDefs = [...getQuickActions(vertical)];
  if (vertical === "UNION" && canSeeUnionCases) {
    quickActionDefs.push({ href: "/union/cases", label: "Case Center" });
  }
  if (vertical === "UNION" && canSeeUnionCaseManage) {
    quickActionDefs.push({ href: "/union/cases?bucket=unassigned", label: "Review New Requests" });
  }
  const helpTopics = getHelpTopics(vertical);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ytdStart   = new Date(now.getFullYear(), 0, 1);
  const last30     = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    organization,
    memberCount,
    membershipBreakdown,
    delinquentCount,
    pastDueCount,
    duesOutstanding,
    duesCollected30d,
    duesTotal,
    contributions,
    campaignContributions,
    eventContributions,
    expendituresMonth,
    expendituresYtd,
    expenditures30d,
    upcomingEventsCount,
    activeCampaigns,
    duesPaymentMethods,
    duesAccountCount,
    recentTimelineEvents,
    upcomingMeetings,
    openingBalance,
  ] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, email: true, phone: true, addressLine1: true, city: true, state: true, zipCode: true, logoUrl: true },
    }),
    prisma.orgMember.count({ where: { organizationId: orgId } }),
    prisma.orgMember.groupBy({
      by: ["membershipStatus"],
      where: { organizationId: orgId },
      _count: { id: true },
    }),
    prisma.orgMember.count({ where: { organizationId: orgId, isDelinquent: true } }),
    prisma.orgMember.count({
      where: { organizationId: orgId, isDelinquent: true, membershipStatus: { in: ["active", "pending"] } },
    }),
    prisma.duesCharge.aggregate({
      where: { organizationId: orgId, status: { in: ["PENDING", "PARTIAL"] } },
      _sum: { amountDue: true, amountPaid: true },
    }),
    prisma.duesPayment.aggregate({
      where: { organizationId: orgId, paymentDate: { gte: last30 } },
      _sum: { amount: true },
    }),
    prisma.duesPayment.aggregate({
      where: { organizationId: orgId },
      _sum: { amount: true },
    }),
    prisma.contribution.aggregate({
      where: { organizationId: orgId, voidedAt: null },
      _sum: { amount: true },
    }),
    prisma.contribution.aggregate({
      where: { organizationId: orgId, voidedAt: null, campaignId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.contribution.aggregate({
      where: { organizationId: orgId, voidedAt: null, eventId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.expenditure.aggregate({
      where: { organizationId: orgId, date: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.expenditure.aggregate({
      where: { organizationId: orgId, date: { gte: ytdStart } },
      _sum: { amount: true },
    }),
    prisma.expenditure.aggregate({
      where: { organizationId: orgId, date: { gte: last30 } },
      _sum: { amount: true },
    }),
    prisma.event.count({
      where: { organizationId: orgId, startAt: { gte: now } },
    }),
    prisma.campaign.findMany({
      where: { organizationId: orgId, status: "active" },
      select: {
        id: true, name: true, goal: true,
        contributions: {
          where: { voidedAt: null },
          select: { amount: true },
        },
      },
      take: 10,
    }),
    prisma.duesPayment.groupBy({
      by: ["method"],
      where: { organizationId: orgId },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
    // The real signal that "dues billing is set up" is whether a DuesAccount
    // exists, not whether the org has created any (purely optional) Category
    // tag rows -- verified live that an org with real members, real dues
    // charges, and real payments still showed zero Category rows and was
    // nagged forever by this banner despite already being fully operational.
    prisma.duesAccount.count({ where: { organizationId: orgId, isActive: true } }),
    prisma.memberTimelineEvent.findMany({
      where: { organizationId: orgId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: { member: true },
    }),
    prisma.meeting.findMany({
      where: { organizationId: orgId, meetingDate: { gte: now } },
      orderBy: { meetingDate: "asc" },
      take: 5,
    }),
    prisma.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: { openingBalanceCents: true, openingBalanceDate: true, duesCollectionMethod: true },
    }),
  ]);

  // PR #43 -- HOA Property/Resident stats, queried only for HOA orgs (these
  // tables are empty/irrelevant for every other vertical, so there's no
  // reason to pay the query cost on every dashboard load). Real counts
  // only -- no fake/placeholder metrics.
  const hoaPropertyStats = vertical === "HOA"
    ? await (async () => {
        const [activeProperties, propertiesWithNoContact, activeResidents, recentProperties] = await Promise.all([
          prisma.property.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
          prisma.property.count({
            where: { organizationId: orgId, status: "ACTIVE", residents: { none: { status: "ACTIVE" } } },
          }),
          prisma.propertyResident.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
          prisma.property.findMany({
            where: { organizationId: orgId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, addressLine1: true, unitLabel: true, displayName: true, propertyType: true, createdAt: true },
          }),
        ]);
        return { activeProperties, propertiesWithNoContact, activeResidents, recentProperties };
      })()
    : null;

  // HOA Violations MVP -- same reasoning as hoaPropertyStats above (queried
  // only for HOA orgs; the Violation table is empty/irrelevant otherwise).
  const hoaViolationStats = vertical === "HOA"
    ? await (async () => {
        const [openCount, overdueCount, recentViolations] = await Promise.all([
          prisma.violation.count({ where: { organizationId: orgId, status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_REVIEW"] } } }),
          prisma.violation.count({
            where: { organizationId: orgId, status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_REVIEW"] }, cureByDate: { lt: new Date() } },
          }),
          prisma.violation.findMany({
            where: { organizationId: orgId, status: { not: "DRAFT" } },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, violationType: true, status: true, createdAt: true, property: { select: { addressLine1: true, unitLabel: true, displayName: true } } },
          }),
        ]);
        return { openCount, overdueCount, recentViolations };
      })()
    : null;

  // HOA Architectural Requests -- same reasoning as hoaViolationStats
  // above (queried only for HOA orgs). "Approved this period" is a
  // rolling 30-day window, not a calendar month, matching this file's own
  // "30D" convention used elsewhere on this dashboard.
  const hoaArchitecturalRequestStats = vertical === "HOA"
    ? await (async () => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const [submittedCount, inReviewCount, changesRequestedCount, approvedThisPeriodCount, recentRequests] = await Promise.all([
          prisma.architecturalRequest.count({ where: { organizationId: orgId, status: "SUBMITTED" } }),
          prisma.architecturalRequest.count({ where: { organizationId: orgId, status: { in: ["IN_REVIEW", "RESUBMITTED"] } } }),
          prisma.architecturalRequest.count({ where: { organizationId: orgId, status: "CHANGES_REQUESTED" } }),
          prisma.architecturalRequest.count({
            where: { organizationId: orgId, status: { in: ["APPROVED", "CONDITIONALLY_APPROVED"] }, decidedAt: { gte: thirtyDaysAgo } },
          }),
          prisma.architecturalRequest.findMany({
            where: { organizationId: orgId, status: { not: "DRAFT" } },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              requestNumber: true,
              title: true,
              status: true,
              createdAt: true,
              property: { select: { addressLine1: true, unitLabel: true, displayName: true } },
            },
          }),
        ]);
        return { submittedCount, inReviewCount, changesRequestedCount, approvedThisPeriodCount, recentRequests };
      })()
    : null;

  // UNION-WEB-DASH: Case Center summary counts, queried only for Union
  // orgs whose viewer actually holds union:cases:read (a FINANCE-role
  // viewer, for example, deliberately never triggers this query at all --
  // see rbac.ts's own comment on why FINANCE holds no union:cases:*
  // permission). Reuses the exact same getUnionCaseDashboardCounts() the
  // Case Center's own page (/union/cases) already calls -- no new
  // aggregation logic, no N+1, just the existing scoped count() queries.
  const unionCaseCounts = vertical === "UNION" && canSeeUnionCases
    ? await (async () => {
        const viewerMember = await prisma.orgMember.findFirst({
          where: { organizationId: orgId, userId: String(session?.userId || "") },
          select: { id: true },
        });
        return getUnionCaseDashboardCounts(orgId, viewerMember?.id ?? "");
      })()
    : null;

  // Derived values
  const totalDuesCents    = Math.round(Number(duesTotal._sum.amount || 0) * 100);
  const totalContribCents = Math.round(Number(contributions._sum.amount || 0) * 100);
  const campaignCents     = Math.round(Number(campaignContributions._sum.amount || 0) * 100);
  const eventCents        = Math.round(Number(eventContributions._sum.amount || 0) * 100);
  const expMonthCents     = Math.round(Number(expendituresMonth._sum.amount || 0) * 100);
  const expYtdCents       = Math.round(Number(expendituresYtd._sum.amount || 0) * 100);
  const exp30dCents       = Math.round(Number(expenditures30d._sum.amount || 0) * 100);
  const dues30dCents      = Math.round(Number(duesCollected30d._sum.amount || 0) * 100);
  const outstandingCents  = Math.round((Number(duesOutstanding._sum.amountDue || 0) - Number(duesOutstanding._sum.amountPaid || 0)) * 100);
  const openingCents      = openingBalance?.openingBalanceCents ?? 0;
  const ledgerCents       = totalDuesCents + totalContribCents - expYtdCents + openingCents;


  // CORE-GIVE-I (§54): permission-gated giving + groups snapshots.
  const givingSettingsRow = canSeeGivingSummary
    ? await prisma.orgSettings.findUnique({ where: { organizationId: orgId }, select: { contributionsEnabled: true } })
    : null;
  const givingDashboard = givingSettingsRow?.contributionsEnabled ? await getFinanceDashboard(orgId) : null;
  const activeGroupsCount = canSeeGroups
    ? await prisma.orgGroup.count({ where: { organizationId: orgId, status: "ACTIVE" } })
    : 0;

  const statusCounts = Object.fromEntries(
    membershipBreakdown.map((r) => [r.membershipStatus, r._count.id])
  );

  const profileIncomplete = !organization?.email || !organization?.phone || !organization?.addressLine1 || !organization?.city || !organization?.state || !organization?.zipCode;
  const noMembersYet = memberCount === 0;
  // CHURCH-VERT-B: a church's setup nudge is "set up giving" (Fund), not
  // "set up a dues plan" -- giving is voluntary, so a DuesAccount is not the
  // right completeness signal for this vertical (mirrors the onboarding
  // checklist's fundCount-based Church step).
  const noGivingSetUpYet = widgets.duesFocused ? false : (await prisma.fund.count({ where: { organizationId: orgId } })) === 0;
  const noDuesSetUpYet = widgets.duesFocused && duesAccountCount === 0;
  const setupBannerDismissed = Boolean((await cookies()).get(setupBannerDismissCookieName(orgId))?.value);
  const showSetupBanner = !setupBannerDismissed && (profileIncomplete || noMembersYet || noDuesSetUpYet || noGivingSetUpYet);

  const campaignProgress = activeCampaigns.map((c) => ({
    id: c.id,
    name: c.name,
    goalCents: Math.round(Number(c.goal || 0) * 100),
    raisedCents: c.contributions.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0),
  }));

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    CASH: "Cash", CHECK: "Check", CREDIT_CARD: "Credit Card", DEBIT_CARD: "Debit Card",
    ACH: "ACH", ZELLE: "Zelle", CASH_APP: "Cash App", VENMO: "Venmo",
    PAYPAL: "PayPal", STRIPE: "Stripe", ZEFFY: "Zeffy", OTHER: "Other",
  };

  return (
    <div className="space-y-8 p-2">
      {/* Header */}
      <div className="flex items-center gap-4">
        {organization?.logoUrl && (
          <img src={organization.logoUrl} alt="" className="h-12 w-12 rounded object-contain bg-slate-100 border border-slate-200" />
        )}
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{terminology.dashboardTitle}</h2>
          <p className="text-slate-600">{terminology.dashboardWelcome}</p>
        </div>
      </div>

      {/* Setup Banner */}
      {showSetupBanner && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-lg font-semibold text-amber-950">Finish organization setup</h3>
            <DismissSetupBannerButton />
          </div>
          <p className="mt-2 text-sm leading-6 text-amber-900">Some setup areas still need attention before your portal is fully configured.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {profileIncomplete && <li>Complete the organization profile with contact and address details.</li>}
            {noMembersYet && <li>Add your first member.</li>}
            {noDuesSetUpYet && <li>Set up a dues plan for at least one member.</li>}
            {noGivingSetUpYet && <li>Create a fund so members can start giving.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/settings/organization" className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">Organization Profile</Link>
            <Link href="/members/new" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Add a Member</Link>
            {widgets.duesFocused ? (
              <Link href="/settings/dues" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Dues Setup</Link>
            ) : (
              <Link href="/settings/giving" className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">Giving Setup</Link>
            )}
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label={`Total ${terminology.memberPlural}`} value={memberCount}             subtext={`All ${terminology.memberPlural.toLowerCase()}`}        icon={Users}       color="emerald" href="/members" />
        {widgets.duesInTopGrid && <StatCard label={`Total ${terminology.duesLabel}`}    value={toCurrency(totalDuesCents)}    subtext="All time"     icon={DollarSign}  color="emerald" href="/dues" />}
        <StatCard label="Total Contributions"     value={toCurrency(totalContribCents)} subtext="All time"     icon={DollarSign}  color="sky"     href="/contributions" />
        {widgets.fundraising && <StatCard label="Campaign Contributions"  value={toCurrency(campaignCents)}     subtext="All time"     icon={Target}      color="emerald" href="/campaigns" />}
        <StatCard label="Event Revenue"           value={toCurrency(eventCents)}        subtext="All time"     icon={Calendar}    color="sky"     href="/events" />
        <StatCard label={`Current ${terminology.memberPlural}`} value={statusCounts["active"] ?? 0}   subtext="Active status" icon={UserCheck}  color="emerald" />
        {/* UNION-WEB-DASH: Union's primary KPIs -- representation activity,
            not payment collection. Never rendered for a viewer without
            union:cases:read (e.g. FINANCE), same gate as the Case Center
            section below. */}
        {widgets.unionCaseCenter && unionCaseCounts && (
          <StatCard
            label="Open Cases"
            value={unionCaseCounts.active + unionCaseCounts.pending}
            subtext={`${unionCaseCounts.newUnassigned} new / unassigned`}
            icon={Scale}
            color="sky"
            href="/union/cases"
          />
        )}
        {widgets.unionCaseCenter && unionCaseCounts && (
          <StatCard
            label="Upcoming Deadlines"
            value={unionCaseCounts.deadlinesApproaching}
            subtext={unionCaseCounts.overdue > 0 ? `${unionCaseCounts.overdue} overdue` : "Due within 7 days"}
            icon={AlertCircle}
            color={unionCaseCounts.overdue > 0 ? "red" : "sky"}
            href="/union/cases?bucket=deadlines-approaching"
          />
        )}
        {widgets.duesInTopGrid && <StatCard label="Delinquent"              value={delinquentCount}               subtext={`Behind on ${terminology.duesLabel.toLowerCase()}`} icon={AlertCircle} color="red"   href="/dues" />}
        {widgets.duesInTopGrid && <StatCard label="Past Due"                value={pastDueCount}                  subtext="Pending action" icon={AlertCircle} color="amber" href="/dues" />}
        {widgets.duesInTopGrid && <StatCard label={`${terminology.duesLabel} Outstanding`} value={toCurrency(outstandingCents)}  subtext="Unpaid charges" icon={DollarSign} color="amber" href="/dues" />}
        {widgets.duesInTopGrid && <StatCard label={`${terminology.duesLabel} Collected (30d)`} value={toCurrency(dues30dCents)}      subtext="Last 30 days"  icon={DollarSign}  color="emerald" href="/dues" />}
        {canSeeExpenditures && <StatCard label="Expenses (30d)"          value={toCurrency(exp30dCents)}       subtext="Last 30 days"  icon={TrendingDown} color="amber" href="/expenditures" />}
        {canSeeExpenditures && <StatCard label="Ledger Total"            value={toCurrency(ledgerCents)}       subtext="Income minus expenses" icon={DollarSign} color="sky" />}
        {canSeeExpenditures && <StatCard label="Expenditures (Month)"    value={toCurrency(expMonthCents)}     subtext="Current month" icon={Receipt}     color="red"     href="/expenditures" />}
        {canSeeExpenditures && <StatCard label="Expenditures (YTD)"      value={toCurrency(expYtdCents)}       subtext="Year to date"  icon={Receipt}     color="red"     href="/expenditures" />}
        <StatCard label="Upcoming Events"         value={upcomingEventsCount}           subtext="Next 30 days"  icon={Calendar}    color="sky"     href="/events" />
        {givingDashboard && <StatCard label="Giving This Month"     value={toCurrency(Math.round(givingDashboard.thisMonth * 100))}              subtext="Contributions module" icon={DollarSign} color="emerald" href="/giving/dashboard" />}
        {givingDashboard && <StatCard label="Recurring Giving"      value={`${toCurrency(Math.round(givingDashboard.recurringMonthlyRunRate * 100))}/mo`} subtext={`${givingDashboard.activeRecurringContributors} active contributors`} icon={DollarSign} color="sky" href="/giving/dashboard" />}
        {givingDashboard && givingDashboard.failedNeedingAttention > 0 && (
          <StatCard label="Giving Needs Attention" value={givingDashboard.failedNeedingAttention} subtext="Failed recurring payments" icon={AlertCircle} color="amber" href="/giving/dashboard" />
        )}
        {canSeeGroups && activeGroupsCount > 0 && <StatCard label="Active Groups" value={activeGroupsCount} subtext="Ministries, committees, chapters" icon={Users} color="sky" href="/groups" />}
      </div>

      {/* UNION-WEB-DASH: Case Center summary -- Union's actual primary
          dashboard content, positioned right after the KPI row per the
          Membership → Representation → Communication → Activity →
          Administration → Finances priority order. Reuses the exact same
          bucket counts /union/cases's own dashboard already computes. */}
      {widgets.unionCaseCenter && canSeeUnionCases && unionCaseCounts && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Scale className="h-5 w-5 text-sky-600" />
              Case Center
            </h3>
            <Link href="/union/cases" className="text-sm font-semibold text-emerald-700 hover:underline">
              View Case Center →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/union/cases?bucket=unassigned" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center hover:bg-amber-100">
              <p className="text-3xl font-bold text-amber-700">{unionCaseCounts.newUnassigned}</p>
              <p className="text-sm font-medium text-amber-600 mt-1">New / unassigned</p>
            </Link>
            <Link href="/union/cases?bucket=assigned-to-me" className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-center hover:bg-sky-100">
              <p className="text-3xl font-bold text-sky-700">{unionCaseCounts.assignedToMe}</p>
              <p className="text-sm font-medium text-sky-600 mt-1">Assigned to me</p>
            </Link>
            <Link href="/union/cases?bucket=active" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center hover:bg-slate-100">
              <p className="text-3xl font-bold text-slate-700">{unionCaseCounts.active}</p>
              <p className="text-sm font-medium text-slate-600 mt-1">Active</p>
            </Link>
            <Link href="/union/cases?bucket=pending" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center hover:bg-slate-100">
              <p className="text-3xl font-bold text-slate-700">{unionCaseCounts.pending}</p>
              <p className="text-sm font-medium text-slate-600 mt-1">Pending</p>
            </Link>
            <Link href="/union/cases?bucket=deadlines-approaching" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center hover:bg-amber-100">
              <p className="text-3xl font-bold text-amber-700">{unionCaseCounts.deadlinesApproaching}</p>
              <p className="text-sm font-medium text-amber-600 mt-1">Deadlines approaching</p>
            </Link>
            <Link href="/union/cases?bucket=overdue" className="rounded-lg border border-red-200 bg-red-50 p-4 text-center hover:bg-red-100">
              <p className="text-3xl font-bold text-red-700">{unionCaseCounts.overdue}</p>
              <p className="text-sm font-medium text-red-600 mt-1">Overdue</p>
            </Link>
            <Link href="/union/cases?bucket=recently-resolved" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center hover:bg-emerald-100">
              <p className="text-3xl font-bold text-emerald-700">{unionCaseCounts.recentlyResolved}</p>
              <p className="text-sm font-medium text-emerald-600 mt-1">Recently resolved</p>
            </Link>
          </div>
        </div>
      )}

      {/* Membership Governance — Community/Union; HOA doesn't have a
          distinct governance-status breakdown concept yet (no fake metrics). */}
      {widgets.governance && (
      <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600" />
          Membership Governance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-3xl font-bold text-emerald-700">{statusCounts["active"] ?? 0}</p>
            <p className="text-sm font-medium text-emerald-600 mt-1">Active</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-3xl font-bold text-amber-700">{statusCounts["inactive"] ?? 0}</p>
            <p className="text-sm font-medium text-amber-600 mt-1">Inactive</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-3xl font-bold text-red-700">{statusCounts["suspended"] ?? 0}</p>
            <p className="text-sm font-medium text-red-600 mt-1">Suspended</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
            <p className="text-3xl font-bold text-blue-700">{statusCounts["pending"] ?? 0}</p>
            <p className="text-sm font-medium text-blue-600 mt-1">Pending</p>
          </div>
        </div>
      </div>
      )}

      {/* HOA Property/Resident summary (PR #43) */}
      {widgets.hoaProperties && hoaPropertyStats && (
      <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Home className="h-5 w-5 text-emerald-600" />
          Properties
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link href="/hoa/properties" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center hover:bg-emerald-100">
            <p className="text-3xl font-bold text-emerald-700">{hoaPropertyStats.activeProperties}</p>
            <p className="text-sm font-medium text-emerald-600 mt-1">Active properties</p>
          </Link>
          <Link href="/hoa/properties?noActiveResident=true" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center hover:bg-amber-100">
            <p className="text-3xl font-bold text-amber-700">{hoaPropertyStats.propertiesWithNoContact}</p>
            <p className="text-sm font-medium text-amber-600 mt-1">No active owner/contact</p>
          </Link>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-center">
            <p className="text-3xl font-bold text-sky-700">{hoaPropertyStats.activeResidents}</p>
            <p className="text-sm font-medium text-sky-600 mt-1">Active residents</p>
          </div>
        </div>
        {hoaPropertyStats.recentProperties.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">Recently added</p>
            <ul className="divide-y divide-slate-100">
              {hoaPropertyStats.recentProperties.map((p) => (
                <li key={p.id} className="py-2 text-sm">
                  <Link href={`/hoa/properties/${p.id}`} className="font-medium text-emerald-700 hover:underline">
                    {p.displayName || (p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1)}
                  </Link>
                  <span className="ml-2 text-slate-500">{toDisplayDate(p.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      )}

      {/* HOA Violations summary */}
      {widgets.hoaViolations && hoaViolationStats && (
      <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-600" />
          Violations
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Link href="/hoa/violations" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center hover:bg-amber-100">
            <p className="text-3xl font-bold text-amber-700">{hoaViolationStats.openCount}</p>
            <p className="text-sm font-medium text-amber-600 mt-1">Open</p>
          </Link>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-3xl font-bold text-red-700">{hoaViolationStats.overdueCount}</p>
            <p className="text-sm font-medium text-red-600 mt-1 flex items-center justify-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> Past cure-by date</p>
          </div>
        </div>
        {hoaViolationStats.recentViolations.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">Recent activity</p>
            <ul className="divide-y divide-slate-100">
              {hoaViolationStats.recentViolations.map((v) => (
                <li key={v.id} className="py-2 text-sm">
                  <Link href={`/hoa/violations/${v.id}`} className="font-medium text-emerald-700 hover:underline">
                    {v.violationType}
                  </Link>
                  <span className="ml-2 text-slate-500">
                    {v.property.displayName || (v.property.unitLabel ? `${v.property.addressLine1}, ${v.property.unitLabel}` : v.property.addressLine1)} — {v.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      )}

      {/* HOA Architectural Requests summary */}
      {widgets.hoaArchitecturalRequests && hoaArchitecturalRequestStats && (
      <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-emerald-600" />
          Architectural Requests
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Link href="/hoa/architectural-requests?status=SUBMITTED" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center hover:bg-amber-100">
            <p className="text-3xl font-bold text-amber-700">{hoaArchitecturalRequestStats.submittedCount}</p>
            <p className="text-sm font-medium text-amber-600 mt-1">Submitted</p>
          </Link>
          <Link href="/hoa/architectural-requests?status=IN_REVIEW" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center hover:bg-amber-100">
            <p className="text-3xl font-bold text-amber-700">{hoaArchitecturalRequestStats.inReviewCount}</p>
            <p className="text-sm font-medium text-amber-600 mt-1">In review</p>
          </Link>
          <Link href="/hoa/architectural-requests?status=CHANGES_REQUESTED" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center hover:bg-slate-100">
            <p className="text-3xl font-bold text-slate-700">{hoaArchitecturalRequestStats.changesRequestedCount}</p>
            <p className="text-sm font-medium text-slate-600 mt-1">Changes requested</p>
          </Link>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-3xl font-bold text-emerald-700">{hoaArchitecturalRequestStats.approvedThisPeriodCount}</p>
            <p className="text-sm font-medium text-emerald-600 mt-1">Approved (30d)</p>
          </div>
        </div>
        {hoaArchitecturalRequestStats.recentRequests.length > 0 ? (
          <div className="mt-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">Recent activity</p>
            <ul className="divide-y divide-slate-100">
              {hoaArchitecturalRequestStats.recentRequests.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <Link href={`/hoa/architectural-requests/${r.id}`} className="font-medium text-emerald-700 hover:underline">
                    AR-{r.requestNumber} · {r.title}
                  </Link>
                  <span className="ml-2 text-slate-500">
                    {r.property.displayName || (r.property.unitLabel ? `${r.property.addressLine1}, ${r.property.unitLabel}` : r.property.addressLine1)} — {r.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      )}

      {/* Campaign Progress */}
      {widgets.fundraising && campaignProgress.length > 0 && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-emerald-600" />
            Campaign Progress
          </h3>
          <div className="space-y-4">
            {campaignProgress.map((c) => {
              const pct = c.goalCents > 0 ? Math.min(100, (c.raisedCents / c.goalCents) * 100) : 0;
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <Link href={`/campaigns/${c.id}`} className="font-medium text-slate-700 hover:text-emerald-700">{c.name}</Link>
                    <span className="text-slate-600">
                      {toCurrency(c.raisedCents)} / {c.goalCents > 0 ? toCurrency(c.goalCents) : "No goal"}
                      {c.goalCents > 0 && ` (${Math.round(pct)}%)`}
                    </span>
                  </div>
                  {c.goalCents > 0 && (
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Method Breakdown */}
      {widgets.paymentMethodBreakdown && duesPaymentMethods.length > 0 && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-600" />
            Payment Method Breakdown
          </h3>
          <div className="divide-y divide-slate-200">
            {duesPaymentMethods.map((row) => (
              <div key={row.method ?? "UNKNOWN"} className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-slate-700">
                  {PAYMENT_METHOD_LABELS[row.method ?? ""] ?? row.method ?? "Other"}
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  {toCurrencyDecimal(Number(row._sum.amount || 0))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActionDefs.map(({ href, label }) => {
            const c = colorMap.emerald;
            const Icon = quickActionIcon(label);
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-4 p-4 rounded-xl border-2 border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md transition-all group"
              >
                <div className={`rounded-xl p-3 ${c.iconBg}`}>
                  <Icon className={`h-6 w-6 ${c.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800">{label}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* Get Help — context-sensitive per vertical (Phase 9): a PTA user
          never sees Community fundraising instructions here, etc. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">Get Help</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {helpTopics.map((topic) => (
            <li key={topic.href}>
              <Link href={topic.href} className="block rounded-lg bg-slate-50 px-3 py-2 hover:bg-slate-100">
                <p className="text-sm font-semibold text-emerald-700">{topic.title}</p>
                <p className="text-xs text-slate-600">{topic.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* UNION-WEB-DASH: dues/financial administration, demoted to a
          secondary section below Case Center/Communications/Events per
          "Unestra Union is a membership and representation platform that
          can also handle dues -- not a dues-collection application with
          Union features attached." Never removed, never hidden from a
          holder of dues:read -- just no longer the dashboard's centerpiece.
          duesCollectionMethod is presentation-only (§11): it changes what
          copy renders here, never what data exists. */}
      {widgets.duesSecondary && canSeeDues && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-3">Dues &amp; Financial Administration</h3>
          {openingBalance?.duesCollectionMethod === "PAYROLL_DEDUCTION" ? (
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Dues Collection Method: Payroll Deduction</p>
              <p className="mt-1 text-xs text-slate-600">
                Members pay dues through employer payroll deduction, not through Unestra. Unestra does not
                track individual payroll-deducted payment status for this organization.
              </p>
            </div>
          ) : openingBalance?.duesCollectionMethod === "EXTERNAL" ? (
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Dues Collection Method: Collected Outside Unestra</p>
              <p className="mt-1 text-xs text-slate-600">Unestra is not the source of truth for this organization&apos;s dues payment status.</p>
            </div>
          ) : openingBalance?.duesCollectionMethod === "NONE" ? (
            <p className="text-sm text-slate-600">This organization does not collect dues.</p>
          ) : (
            <>
              {openingBalance?.duesCollectionMethod === "MIXED" && (
                <p className="mb-3 text-xs text-slate-600">Dues collection varies by member — some pay through Unestra, others through other means.</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label={`Total ${terminology.duesLabel}`} value={toCurrency(totalDuesCents)} subtext="All time" icon={DollarSign} color="emerald" href="/dues" />
                <StatCard label="Delinquent" value={delinquentCount} subtext={`Behind on ${terminology.duesLabel.toLowerCase()}`} icon={AlertCircle} color="red" href="/dues" />
                <StatCard label="Past Due" value={pastDueCount} subtext="Pending action" icon={AlertCircle} color="amber" href="/dues" />
                <StatCard label={`${terminology.duesLabel} Outstanding`} value={toCurrency(outstandingCents)} subtext="Unpaid charges" icon={DollarSign} color="amber" href="/dues" />
                <StatCard label={`${terminology.duesLabel} Collected (30d)`} value={toCurrency(dues30dCents)} subtext="Last 30 days" icon={DollarSign} color="emerald" href="/dues" />
              </div>
            </>
          )}
          <Link href="/settings/dues" className="mt-4 inline-block text-sm font-semibold text-emerald-700 hover:underline">
            Dues Setup →
          </Link>
        </div>
      )}

      {/* Recent Activity */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-3">Recent {terminology.member} Activity</h3>
          <ul className="space-y-2 text-sm">
            {recentTimelineEvents.length === 0 ? (
              <li className="text-slate-500">No recent activity.</li>
            ) : recentTimelineEvents.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/members/${row.memberId}`} className="font-semibold text-emerald-700 hover:underline">{row.title}</Link>
                <p className="text-slate-600">{row.member.firstName} {row.member.lastName} · {toDisplayDate(row.occurredAt)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-3">Upcoming {terminology.meetingLabel}s</h3>
          <ul className="space-y-2 text-sm">
            {upcomingMeetings.length === 0 ? (
              <li className="text-slate-500">{getEmptyStateCopy(vertical, "meetings")}</li>
            ) : upcomingMeetings.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <Link href={`/meetings/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.title}</Link>
                <p className="text-slate-600">{toDisplayDate(row.meetingDate)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
