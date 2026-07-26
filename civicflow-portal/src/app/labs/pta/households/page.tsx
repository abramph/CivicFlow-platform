import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { listPtaHouseholds } from "@/lib/labs/pta/households";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function PtaHouseholdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, access, can } = await getPtaPageGate("pta:directory:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Household Directory" description="Not available for this organization." />
      </main>
    );
  }

  const params = await searchParams;
  const search = getValue(params.search);
  const status = getValue(params.status);

  const profile = await getPtaProfile(organizationId);
  const households = profile
    ? await listPtaHouseholds(organizationId, { schoolYear: profile.currentSchoolYear, search: search || undefined, status: status || undefined })
    : [];

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Household Directory"
        description={profile ? `Households enrolled for ${profile.currentSchoolYear}.` : "Configure your PTA profile first at Settings."}
        actions={can("pta:households:manage") ? [{ href: "/labs/pta/households/new", label: "Add household", tone: "primary" }] : []}
      />

      {profile ? (
        <SectionCard title="Households" description={`${households.length} household(s) matching your filters.`}>
          <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Search</span>
              <input
                type="text"
                name="search"
                defaultValue={search}
                placeholder="Household, parent, or student name"
                className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Status</span>
              <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Filter
            </button>
            {search || status ? (
              <Link href="/labs/pta/households" className="text-sm font-semibold text-emerald-700 hover:underline">
                Clear
              </Link>
            ) : null}
          </form>

          {households.length === 0 ? (
            <EmptyState
              title={search || status ? "No households match your filters" : "No households yet"}
              description={
                search || status
                  ? "Try a different search term or clear the filters."
                  : can("pta:households:manage")
                    ? "Add your first household to get started."
                    : "Households are added by an officer with the 'manage households' permission."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Household</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Adults</th>
                    <th className="px-4 py-3">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {households.map((h) => (
                    <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-emerald-700">
                        <Link href={`/labs/pta/households/${h.id}`} className="hover:underline">
                          {h.displayName}
                        </Link>
                      </td>
                      <td className="px-4 py-3"><StatusPill status={h.status.toLowerCase()} label={h.status} /></td>
                      <td className="px-4 py-3 text-slate-700">{h.adults.length}</td>
                      <td className="px-4 py-3 text-slate-700">{h.students.filter((s) => s.status === "ACTIVE").length} active</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <EmptyState title="Set up your PTA profile first" description="Configure your school/PTA name and current school year at Settings before adding households." />
      )}
    </main>
  );
}
