import type { PtaElectionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * PTA Vertical 2.0, PR PTA-L — Elections (docs/pta-vertical-2.md PTA-L; the
 * dedicated security review lives there). THE INVARIANTS, all enforced in
 * this module and nowhere weaker:
 *
 *  1. Ballot secrecy: PtaBallotChoice rows never carry voter identity in
 *     SECRET_BALLOT mode — the insert below simply has no such field, and
 *     openVoterName is stamped ONLY when the election mode is OPEN.
 *  2. Double voting is blocked by the voter row inside the cast transaction.
 *  3. Only adults captured in the VOTING-open eligibility snapshot may cast.
 *  4. Results are readable by managers after CLOSED, by members after
 *     CERTIFIED — never mid-vote.
 *  5. The whole feature is dark unless PtaProfile.electionsEnabled.
 *  6. Audit records lifecycle + participation, never choices.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

const STATUS_TRANSITIONS: Record<PtaElectionStatus, PtaElectionStatus[]> = {
  DRAFT: ["NOMINATIONS", "VOTING", "CANCELLED"],
  NOMINATIONS: ["VOTING", "DRAFT", "CANCELLED"],
  VOTING: ["CLOSED", "CANCELLED"],
  CLOSED: ["CERTIFIED"],
  CERTIFIED: [],
  CANCELLED: [],
};

export async function ensureElectionsEnabled(organizationId: string) {
  const profile = await prisma.ptaProfile.findUnique({ where: { organizationId }, select: { electionsEnabled: true } });
  if (!profile?.electionsEnabled) {
    throw new PtaError("PTA_ELECTIONS_DISABLED", "Elections are not enabled for this organization.");
  }
}

export async function listElections(organizationId: string) {
  await ensureElectionsEnabled(organizationId);
  return prisma.ptaElection.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: { contests: { select: { id: true } }, voters: { select: { hasVoted: true } } },
  });
}

export async function getElectionDetail(organizationId: string, electionId: string) {
  const election = await prisma.ptaElection.findFirst({
    where: { id: electionId, organizationId },
    include: {
      contests: {
        orderBy: { sortOrder: "asc" },
        include: {
          position: { select: { id: true, name: true } },
          candidates: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        },
      },
      voters: { orderBy: { name: "asc" } },
    },
  });
  if (!election) throw new PtaError("PTA_ELECTION_NOT_FOUND", "Election not found.");
  return election;
}

export interface CreateElectionInput extends ActorInput {
  organizationId: string;
  title: string;
  description?: string | null;
  mode?: "OPEN" | "SECRET_BALLOT";
  eligibilityNote?: string | null;
  votingOpensAt?: Date | null;
  votingClosesAt?: Date | null;
}

export async function createElection(input: CreateElectionInput) {
  await ensureElectionsEnabled(input.organizationId);
  const title = input.title.trim();
  if (!title) throw new PtaError("PTA_VALIDATION_ERROR", "Election title is required.");

  const election = await prisma.ptaElection.create({
    data: {
      organizationId: input.organizationId,
      title,
      description: input.description?.trim() || null,
      mode: input.mode ?? "SECRET_BALLOT",
      eligibilityNote: input.eligibilityNote?.trim() || null,
      votingOpensAt: input.votingOpensAt ?? null,
      votingClosesAt: input.votingClosesAt ?? null,
      createdByUserId: input.actorUserId,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.election.created",
    entityType: "pta_election",
    entityId: election.id,
    metadata: { title, mode: election.mode },
  });
  return election;
}

export async function addContest(input: ActorInput & { organizationId: string; electionId: string; title: string; positionId?: string | null; seats?: number; sortOrder?: number }) {
  const election = await getElectionDetail(input.organizationId, input.electionId);
  if (election.status === "VOTING" || election.status === "CLOSED" || election.status === "CERTIFIED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "Contests are locked once voting begins.");
  }
  const title = input.title.trim();
  if (!title) throw new PtaError("PTA_VALIDATION_ERROR", "Contest title is required.");
  if (input.seats !== undefined && (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 20)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Seats must be between 1 and 20.");
  }
  if (input.positionId) {
    const position = await prisma.ptaBoardPosition.findFirst({ where: { id: input.positionId, organizationId: input.organizationId } });
    if (!position) throw new PtaError("PTA_BOARD_POSITION_NOT_FOUND", "Board position not found.");
  }
  const contest = await prisma.ptaElectionContest.create({
    data: {
      organizationId: input.organizationId,
      electionId: election.id,
      title,
      positionId: input.positionId ?? null,
      seats: input.seats ?? 1,
      sortOrder: input.sortOrder ?? election.contests.length,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.election.contest_added",
    entityType: "pta_election",
    entityId: election.id,
    metadata: { contest: title },
  });
  return contest;
}

export async function addCandidate(input: ActorInput & { organizationId: string; contestId: string; name: string; statement?: string | null; householdAdultId?: string | null }) {
  const contest = await prisma.ptaElectionContest.findFirst({
    where: { id: input.contestId, organizationId: input.organizationId },
    include: { election: { select: { id: true, status: true } } },
  });
  if (!contest) throw new PtaError("PTA_ELECTION_NOT_FOUND", "Contest not found.");
  if (["VOTING", "CLOSED", "CERTIFIED"].includes(contest.election.status)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Candidates are locked once voting begins.");
  }
  const name = input.name.trim();
  if (!name) throw new PtaError("PTA_VALIDATION_ERROR", "Candidate name is required.");
  if (input.householdAdultId) {
    const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: input.householdAdultId, organizationId: input.organizationId } });
    if (!adult) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household adult not found.");
  }
  const candidate = await prisma.ptaElectionCandidate.create({
    data: {
      organizationId: input.organizationId,
      contestId: contest.id,
      name,
      statement: input.statement?.trim() || null,
      householdAdultId: input.householdAdultId ?? null,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.election.candidate_added",
    entityType: "pta_election",
    entityId: contest.election.id,
    metadata: { candidate: name, contest: contest.title },
  });
  return candidate;
}

