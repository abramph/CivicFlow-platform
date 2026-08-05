import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { ReportsManager } from "@/components/forms/ReportsManager";
import { buildReport, isReportType, reportTitle, MAX_REPORT_ROWS } from "@/lib/reports/report-builder";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { getOrganizationEntitlements } from "@/lib/plan-gate";
import { getVerticalTerminology } from "@/lib/vertical-terminology";

const INACTIVE_STATUSES = ["inactive", "deactivated", "suspended", "pending", "retired"] as const;

const ROSTER_CARDS = [
  { reportType: "ACTIVE_MEMBER_ROSTER", label: "Active" },
  { reportType: "DELINQUENT_MEMBER_ROSTER", label: "Delinquent" },
  { reportType: "INACTIVE_MEMBER_ROSTER", label: "Inactive" },
  { reportType: "TERMINATED_MEMBER_ROSTER", label: "Terminated" },
] as const;

// Groups every other report type into browsable categories -- additive to the
// existing flat dropdown below (kept as-is for anyone who prefers it), not a
// replacement. No live counts here (unlike the roster cards above): 18 extra
// count queries on every page load isn't worth it for numbers most people
// won't need before clicking through.
const REPORT_CATEGORIES = [
  {
    title: "Financial",
    reportTypes: ["GENERAL_FINANCIAL", "CONTRIBUTIONS", "CAMPAIGNS", "MONTHLY_DUES_COLLECTION", "DUES_PAYMENT_DETAIL", "OUTSTANDING_DUES", "CAMPAIGN_PAYERS", "EXPENDITURES", "PAYMENT_RECONCILIATION", "DELINQUENT_MEMBERS"],
  },
  {
    title: "Membership & Demographics",
    reportTypes: ["DUES_CURRENT_MEMBERS", "FULL_YEAR_DUES_PAID", "MEMBER_LOCATION", "MEMBER_DEMOGRAPHICS"],
  },
  {
    title: "Events & Attendance",
    reportTypes: ["EVENTS", "ATTENDANCE", "MEETING_ATTENDANCE"],
  },
  {
    title: "Communications",
    reportTypes: ["COMMUNICATIONS"],
  },
] as const;

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function dateInputValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function reportFilters(params: Record<string, string | string[] | undefined>) {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!["reportType", "startDate", "endDate"].includes(key)) {
      const resolved = getValue(value);
      if (resolved) filters[key] = resolved;
    }
  }
  return filters;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, can, session } = await requirePermission("reports:read");
  const terminology = getVerticalTerminology(session.primaryVertical ?? "COMMUNITY");
  const canExport = can("reports:export");
  const canSend = can("reports:export") && can("communications:write");
  const resolvedSearchParams = await searchParams;
  const reportType = getValue(resolvedSearchParams.reportType);
  const startDate = getValue(resolvedSearchParams.startDate);
  const endDate = getValue(resolvedSearchParams.endDate);

  const [rows, members, categories, campaigns, events, meetings, previewReport, entitlements, activeCount, delinquentCount, inactiveCount, terminatedCount] = await Promise.all([
    prisma.reportExport.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    }),
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, preferredName: true, email: true },
      take: 5000,
    }),
    prisma.category.findMany({
      where: { organizationId, type: "MEMBERSHIP", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 500,
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: { startAt: "desc" },
      select: { id: true, title: true, startAt: true },
      take: 500,
    }),
    prisma.meeting.findMany({
      where: { organizationId },
      orderBy: { meetingDate: "desc" },
      select: { id: true, title: true, meetingDate: true },
      take: 500,
    }),
    isReportType(reportType)
      ? buildReport({
          organizationId,
          reportType,
          startDate,
          endDate,
          filters: reportFilters(resolvedSearchParams),
          limit: 50,
        }).catch((error) => ({
          title: "Report preview error",
          columns: ["Error"],
          rows: [{ Error: error instanceof Error ? error.message : "Unable to build report preview." }],
          summary: [],
          metadata: { reportType, generatedAt: new Date().toISOString(), startDate: null, endDate: null, filters: {} },
        }))
      : Promise.resolve(null),
    getOrganizationEntitlements(organizationId),
    prisma.orgMember.count({ where: { organizationId, membershipStatus: "active", isDelinquent: false } }),
    prisma.orgMember.count({ where: { organizationId, membershipStatus: "active", isDelinquent: true } }),
    prisma.orgMember.count({ where: { organizationId, membershipStatus: { in: [...INACTIVE_STATUSES] } } }),
    prisma.orgMember.count({ where: { organizationId, membershipStatus: "terminated" } }),
  ]);
  const rosterCounts: Record<(typeof ROSTER_CARDS)[number]["reportType"], number> = {
    ACTIVE_MEMBER_ROSTER: activeCount,
    DELINQUENT_MEMBER_ROSTER: delinquentCount,
    INACTIVE_MEMBER_ROSTER: inactiveCount,
    TERMINATED_MEMBER_ROSTER: terminatedCount,
  };
  const reportAttachments = rows.length
    ? await prisma.attachment.findMany({
        where: {
          organizationId,
          entityType: "REPORT_EXPORT",
          entityId: { in: rows.map((row) => row.id) },
          deletedAt: null,
        },
        orderBy: { uploadedAt: "desc" },
      })
    : [];
  const attachmentByReportId = new Map(reportAttachments.map((attachment) => [attachment.entityId, attachment]));

  return (
    <main className="space-y-6">
      <PageHeader
        title="Report Center"
        description="Preview reports, download CSV/XLSX/PDF exports, or email generated reports to members and external recipients."
        actions={[{ href: "/dashboard", label: "Back to Dashboard" }]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Report Queue" value={rows.length} />
        <StatCard label="Queued / Processing" value={rows.filter((row) => ["QUEUED", "PROCESSING"].includes(row.status)).length} />
        <StatCard label="Completed" value={rows.filter((row) => row.status === "COMPLETED").length} />
      </div>

      <SectionCard title={`${terminology.memberPlural} Rosters`} description={`Ready-made ${terminology.memberPlural.toLowerCase()} lists by status, with print/PDF/CSV export below.`}>
        <div className="grid gap-4 md:grid-cols-4">
          {ROSTER_CARDS.map((card) => (
            <Link
              key={card.reportType}
              href={`/reports?reportType=${card.reportType}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-400 hover:bg-emerald-50"
            >
              <p className="text-sm font-medium text-slate-600">
                {card.label} {terminology.memberPlural}
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{rosterCounts[card.reportType]}</p>
              {rosterCounts[card.reportType] > MAX_REPORT_ROWS ? (
                <p className="mt-1 text-xs text-amber-700">Report below shows the first {MAX_REPORT_ROWS.toLocaleString()}.</p>
              ) : null}
              <p className="mt-1 text-xs text-emerald-700">View report &rarr;</p>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Report Categories" description="Browse the full report catalog by category, or use the report type dropdown below directly.">
        <div className="space-y-5">
          {REPORT_CATEGORIES.map((category) => (
            <div key={category.title}>
              <h3 className="text-sm font-semibold text-slate-900">{category.title}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {category.reportTypes.map((type) => (
                  <Link
                    key={type}
                    href={`/reports?reportType=${type}`}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                  >
                    {reportTitle(type)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Generate, Export, or Send" description="Report output is generated from organization-scoped data and preserves the selected filters.">
        <ReportsManager
          rows={rows.map((row) => ({
            ...row,
            requestedAt: row.requestedAt.toISOString(),
            completedAt: row.completedAt?.toISOString() ?? null,
            attachmentId: attachmentByReportId.get(row.id)?.id ?? null,
          }))}
          members={members.map((member) => ({
            id: member.id,
            label: `${member.preferredName || member.firstName} ${member.lastName}${member.email ? ` (${member.email})` : ""}`,
          }))}
          categories={categories.map((category) => ({ id: category.id, label: category.name }))}
          campaigns={campaigns.map((campaign) => ({ id: campaign.id, label: campaign.name }))}
          events={events.map((event) => ({ id: event.id, label: `${event.title}${event.startAt ? ` - ${formatDate(event.startAt)}` : ""}` }))}
          meetings={meetings.map((meeting) => ({ id: meeting.id, label: `${meeting.title} - ${formatDate(meeting.meetingDate)}` }))}
          initial={{ reportType: isReportType(reportType) ? reportType : "GENERAL_FINANCIAL", startDate: dateInputValue(startDate), endDate: dateInputValue(endDate) }}
          canExport={canExport}
          canSend={canSend}
          pdfExportEnabled={entitlements.features.pdfExport}
        />
      </SectionCard>

      {previewReport ? (
        <SectionCard title="Preview" description={`${previewReport.title} generated ${formatDateTime(previewReport.metadata.generatedAt)}. Showing up to 50 rows.`}>
          {previewReport.summary.length ? (
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              {previewReport.summary.map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-600">{item.label}</div>
                  <div className="text-sm font-semibold text-slate-950">{item.value}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>{previewReport.columns.map((column) => <th key={column} className="px-4 py-3">{column}</th>)}</tr>
              </thead>
              <tbody>
                {previewReport.rows.length === 0 ? (
                  <tr><td colSpan={previewReport.columns.length || 1} className="px-4 py-6 text-center text-slate-600">No preview rows matched.</td></tr>
                ) : (previewReport.rows as Array<Record<string, unknown>>).map((row, index) => (
                  <tr key={index} className="border-t border-slate-100">
                    {previewReport.columns.map((column) => <td key={column} className="px-4 py-3 text-slate-900">{String(row[column] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}
    </main>
  );
}
