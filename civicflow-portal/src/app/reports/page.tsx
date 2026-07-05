import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { ReportsManager } from "@/components/forms/ReportsManager";
import { buildReport, isReportType } from "@/lib/reports/report-builder";
import { formatDate, formatDateTime } from "@/lib/formatting";

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
  const { organizationId, can } = await requirePermission("reports:read");
  const canExport = can("reports:export");
  const canSend = can("reports:export") && can("communications:write");
  const resolvedSearchParams = await searchParams;
  const reportType = getValue(resolvedSearchParams.reportType);
  const startDate = getValue(resolvedSearchParams.startDate);
  const endDate = getValue(resolvedSearchParams.endDate);

  const [rows, members, categories, campaigns, events, meetings, previewReport] = await Promise.all([
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
  ]);
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
