import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import {
  buildMemberFilterQuery,
  buildMemberOrderBy,
  buildMemberWhere,
  hasActiveMemberFilters,
  memberSortOptions,
  parseMemberFilters,
} from "@/lib/member-filters";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { BulkInviteToAppButton } from "@/components/forms/BulkInviteToAppButton";
import { formatDate, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";
import { getOrganizationEntitlements } from "@/lib/plan-gate";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, can } = await requirePermission("members:read");
  const canExport = can("reports:export");
  const canInviteBulk = can("members:write");
  const resolvedSearchParams = await searchParams;
  const filters = parseMemberFilters(resolvedSearchParams);
  const where = buildMemberWhere(organizationId, filters);
  const exportCsvHref = `/api/members/export?${buildMemberFilterQuery(resolvedSearchParams, { format: "csv" })}`;
  const exportXlsxHref = `/api/members/export?${buildMemberFilterQuery(resolvedSearchParams, { format: "xlsx" })}`;
  const exportPdfHref = `/api/members/export?${buildMemberFilterQuery(resolvedSearchParams, { format: "pdf" })}`;
  const printHref = `/members/print?${buildMemberFilterQuery(resolvedSearchParams)}`;

  const [members, membershipCategories, duesCategories, totalMembers, activeMembers, entitlements] = await Promise.all([
    prisma.orgMember.findMany({
      where,
      orderBy: buildMemberOrderBy(filters.sort),
      include: {
        membershipCategory: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      take: 200,
    }),
    prisma.category.findMany({
      where: {
        organizationId,
        type: "MEMBERSHIP",
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.category.findMany({
      where: { organizationId, type: "DUES" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.orgMember.count({
      where: { organizationId },
    }),
    prisma.orgMember.count({
      where: {
        organizationId,
        membershipStatus: "active",
      },
    }),
    getOrganizationEntitlements(organizationId),
  ]);

  const isFiltered = hasActiveMemberFilters(filters);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Members"
        description="Desktop-style member directory with organization-scoped search, location filters, category filters, and quick access to each member profile."
        actions={[
          { href: "/members/new", label: "New Member", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Filtered Members" value={members.length} />
        <StatCard label="All Members" value={totalMembers} />
        <StatCard label="Active Members" value={activeMembers} />
        <StatCard label="Membership Categories" value={membershipCategories.length} />
      </div>

      <SectionCard title="Filter Members" description="Search by contact information and narrow the list by status, category, and location.">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" action="/members" method="get">
          <label className="space-y-2 text-sm font-medium text-slate-900 xl:col-span-2">
            <span>Search name, email, or phone</span>
            <input
              name="search"
              defaultValue={filters.search}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Membership status</span>
            <select
              name="membershipStatus"
              defaultValue={filters.membershipStatus}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="inactive">Inactive</option>
              <option value="deactivated">Deactivated</option>
              <option value="retired">Retired</option>
              <option value="suspended">Suspended</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Membership category</span>
            <select
              name="membershipCategoryId"
              defaultValue={filters.membershipCategoryId}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">All categories</option>
              {membershipCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Dues plan</span>
            <select name="duesCategoryId" defaultValue={filters.duesCategoryId} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200">
              <option value="">All dues plans</option>
              {duesCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>City</span>
            <input
              name="city"
              defaultValue={filters.city}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>State</span>
            <input
              name="state"
              defaultValue={filters.state}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>ZIP code</span>
            <input
              name="zipCode"
              defaultValue={filters.zipCode}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>County</span>
            <input
              name="county"
              defaultValue={filters.county}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Country</span>
            <input name="country" defaultValue={filters.country} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Gender</span>
            <input name="gender" defaultValue={filters.gender} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Age min</span>
            <input name="ageMin" type="number" min="0" defaultValue={filters.ageMin} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Age max</span>
            <input name="ageMax" type="number" min="0" defaultValue={filters.ageMax} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>DOB start</span>
            <input name="dobStart" type="date" defaultValue={filters.dobStart} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>DOB end</span>
            <input name="dobEnd" type="date" defaultValue={filters.dobEnd} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Join start</span>
            <input name="joinStart" type="date" defaultValue={filters.joinStart} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Join end</span>
            <input name="joinEnd" type="date" defaultValue={filters.joinEnd} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Has email</span>
            <select name="hasEmail" defaultValue={filters.hasEmail} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Has phone</span>
            <select name="hasPhone" defaultValue={filters.hasPhone} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Outstanding dues</span>
            <select name="hasOutstandingDues" defaultValue={filters.hasOutstandingDues} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"><option value="">Any</option><option value="yes">Yes</option></select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Delinquency</span>
            <select name="delinquency" defaultValue={filters.delinquency} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200">
              <option value="">Any</option>
              <option value="delinquent">Delinquent only</option>
              <option value="not-delinquent">Not delinquent</option>
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Sort by</span>
            <select
              name="sort"
              defaultValue={filters.sort}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            >
              {memberSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-3 xl:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Apply Filters
            </button>
            <Link
              href="/members"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Reset Filters
            </Link>
            {canExport ? (
              <>
                <Link href={exportCsvHref} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                  Export CSV
                </Link>
                <Link href={exportXlsxHref} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                  Export Excel/XLSX
                </Link>
                {entitlements.features.pdfExport ? (
                  <Link href={exportPdfHref} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                    Export PDF
                  </Link>
                ) : (
                  <span
                    role="note"
                    aria-label="Export PDF — not included in your current plan. Upgrade in Billing Settings."
                    title="Not included in your current plan — upgrade in Billing Settings"
                    className="cursor-not-allowed rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-400"
                  >
                    Export PDF (upgrade required)
                  </span>
                )}
              </>
            ) : null}
            {canInviteBulk ? <BulkInviteToAppButton filters={filters} /> : null}
            <Link
              href={printHref}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Print View
            </Link>
            {isFiltered ? (
              <p className="text-sm text-slate-700">Filtered results are scoped to your current organization only.</p>
            ) : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Member Directory" description="Select a member to review profile details, dues history, contribution history, and quick actions.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Email / Phone</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-600" colSpan={6}>
                    No members matched the current filters.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-950">
                      <Link
                        href={`/members/${member.id}`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {formatPersonName(member)}
                      </Link>
                      {member.householdName ? (
                        <p className="mt-1 text-xs text-slate-700">{member.householdName}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {formatText(member.membershipCategory?.name, "No category")}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {[member.city, member.state, member.zipCode].filter(Boolean).join(", ") || "No location"}
                      {member.county ? <p className="text-xs text-slate-700">{member.county} County</p> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      <p>{formatText(member.email, "No email")}</p>
                      <p className="text-xs text-slate-700">{formatText(member.phone, "No phone")}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatDate(member.joinDate)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(member.membershipStatus)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
