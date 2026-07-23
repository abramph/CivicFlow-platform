import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listPtaCommittees } from "@/lib/labs/pta/committees";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { CreateCommitteeForm } from "@/components/labs/pta/CreateCommitteeForm";

export default async function PtaCommitteesPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:directory:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Committees" description="Not available for this organization." />
      </main>
    );
  }

  const committees = await listPtaCommittees(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title="Committees" description="Standing and ad hoc committees, their chairs, and their members." />

      <SectionCard title="Committees" description={`${committees.length} committee(s).`}>
        {committees.length === 0 ? (
          <EmptyState title="No committees yet" description={can("pta:committees:manage") ? "Create your first committee below." : undefined} />
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {committees.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <Link href={`/labs/pta/committees/${c.id}`} className="font-semibold text-emerald-700 hover:underline">
                    {c.name}
                  </Link>
                  {c.description ? <p className="text-slate-600">{c.description}</p> : null}
                </div>
                <div className="text-right text-slate-600">
                  <p>{c.members.length} member(s)</p>
                  <p className="text-xs">{c.chair ? `Chair: ${c.chair.name}` : "No chair set"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {can("pta:committees:manage") ? <CreateCommitteeForm /> : null}
      </SectionCard>
    </main>
  );
}
