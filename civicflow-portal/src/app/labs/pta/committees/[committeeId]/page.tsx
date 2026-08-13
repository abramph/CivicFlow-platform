import { requireOrganization } from "@/lib/auth-guards";
import { checkPtaVerticalAvailable, isCommitteeChair } from "@/lib/labs/pta/guard";
import { getPtaCommittee } from "@/lib/labs/pta/committees";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { AddCommitteeMemberForm } from "@/components/labs/pta/AddCommitteeMemberForm";
import { SetCommitteeChairForm } from "@/components/labs/pta/SetCommitteeChairForm";
import { ConfirmActionButton } from "@/components/labs/pta/ConfirmActionButton";
import { PtaCommitteeDetailsForm } from "@/components/labs/pta/PtaCommitteeDetailsForm";

const STATUS_LABELS: Record<string, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

/**
 * PTA Vertical 2.0, PR PTA-B — accessible to officers (pta:directory:read)
 * AND to this committee's own chair/co-chair via linkage (no staff role
 * required), matching requireCommitteeManageOrChair on the API side. A
 * chair sees and manages their own committee — description/goals/schedule
 * and the member list — without gaining any org-wide authority.
 */
export default async function PtaCommitteeDetailPage({ params }: { params: Promise<{ committeeId: string }> }) {
  const { committeeId } = await params;
  const { organizationId, session, can } = await requireOrganization();
  const { available } = await checkPtaVerticalAvailable(organizationId);
  const chairOfThis = available ? await isCommitteeChair(organizationId, session.userId, committeeId) : false;
  const canView = available && (can("pta:directory:read") || chairOfThis);

  if (!canView) {
    return (
      <main className="space-y-6">
        <PageHeader title="Committee" description="Not available for this organization." />
      </main>
    );
  }

  const committee = await getPtaCommittee(organizationId, committeeId);
  const canManage = can("pta:committees:manage");
  const canEditDetails = canManage || chairOfThis;
  const memberOptions = committee.members.map((m) => ({ householdAdultId: m.householdAdultId, name: m.householdAdult.name }));

  const [years, adults] = canManage
    ? await Promise.all([
        getSchoolYearContext(organizationId),
        prisma.ptaHouseholdAdult.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ])
    : [null, null];

  const liaison = committee.boardLiaisonAdultId
    ? await prisma.ptaHouseholdAdult.findFirst({ where: { id: committee.boardLiaisonAdultId, organizationId }, select: { name: true } })
    : null;

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/committees", label: "Committees" }, { label: committee.name }]} />
      <PageHeader
        title={committee.name}
        description={[
          STATUS_LABELS[committee.status] ?? committee.status,
          committee.schoolYear ?? null,
          liaison ? `Board liaison: ${liaison.name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {canEditDetails ? (
        <SectionCard
          title="About this committee"
          description={
            canManage
              ? "Description, goals, meeting schedule, lifecycle status, school year, and board liaison."
              : "As chair, you can keep the description, goals, and meeting schedule up to date. Renaming, status changes, and leadership assignments are done by the board."
          }
        >
          <PtaCommitteeDetailsForm
            committeeId={committee.id}
            mode={canManage ? "manage" : "chair"}
            initial={{
              description: committee.description,
              goals: committee.goals,
              meetingSchedule: committee.meetingSchedule,
              status: committee.status,
              schoolYearId: committee.schoolYearId,
              boardLiaisonAdultId: committee.boardLiaisonAdultId,
            }}
            years={years ? years.years.map((year) => ({ id: year.id, label: year.label, isCurrent: year.isCurrent })) : []}
            adults={adults ?? []}
          />
        </SectionCard>
      ) : (
        <SectionCard title="About this committee">
          <div className="space-y-2 text-sm text-slate-700">
            <p>{committee.description ?? "No description yet."}</p>
            {committee.goals ? <p><span className="font-semibold">Goals:</span> {committee.goals}</p> : null}
            {committee.meetingSchedule ? <p><span className="font-semibold">Meets:</span> {committee.meetingSchedule}</p> : null}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Chair & co-chair"
        description="The chair and co-chair can manage this committee's own details and member list here — scoped to this committee only, with no broader administrative access."
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Chair</p>
            {canManage ? (
              <SetCommitteeChairForm committeeId={committee.id} members={memberOptions} currentChairAdultId={committee.chairAdultId} field="chairAdultId" label="chair" />
            ) : (
              <p className="text-sm text-slate-700">{committee.chair?.name ?? "None set"}</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Co-chair</p>
            {canManage ? (
              <SetCommitteeChairForm committeeId={committee.id} members={memberOptions} currentChairAdultId={committee.coChairAdultId} field="coChairAdultId" label="co-chair" />
            ) : (
              <p className="text-sm text-slate-700">{committee.coChair?.name ?? "None set"}</p>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Members" description={`${committee.members.length} member(s).`}>
        {committee.members.length === 0 ? (
          <EmptyState title="No members yet" description={canEditDetails ? "Search for a parent below to add them." : undefined} />
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {committee.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {m.householdAdult.name}
                  {committee.chairAdultId === m.householdAdultId ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Chair</span> : null}
                  {committee.coChairAdultId === m.householdAdultId ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Co-chair</span> : null}
                </span>
                {canEditDetails ? (
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
        {canEditDetails ? <AddCommitteeMemberForm committeeId={committee.id} /> : null}
      </SectionCard>
    </main>
  );
}