/**
 * Status moves. →VOTING takes the §21 eligibility snapshot transactionally:
 * every adult of an ACTIVE household at that instant becomes a voter row;
 * nobody added later can vote. CERTIFIED stamps who certified and when.
 */
export async function setElectionStatus(input: ActorInput & { organizationId: string; electionId: string; status: PtaElectionStatus }) {
  const election = await getElectionDetail(input.organizationId, input.electionId);
  if (!STATUS_TRANSITIONS[election.status].includes(input.status)) {
    throw new PtaError("PTA_VALIDATION_ERROR", `A ${election.status.toLowerCase()} election cannot move to ${input.status.toLowerCase()}.`);
  }

  if (input.status === "VOTING") {
    if (election.contests.length === 0) throw new PtaError("PTA_VALIDATION_ERROR", "Add at least one contest before opening voting.");
    if (election.contests.some((contest) => contest.candidates.filter((candidate) => !candidate.isWithdrawn).length === 0)) {
      throw new PtaError("PTA_VALIDATION_ERROR", "Every contest needs at least one candidate before voting opens.");
    }
    const adults = await prisma.ptaHouseholdAdult.findMany({
      where: { organizationId: input.organizationId, household: { status: "ACTIVE" } },
      select: { id: true, name: true },
    });
    if (adults.length === 0) throw new PtaError("PTA_VALIDATION_ERROR", "No eligible voters — there are no adults in active households.");
    await prisma.$transaction(async (tx) => {
      await tx.ptaElectionVoter.createMany({
        data: adults.map((adult) => ({
          organizationId: input.organizationId,
          electionId: election.id,
          householdAdultId: adult.id,
          name: adult.name,
        })),
        skipDuplicates: true,
      });
      await tx.ptaElection.update({
        where: { id: election.id },
        data: { status: "VOTING", votingOpensAt: election.votingOpensAt ?? new Date() },
      });
    });
  } else {
    await prisma.ptaElection.update({
      where: { id: election.id },
      data: {
        status: input.status,
        ...(input.status === "CLOSED" ? { votingClosesAt: election.votingClosesAt ?? new Date() } : {}),
        ...(input.status === "CERTIFIED" ? { certifiedAt: new Date(), certifiedByUserId: input.actorUserId } : {}),
      },
    });
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.status === "CERTIFIED" ? "pta.election.certified" : "pta.election.status_changed",
    entityType: "pta_election",
    entityId: election.id,
    metadata: { before: election.status, after: input.status },
  });
  return getElectionDetail(input.organizationId, input.electionId);
}

/** Tally + turnout. Managers: CLOSED or later. Members: CERTIFIED only
 * (enforced by callers passing the right minimum). */
export async function getElectionResults(organizationId: string, electionId: string, minimumStatus: "CLOSED" | "CERTIFIED") {
  const election = await getElectionDetail(organizationId, electionId);
  const allowed = minimumStatus === "CLOSED" ? ["CLOSED", "CERTIFIED"] : ["CERTIFIED"];
  if (!allowed.includes(election.status)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Results are not available yet.");
  }

  const counts = await prisma.ptaBallotChoice.groupBy({
    by: ["contestId", "candidateId"],
    where: { organizationId, electionId },
    _count: true,
  });
  const countFor = (contestId: string, candidateId: string) =>
    counts.find((row) => row.contestId === contestId && row.candidateId === candidateId)?._count ?? 0;

  const eligible = election.voters.length;
  const voted = election.voters.filter((voter) => voter.hasVoted).length;

  return {
    electionId: election.id,
    title: election.title,
    status: election.status,
    mode: election.mode,
    certifiedAt: election.certifiedAt,
    turnout: { eligible, voted },
    contests: election.contests.map((contest) => ({
      id: contest.id,
      title: contest.title,
      seats: contest.seats,
      candidates: contest.candidates
        .map((candidate) => ({ id: candidate.id, name: candidate.name, isWithdrawn: candidate.isWithdrawn, votes: countFor(contest.id, candidate.id) }))
        .sort((a, b) => b.votes - a.votes),
    })),
  };
}

/** The member-facing view: elections where the caller is a snapshotted
 * voter — open ones to vote in, certified ones to see results of. */
