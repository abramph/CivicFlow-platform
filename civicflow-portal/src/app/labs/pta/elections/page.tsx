import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { getElectionDetail, getElectionResults } from "@/lib/labs/pta/elections";
import { getBoardRoster } from "@/lib/labs/pta/board";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaElectionsManager } from "@/components/labs/pta/PtaElectionsManager";

/**
 * PTA Vertical 2.0, PR PTA-L — officer election administration. Dark unless
 * PtaProfile.electionsEnabled; the security model lives in
 * lib/labs/pta/elections.ts and docs/pta-vertical-2.md PTA-L.
 */
export default async function PtaElectionsPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:elections:view");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Elections" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await prisma.ptaProfile.findUnique({ where: { organizationId }, select: { electionsEnabled: true } });
  if (!profile?.electionsEnabled) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader
          title="Elections"
          description="Elections are not enabled for this PTA. An administrator can turn them on under PTA Setup. Unestra elections support your own process — no legal election-compliance claims are made."
        />
      </main>
    );
  }

  const elections = await prisma.ptaElection.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const details = await Promise.all(elections.map((election) => getElectionDetail(organizationId, election.id)));
  const resultsById = new Map<string, Awaited<ReturnType<typeof getElectionResults>>>();
  for (const detail of details) {
    if (detail.status === "CLOSED" || detail.status === "CERTIFIED") {
      resultsById.set(detail.id, await getElectionResults(organizationId, detail.id, "CLOSED"));
    }
  }
  const roster = await getBoardRoster(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Elections"
        description="Run your PTA's elections: contests, candidates, a frozen voter roll at opening, and certified results. Secret ballots are stored without voter identity — see the security notes in your setup guide. Unestra makes no legal election-compliance claims; follow your bylaws and state rules."
      />
      <SectionCard title="Elections" description="Voting members are snapshotted from active households the moment voting opens.">
        <PtaElectionsManager
          canManage={can("pta:elections:manage")}
          positions={roster.map((position) => ({ id: position.id, name: position.name }))}
          elections={details.map((detail) => ({
            id: detail.id,
            title: detail.title,
            description: detail.description,
            mode: detail.mode,
            status: detail.status,
            votingClosesAt: detail.votingClosesAt?.toISOString() ?? null,
            certifiedAt: detail.certifiedAt?.toISOString() ?? null,
            eligible: detail.voters.length,
            voted: detail.voters.filter((voter) => voter.hasVoted).length,
            contests: detail.contests.map((contest) => ({
              id: contest.id,
              title: contest.title,
              seats: contest.seats,
              positionName: contest.position?.name ?? null,
              candidates: contest.candidates.map((candidate) => ({
                id: candidate.id,
                name: candidate.name,
                statement: candidate.statement,
                isWithdrawn: candidate.isWithdrawn,
              })),
            })),
            results: resultsById.has(detail.id)
              ? resultsById.get(detail.id)!.contests.map((contest) => ({
                  title: contest.title,
                  seats: contest.seats,
                  candidates: contest.candidates.map((candidate) => ({ name: candidate.name, votes: candidate.votes })),
                }))
              : null,
          }))}
        />
      </SectionCard>
    </main>
  );
}
