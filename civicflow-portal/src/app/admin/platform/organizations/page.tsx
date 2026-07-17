import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDate, formatEnumLabel } from "@/lib/formatting";
import { listOrganizations, type OrganizationSortField } from "@/lib/platform-operations/organizations";
import { Breadcrumbs, Pagination, StatusPill, EmptyState } from "@/components/admin/OperationsUI";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

const SORT_FIELDS: OrganizationSortField[] = ["name", "createdAt", "plan", "status"];

export default async function PlatformOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const get = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";

  const search = get("search");
  const status = get("status");
  const plan = get("plan");
  const organizationType = get("organizationType");
  const subscriptionStatus = get("subscriptionStatus");
  const sortField = (SORT_FIELDS.includes(get("sort") as OrganizationSortField) ? get("sort") : "createdAt") as OrganizationSortField;
  const page = Number(get("page")) || 1;

  const result = await listOrganizations(
    {
      search: search || undefined,
      status: status || undefined,
      plan: plan || undefined,
      organizationType: organizationType || undefined,
      subscriptionStatus: subscriptionStatus || undefined,
    },
    { page, pageSize: 25 },
    { field: sortField, direction: "desc" }
  );

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Organizations" }]} />
      <PageHeader title="Organizations" description={`${result.pagination.totalCount} organization(s) on the platform.`} />

      <SectionCard title="Filter">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" action="/admin/platform/organizations" method="get">
          <label className="space-y-2 text-sm font-medium text-slate-900 xl:col-span-2">
            <span>Search name, slug, or ID</span>
            <input name="search" defaultValue={search} className={inputClass} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select name="status" defaultValue={status} className={inputClass}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Plan</span>
            <select name="plan" defaultValue={plan} className={inputClass}>
              <option value="">All plans</option>
              <option value="free">Free</option>
              <option value="essential">Essential</option>
              <option value="elite">Elite</option>
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Subscription status</span>
            <select name="subscriptionStatus" defaultValue={subscriptionStatus} className={inputClass}>
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="trialing">Trialing</option>
              <option value="past_due">Past due</option>
              <option value="cancelled">Cancelled</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <div className="flex items-end gap-2 xl:col-span-5">
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Apply filters
            </button>
            <Link href="/admin/platform/organizations" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Clear
            </Link>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`${result.items.length} of ${result.pagination.totalCount} shown`}>
        {result.items.length === 0 ? (
          <EmptyState title="No organizations match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">Organization</th>
                  <th scope="col" className="px-4 py-3">Plan</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Subscription</th>
                  <th scope="col" className="px-4 py-3">Members</th>
                  <th scope="col" className="px-4 py-3">SMS</th>
                  <th scope="col" className="px-4 py-3">Health</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((org) => (
                  <tr key={org.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/platform/organizations/${org.id}`} className="font-semibold text-emerald-700 hover:underline">
                        {org.name}
                      </Link>
                      <p className="text-xs text-slate-600">{org.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(org.plan)}</td>
                    <td className="px-4 py-3"><StatusPill status={org.status} /></td>
                    <td className="px-4 py-3 text-slate-900">{org.latestSubscriptionStatus ? formatEnumLabel(org.latestSubscriptionStatus) : "None"}</td>
                    <td className="px-4 py-3 text-slate-900">{org.activeMemberCount}</td>
                    <td className="px-4 py-3 text-slate-900">{org.smsAddOnActive ? "Enabled" : "—"}</td>
                    <td className="px-4 py-3"><StatusPill status={org.health} /></td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(org.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <Pagination
            basePath="/admin/platform/organizations"
            searchParams={{ search, status, plan, subscriptionStatus }}
            page={result.pagination.page}
            totalPages={result.pagination.totalPages}
          />
        </div>
      </SectionCard>
    </main>
  );
}
