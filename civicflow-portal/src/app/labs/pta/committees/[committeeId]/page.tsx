import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaCommittee } from "@/lib/labs/pta/committees";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { AddCommitteeMemberForm } from "@/components/labs/pta/AddCommitteeMemberForm";
import { SetCommitteeChairForm } from "@/components/labs/pta/SetCommitteeChairForm";
import { ConfirmActionButton } from "@/components/labs/pta/ConfirmActionButton";

export default async function PtaCommitteeDetailPage({ params }: { params: Promise<{ committeeId: string }> }) {
  const { committeeId } = await params;
  const { organizationId, access, can } = await getPtaPageGate("pta:directory:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Committee" description="Not available for this organization." />
      </main>
    );
  }

  const committee = await getPtaCommittee(organizationId, committeeId);
  const canManage = can("pta:committees:manage");

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/committees", label: "Committees" }, { label: committee.name }]} />
      <PageHeader title={committee.name} description={committee.description ?? undefined} />

      {canManage ? (
        <SectionCard title="Chair">
          <SetCommitteeChairForm
            committeeId={committee.id}
            members={committee.members.map((m) => ({ householdAdultId: m.householdAdultId, name: m.householdAdult.name }))}
            currentChairAdultId={committee.chairAdultId}
          />
        </SectionCard>
      ) : (
        <p className="text-sm text-slate-700">Chair: {committee.chair?.name ?? "None set"}</p>
      )}

      <SectionCard title="Members" description={`${committee.members.length} member(s).`}>
        {committee.members.length === 0 ? (
          <EmptyState title="No members yet" description={canManage ? "Search for a parent below to add them." : undefined} />
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {committee.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {m.householdAdult.name}
                  {committee.chairAdultId === m.householdAdultId ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Chair</span> : null}
                </span>
                {canManage ? (
                  <ConfirmActionButton
                    label="Remove"
                    confirmLabel="Confirm remove"
                    method="DELETE"
                    url={`/api/labs/pta/committees/${committee.id}/members/${m.householdAdultId}`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? <AddCommitteeMemberForm committeeId={committee.id} /> : null}
      </SectionCard>
    </main>
  );
}
