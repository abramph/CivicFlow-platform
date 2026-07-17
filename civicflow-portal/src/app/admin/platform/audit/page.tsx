import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { listAuditEvents, getAuditEventDetail } from "@/lib/platform-operations/audit";
import { Breadcrumbs, Pagination, EmptyState } from "@/components/admin/OperationsUI";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const get = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";

  const action = get("action");
  const actorEmail = get("actorEmail");
  const organizationId = get("organizationId");
  const startDate = get("startDate");
  const endDate = get("endDate");
  const includeOrgEvents = get("includeOrgEvents") === "1";
  const expandId = get("expand");
  const page = Number(get("page")) || 1;

  const [result, detail] = await Promise.all([
    listAuditEvents(
      {
        platformOnly: !organizationId && !includeOrgEvents,
        organizationId: organizationId || undefined,
        action: action || undefined,
        actorEmail: actorEmail || undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      },
      { page, pageSize: 25 }
    ),
    expandId ? getAuditEventDetail(expandId) : Promise.resolve(null),
  ]);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Audit" }]} />
      <PageHeader
        title="Platform Audit"
        description="Platform-level events by default (organizationId is null). Secrets, tokens, and other sensitive fields are redacted before display — see docs/aph-operations-center.md for the redaction rule."
      />

      <SectionCard title="Filter">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" action="/admin/platform/audit" method="get">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Event type contains</span>
            <input name="action" defaultValue={action} placeholder="e.g. platform_access" className={inputClass} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Actor email contains</span>
            <input name="actorEmail" defaultValue={actorEmail} className={inputClass} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Organization ID</span>
            <input name="organizationId" defaultValue={organizationId} placeholder="Leave blank for platform-only" className={inputClass} />
          </label>
          <label className="flex items-end gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" name="includeOrgEvents" value="1" defaultChecked={includeOrgEvents} className="h-4 w-4 rounded border-slate-300" />
            <span>Include organization-scoped events</span>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>From date</span>
            <input type="date" name="startDate" defaultValue={startDate} className={inputClass} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>To date</span>
            <input type="date" name="endDate" defaultValue={endDate} className={inputClass} />
          </label>
          <div className="flex items-end gap-2 xl:col-span-2">
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Apply filters
            </button>
            <Link href="/admin/platform/audit" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Clear
            </Link>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Success/failure and correlation-ID filters are not available — AuditEvent has no such fields in the current schema.
        </p>
      </SectionCard>

      <SectionCard title={`${result.items.length} of ${result.pagination.totalCount} event(s)`}>
        {result.items.length === 0 ? (
          <EmptyState title="No audit events match these filters" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {result.items.map((event) => {
              const isExpanded = expandId === event.id;
              const expandHref = `/admin/platform/audit?${new URLSearchParams({
                ...(action ? { action } : {}),
                ...(actorEmail ? { actorEmail } : {}),
                ...(organizationId ? { organizationId } : {}),
                expand: isExpanded ? "" : event.id,
              }).toString()}`;
              return (
                <li key={event.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{event.action}</p>
                      <p className="text-slate-600">
                        {event.actorEmail ?? "system"} · {event.resource}
                        {event.resourceId ? ` (${event.resourceId})` : ""} · {event.organizationId ? "org-scoped" : "platform"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500">{formatDateTime(event.createdAt)}</span>
                      <Link href={expandHref} className="font-semibold text-emerald-700 hover:underline">
                        {isExpanded ? "Hide detail" : "View detail"}
                      </Link>
                    </div>
                  </div>
                  {isExpanded && detail ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs text-slate-600">IP address: {detail.ipAddress ?? "Not recorded"}</p>
                      <div>
                        <p className="text-xs font-semibold text-slate-700">Before (redacted)</p>
                        <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-xs text-slate-800">{JSON.stringify(detail.before, null, 2) ?? "null"}</pre>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-700">After (redacted)</p>
                        <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-xs text-slate-800">{JSON.stringify(detail.after, null, 2) ?? "null"}</pre>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4">
          <Pagination
            basePath="/admin/platform/audit"
            searchParams={{ action, actorEmail, organizationId, startDate, endDate, includeOrgEvents: includeOrgEvents ? "1" : undefined }}
            page={result.pagination.page}
            totalPages={result.pagination.totalPages}
          />
        </div>
      </SectionCard>
    </main>
  );
}