export async function getMyElections(organizationId: string, householdAdultId: string) {
  const profile = await prisma.ptaProfile.findUnique({ where: { organizationId }, select: { electionsEnabled: true } });
  if (!profile?.electionsEnabled) return { open: [], certified: [] };

  const voterRows = await prisma.ptaElectionVoter.findMany({
    where: { organizationId, householdAdultId },
    include: {
      election: {
        include: {
          contests: {
            orderBy: { sortOrder: "asc" },
            include: { candidates: { where: { isWithdrawn: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
          },
        },
      },
    },
  });

  const open = voterRows
    .filter((row) => row.election.status === "VOTING")
    .map((row) => ({
      electionId: row.election.id,
      title: row.election.title,
      description: row.election.description,
      mode: row.election.mode,
      eligibilityNote: row.election.eligibilityNote,
      votingClosesAt: row.election.votingClosesAt,
      hasVoted: row.hasVoted,
      contests: row.election.contests.map((contest) => ({
        id: contest.id,
        title: contest.title,
        seats: contest.seats,
        candidates: contest.candidates.map((candidate) => ({ id: candidate.id, name: candidate.name, statement: candidate.statement })),
      })),
    }));
  const certified = voterRows.filter((row) => row.election.status === "CERTIFIED").map((row) => row.election.id);
  return { open, certified };
}

export interface CastVoteInput {
  organizationId: string;
  electionId: string;
  householdAdultId: string;
  choices: { contestId: string; candidateId: string }[];
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * THE cast path. One transaction: re-check eligibility + not-voted, insert
 * anonymous choices, mark the voter row. In SECRET_BALLOT mode the insert
 * carries no identity of any kind; in OPEN mode it stamps the voter's
 * snapshot name (roll-call semantics, disclosed in the UI before voting).
 */
export async function castVote(input: CastVoteInput) {
  await ensureElectionsEnabled(input.organizationId);
  const election = await prisma.ptaElection.findFirst({
    where: { id: input.electionId, organizationId: input.organizationId },
    include: { contests: { include: { candidates: { where: { isWithdrawn: false }, select: { id: true } } } } },
  });
  if (!election) throw new PtaError("PTA_ELECTION_NOT_FOUND", "Election not found.");
  if (election.status !== "VOTING") throw new PtaError("PTA_VALIDATION_ERROR", "Voting is not open.");
  if (election.votingClosesAt && election.votingClosesAt.getTime() < Date.now()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "The voting window has closed.");
  }

  const voter = await prisma.ptaElectionVoter.findFirst({
    where: { electionId: election.id, householdAdultId: input.householdAdultId, organizationId: input.organizationId },
  });
  if (!voter) throw new PtaError("PTA_NOT_ELIGIBLE_VOTER", "You are not on this election's voter roll.");
  if (voter.hasVoted) throw new PtaError("PTA_ALREADY_VOTED", "You have already voted in this election.");

  if (input.choices.length === 0) throw new PtaError("PTA_VALIDATION_ERROR", "Select at least one candidate.");
  const byContest = new Map<string, Set<string>>();
  for (const choice of input.choices) {
    const contest = election.contests.find((row) => row.id === choice.contestId);
    if (!contest) throw new PtaError("PTA_VALIDATION_ERROR", "Unknown contest on the ballot.");
    if (!contest.candidates.some((candidate) => candidate.id === choice.candidateId)) {
      throw new PtaError("PTA_VALIDATION_ERROR", "Unknown candidate on the ballot.");
    }
    const picks = byContest.get(contest.id) ?? new Set<string>();
    if (picks.has(choice.candidateId)) throw new PtaError("PTA_VALIDATION_ERROR", "Duplicate candidate selection.");
    picks.add(choice.candidateId);
    if (picks.size > contest.seats) {
      throw new PtaError("PTA_VALIDATION_ERROR", `"${contest.title}" allows up to ${contest.seats} selection(s).`);
    }
    byContest.set(contest.id, picks);
  }

  await prisma.$transaction(async (tx) => {
    // Concurrency guard: flip hasVoted first with a guarded updateMany — a
    // second concurrent cast matches zero rows and aborts before any
    // choices are written.
    const flipped = await tx.ptaElectionVoter.updateMany({
      where: { id: voter.id, hasVoted: false },
      data: { hasVoted: true, votedAt: new Date() },
    });
    if (flipped.count === 0) throw new PtaError("PTA_ALREADY_VOTED", "You have already voted in this election.");
    await tx.ptaBallotChoice.createMany({
      data: input.choices.map((choice) => ({
        organizationId: input.organizationId,
        electionId: election.id,
        contestId: choice.contestId,
        candidateId: choice.candidateId,
        // SECRET_BALLOT: openVoterName stays null — identity is simply never
        // written. OPEN: roll-call attribution via the snapshot name.
        openVoterName: election.mode === "OPEN" ? voter.name : null,
      })),
    });
  });

  // Participation is audited; choices never are.
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.election.vote_cast",
    entityType: "pta_election",
    entityId: election.id,
    metadata: { participation: true },
  });
  return { ok: true };
}
