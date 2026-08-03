import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaCommittee } from "@/lib/labs/pta/committees";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { AddCommitteeMemberForm } from "@/components/labs/pta/AddCommitteeMemberForm";
import { SetCommitteeChairForm } from "@/components/labs/pta/SetCommitteeChairForm";
import { ConfirmActionButton } from "@/components/labs/pta/ConfirmActionButton";

/** STAFF already holds events:write + pta:events:manage + pta:volunteers:manage
 * (see rbac.ts) -- rather than building a separate committee-scoped
 * permission mechanism, a chair/co-chair gets real write access by being
 * invited as an officer through the existing, already-tested Users & Roles
 * flow. This link just pre-fills that form; it grants nothing itself. */
function inviteAsOfficerHref(adult: { name: string; email: string | null }) {
  const params = new URLSearchParams({ displayName: adult.name, role: "STAFF" });
  if (adult.email) params.set("email", adult.email);
  return `/settings/users?${params.toString()}`;
}

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
  const canInviteOfficers = can("users:manage");
  const memberOptions = committee.members.map((m) => ({ householdAdultId: m.householdAdultId, name: m.householdAdult.name }));

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/committees", label: "Committees" }, { label: committee.name }]} />
      <PageHeader title={committee.name} description={committee.description ?? undefined} />

      <SectionCard title="Chair & co-chair" description="A chair or co-chair only gains real event/volunteer-opportunity access once invited as an officer below — being marked chair here is a directory role, not a permission grant.">
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Chair</p>
            {canManage ? (
              <SetCommitteeChairForm committeeId={committee.id} members={memberOptions} currentChairAdultId={committee.chairAdultId} field="chairAdultId" label="chair" />
            ) : (
              <p className="text-sm text-slate-700">{committee.chair?.name ?? "None set"}</p>
            )}
            {canInviteOfficers && committee.chair ? (
              <Link href={inviteAsOfficerHref(committee.chair)} className="mt-1 inline-block text-xs font-semibold text-emerald-700 hover:underline">
                Invite {committee.chair.name} as a STAFF officer →
              </Link>
            ) : null}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Co-chair</p>
            {canManage ? (
              <SetCommitteeChairForm committeeId={committee.id} members={memberOptions} currentChairAdultId={committee.coChairAdultId} field="coChairAdultId" label="co-chair" />
            ) : (
              <p className="text-sm text-slate-700">{committee.coChair?.name ?? "None set"}</p>
            )}
            {canInviteOfficers && committee.coChair ? (
              <Link href={inviteAsOfficerHref(committee.coChair)} className="mt-1 inline-block text-xs font-semibold text-emerald-700 hover:underline">
                Invite {committee.coChair.name} as a STAFF officer →
              </Link>
            ) : null}
          </div>
        </div>
      </SectionCard>

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
                  {committee.coChairAdultId === m.householdAdultId ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Co-chair</span> : null}
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
