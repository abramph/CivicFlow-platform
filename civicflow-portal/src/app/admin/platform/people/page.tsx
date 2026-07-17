import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDate, formatEnumLabel } from "@/lib/formatting";
import { listPeople, findDuplicateLookingAccounts } from "@/lib/platform-operations/people";
import { Breadcrumbs, Pagination, StatusPill, EmptyState } from "@/components/admin/OperationsUI";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export default async function PlatformPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const get = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";

  const search = get("search");
  const onlyMultiOrg = get("onlyMultiOrg") === "1";
  const onlyNoActiveMembership = get("onlyNoActiveMembership") === "1";
  const page = Number(get("page")) || 1;

  const [result, duplicateGroups] = await Promise.all([
    listPeople({ search: search || undefined, onlyMultiOrg, onlyNoActiveMembership }, { page, pageSize: 25 }),
    findDuplicateLookingAccounts(),
  ]);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "People" }]} />
      <PageHeader title="People" description={`${result.pagination.totalCount} user(s) across the platform.`} />

      {duplicateGroups.length > 0 ? (
        <SectionCard
          title="Possible duplicate accounts"
          description="Grouped by normalized (lowercased, trimmed) email — informational only, no automatic merging is performed."
        >
          <ul className="space-y-1 text-sm text-slate-800">
            {duplicateGroups.map((g) => (
              <li key={g.normalizedEmail}>
                <span className="font-semibold">{g.normalizedEmail}</span> — {g.userIds.length} accounts
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard title="Filter">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" action="/admin/platform/people" method="get">
          <label className="space-y-2 text-sm font-medium text-slate-900 xl:col-span-2">
            <span>Search name or email</span>
            <input name="search" defaultValue={search} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" name="onlyMultiOrg" value="1" defaultChecked={onlyMultiOrg} className="h-4 w-4 rounded border-slate-300" />
            <span>Multi-organization users only</span>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" name="onlyNoActiveMembership" value="1" defaultChecked={onlyNoActiveMembership} className="h-4 w-4 rounded border-slate-300" />
            <span>No active membership only</span>
          </label>
          <div className="flex items-end gap-2 xl:col-span-4">
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Apply filters
            </button>
            <Link href="/admin/platform/people" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Clear
            </Link>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`${result.items.length} of ${result.pagination.totalCount} shown`}>
        {result.items.length === 0 ? (
          <EmptyState title="No users match these filters" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {result.items.map((person) => (
              <li key={person.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {person.displayName ?? person.email}
                        {person.hasPlatformAccess ? (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Platform access</span>
                        ) : null}
                      </p>
                      <p className="text-slate-600">{person.email}</p>
                    </div>
                    <div className="flex items-center gap-3 text-slate-700">
                      <span>{person.membershipCount} org{person.membershipCount === 1 ? "" : "s"}</span>
                      {!person.emailVerified ? <StatusPill status="attention" label="Unverified email" /> : null}
                      {!person.mfaEnabled ? <StatusPill status="warning" label="No MFA" /> : null}
                    </div>
                  </summary>
                  <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="font-medium text-slate-700">Created</p>
                      <p className="text-slate-900">{formatDate(person.createdAt)}</p>
                    </div>
                    <div>
                      <p className="font-medium text-slate-700">Last sign-in</p>
                      <p className="text-slate-900">Not tracked</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="font-medium text-slate-700">Organization memberships</p>
                      {person.memberships.length === 0 ? (
                        <p className="text-slate-600">No active memberships</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {person.memberships.map((m) => (
                            <li key={m.organizationId}>
                              <Link href={`/admin/platform/organizations/${m.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                                {m.organizationName}
                              </Link>{" "}
                              — {formatEnumLabel(m.role)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <Pagination
            basePath="/admin/platform/people"
            searchParams={{ search, onlyMultiOrg: onlyMultiOrg ? "1" : undefined, onlyNoActiveMembership: onlyNoActiveMembership ? "1" : undefined }}
            page={result.pagination.page}
            totalPages={result.pagination.totalPages}
          />
        </div>
      </SectionCard>
    </main>
  );
}
