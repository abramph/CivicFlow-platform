import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { listPtaHouseholds } from "@/lib/labs/pta/households";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";

export default async function PtaHouseholdsPage() {
  const { organizationId, access } = await getPtaPageGate("pta:directory:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Household Directory" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  const households = profile ? await listPtaHouseholds(organizationId, { schoolYear: profile.currentSchoolYear }) : [];

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Household Directory"
        description={profile ? `Households enrolled for ${profile.currentSchoolYear}.` : "Configure your PTA profile first at /labs/pta/settings."}
      />
      <SectionCard title="Households" description={`${households.length} household(s).`}>
        {households.length === 0 ? (
          <EmptyState title="No households yet" description="Households are added by an officer with the 'manage households' permission." />
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
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold text-slate-900">{h.displayName}</td>
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
      <p className="text-sm text-slate-600">
        <Link href="/labs/pta/settings" className="text-emerald-700 hover:underline">PTA settings</Link>
        {" · "}
        <Link href="/labs/pta/dashboard" className="text-emerald-700 hover:underline">Dashboard</Link>
      </p>
    </main>
  );
}
