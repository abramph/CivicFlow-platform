import {
  buildMemberOrderBy,
  buildMemberWhere,
  calculateAge,
  calculateMemberOutstandingDues,
  describeMemberFilters,
  memberExportInclude,
  parseMemberFilters,
} from "@/lib/member-filters";
import { requirePermission } from "@/lib/auth-guards";
import { PrintButton } from "@/components/app/PrintButton";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

const PRINT_LIMIT = 5000;

export default async function MembersPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("members:read");
  const resolvedSearchParams = await searchParams;
  const filters = parseMemberFilters(resolvedSearchParams);
  const where = buildMemberWhere(organizationId, filters);
  const [organization, count, members] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.orgMember.count({ where }),
    prisma.orgMember.findMany({
      where,
      orderBy: buildMemberOrderBy(filters.sort),
      include: memberExportInclude,
      take: PRINT_LIMIT,
    }),
  ]);

  return (
    <main className="bg-white p-6 text-slate-950 print:p-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
        }
      `}</style>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-300 pb-4">
        <div>
          <h1 className="text-2xl font-bold">{organization?.name ?? "Unestra Organization"}</h1>
          <p className="mt-1 text-sm font-semibold">Filtered Member List</p>
          <p className="mt-1 text-xs text-slate-700">Generated {new Date().toLocaleString("en-US")}</p>
          <p className="mt-2 max-w-5xl text-xs text-slate-700">Filters: {describeMemberFilters(filters)}</p>
          {count > PRINT_LIMIT ? (
            <p className="mt-2 text-sm font-semibold text-red-700">
              Showing first {PRINT_LIMIT} of {count} matching members. Narrow filters for a complete print view.
            </p>
          ) : null}
        </div>
        <PrintButton />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-slate-400 bg-slate-100 text-left">
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Age</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Phone</th>
              <th className="px-2 py-2">City</th>
              <th className="px-2 py-2">State</th>
              <th className="px-2 py-2">ZIP</th>
              <th className="px-2 py-2">Join Date</th>
              <th className="px-2 py-2">Delinquent</th>
              <th className="px-2 py-2">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-2 py-5 text-center text-slate-700">No members matched the current filters.</td>
              </tr>
            ) : members.map((member) => (
              <tr key={member.id} className="border-b border-slate-200">
                <td className="px-2 py-2 font-semibold">{formatPersonName(member)}</td>
                <td className="px-2 py-2">{formatEnumLabel(member.membershipStatus)}</td>
                <td className="px-2 py-2">{formatText(member.membershipCategory?.name, "")}</td>
                <td className="px-2 py-2">{calculateAge(member.dateOfBirth)}</td>
                <td className="px-2 py-2">{formatText(member.email, "")}</td>
                <td className="px-2 py-2">{formatText(member.phone, "")}</td>
                <td className="px-2 py-2">{formatText(member.city, "")}</td>
                <td className="px-2 py-2">{formatText(member.state, "")}</td>
                <td className="px-2 py-2">{formatText(member.zipCode, "")}</td>
                <td className="px-2 py-2">{formatDate(member.joinDate, "")}</td>
                <td className="px-2 py-2">{member.isDelinquent ? "Yes" : "No"}</td>
                <td className="px-2 py-2">{formatCurrency(calculateMemberOutstandingDues(member))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
