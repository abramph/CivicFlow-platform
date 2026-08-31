import { requireOrganization } from "@/lib/auth-guards";
import { requirePtaVertical, getPtaOrganizationAccessContext } from "@/lib/labs/pta/guard";
import { getBoardRoster } from "@/lib/labs/pta/board";
import { getMyIncomingHandoff } from "@/lib/labs/pta/transitions";
import { getElectionResults, getMyElections } from "@/lib/labs/pta/elections";
import { checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
import { PtaMyElections } from "@/components/labs/pta/PtaMyElections";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaMyPta } from "@/components/labs/pta/PtaMyPta";
import { PtaVolunteerRequirementCard } from "@/components/labs/pta/PtaVolunteerRequirementCard";
import { PtaVolunteerAgreementStatusCard } from "@/components/labs/pta/PtaVolunteerAgreementStatusCard";

/**
 * PTA Vertical 2.0, PR PTA-J — "My PTA" (§19): the member's view of their
 * organization. Linkage-gated like every parent surface (household adult),
 * never Permissions. Shows only what the org deliberately shares: member-
 * visible documents, current governing documents, the board roster (names
 * and positions only), and upcoming meetings.
 */
export default async function PtaMyPtaPage() {
  const { organizationId, session } = await requireOrganization();
  try {
    await requirePtaVertical(organizationId);
  } catch {
    return (
      <main className="space-y-6">
        <PageHeader title="My PTA" description="Not available for this organization." />
      </main>
    );
  }

  const context = await getPtaOrganizationAccessContext(organizationId, session.userId);
  if (!context.identity.isHouseholdAdult) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader
          title="My PTA"
          description="Your account is not linked to a PTA household in this organization. Ask an officer to send you a household invitation."
        />
      </main>
    );
  }

  const now = new Date();
  const in90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const [volunteerRequirementsAvailable, volunteerBuyoutAvailable, volunteerReportsAvailable] = await Promise.all([
    checkVolunteerHoursAvailable(organizationId, "requirements"),
    checkVolunteerHoursAvailable(organizationId, "buyout"),
    checkVolunteerHoursAvailable(organizationId, "reports"),
  ]);
  const [profile, documents, governance, roster, meetings, myHandoff] = await Promise.all([
    prisma.ptaProfile.findUnique({ where: { organizationId }, select: { schoolOrPtaName: true, contactEmail: true, currentSchoolYear: true } }),
    prisma.attachment.findMany({
      where: { organizationId, entityType: "ORGANIZATION_DOCUMENT", deletedAt: null, memberVisible: true },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, fileName: true, title: true, purpose: true, uploadedAt: true },
      take: 100,
    }),
    prisma.governanceDocument.findMany({
      where: { organizationId, status: "CURRENT" },
      orderBy: [{ docType: "asc" }, { title: "asc" }],
      select: { id: true, title: true, docType: true, version: true, fileName: true },
    }),
    getBoardRoster(organizationId),
    prisma.meeting.findMany({
      where: { organizationId, meetingDate: { gte: now, lte: in90Days } },
      orderBy: { meetingDate: "asc" },
      select: { title: true, meetingDate: true, location: true },
      take: 10,
    }),
    getMyIncomingHandoff(organizationId, session.userId),
  ]);

  // PTA-L: the member's elections — open ballots and certified results.
  const adultRow = await prisma.ptaHouseholdAdult.findFirst({ where: { organizationId, userId: session.userId }, select: { id: true } });
  const myElections = adultRow ? await getMyElections(organizationId, adultRow.id) : { open: [], certified: [] };
  const certifiedResults = [];
  for (const electionId of myElections.certified) {
    const results = await getElectionResults(organizationId, electionId, "CERTIFIED");
    certifiedResults.push({
      electionId,
      title: results.title,
      contests: results.contests.map((contest) => ({
        title: contest.title,
        seats: contest.seats,
        candidates: contest.candidates.map((candidate) => ({ name: candidate.name, votes: candidate.votes })),
      })),
    });
  }

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title={`My PTA${profile?.schoolOrPtaName ? ` — ${profile.schoolOrPtaName}` : ""}`}
        description={`Documents, governing rules, your board, and what's coming up${profile?.currentSchoolYear ? ` in ${profile.currentSchoolYear}` : ""}.`}
      />
      {myElections.open.length > 0 || certifiedResults.length > 0 ? (
        <SectionCard title="Elections" description="Your ballot and certified results.">
          <PtaMyElections
            open={myElections.open.map((election) => ({
              electionId: election.electionId,
              title: election.title,
              description: election.description,
              mode: election.mode,
              eligibilityNote: election.eligibilityNote,
              votingClosesAt: election.votingClosesAt?.toISOString() ?? null,
              hasVoted: election.hasVoted,
              contests: election.contests,
            }))}
            certified={certifiedResults}
          />
        </SectionCard>
      ) : null}
      {volunteerRequirementsAvailable ? (
        <SectionCard title="Volunteer Requirement" description="Your family's volunteer-hour requirement, progress, and options.">
          <PtaVolunteerRequirementCard buyoutAvailable={volunteerBuyoutAvailable} reportsAvailable={volunteerReportsAvailable} />
          {/* feature/pta-family-agreement-buyout follow-up (FA2 §3): self-hiding
              — renders nothing unless an agreement is actually assigned to this
              household's active period. Kept inside this existing SectionCard
              (not a new one) so a period with no agreement assigned shows
              exactly what it showed before this feature existed. */}
          <div className="mt-4">
            <PtaVolunteerAgreementStatusCard />
          </div>
        </SectionCard>
      ) : null}
      <SectionCard title="Your PTA at a glance" description="Everything here is shared with members deliberately by your officers.">
        <PtaMyPta
          contactEmail={profile?.contactEmail ?? null}
          documents={documents.map((doc) => ({
            id: doc.id,
            label: doc.title || doc.fileName,
            folder: doc.purpose,
            uploadedAt: doc.uploadedAt.toISOString(),
          }))}
          governance={governance.map((doc) => ({
            id: doc.id,
            title: doc.title,
            docType: doc.docType,
            version: doc.version,
            hasFile: Boolean(doc.fileName),
          }))}
          board={roster
            .filter((position) => position.currentAssignment)
            .map((position) => ({ position: position.name, holder: position.currentAssignment!.holderName }))}
          meetings={meetings.map((meeting) => ({
            title: meeting.title,
            date: meeting.meetingDate.toISOString(),
            location: meeting.location,
          }))}
          myHandoff={
            myHandoff
              ? {
                  positionName: myHandoff.position.name,
                  responsibilities: myHandoff.position.responsibilities,
                  years: `${myHandoff.transition.fromSchoolYear.label} → ${myHandoff.transition.toSchoolYear.label}`,
                  status: myHandoff.status,
                  outgoingName: myHandoff.outgoingAssignment
                    ? myHandoff.outgoingAssignment.householdAdult?.name ?? myHandoff.outgoingAssignment.personName
                    : null,
                  notes: myHandoff.notes,
                  checklist: myHandoff.checklistItems.map((item) => ({
                    title: item.title,
                    isRequired: item.isRequired,
                    done: item.completedAt !== null,
                  })),
                }
              : null
          }
        />
      </SectionCard>
    </main>
  );
}
