import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueProfile = vi.fn();
const findFirstElection = vi.fn();
const findManyAdults = vi.fn();
const findFirstVoter = vi.fn();
const groupByChoices = vi.fn();
const txCreateManyVoters = vi.fn();
const txUpdateElection = vi.fn();
const txUpdateManyVoters = vi.fn();
const txCreateManyChoices = vi.fn();
const updateElection = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaElection: {
      findFirst: (...a: unknown[]) => findFirstElection(...a),
      update: (...a: unknown[]) => updateElection(...a),
    },
    ptaHouseholdAdult: { findMany: (...a: unknown[]) => findManyAdults(...a) },
    ptaElectionVoter: { findFirst: (...a: unknown[]) => findFirstVoter(...a) },
    ptaBallotChoice: { groupBy: (...a: unknown[]) => groupByChoices(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { castVote, ensureElectionsEnabled, getElectionResults, setElectionStatus } from "@/lib/labs/pta/elections";

const actor = { actorUserId: "admin-1", actorEmail: "admin@example.org" };

function votingElection(mode: "OPEN" | "SECRET_BALLOT" = "SECRET_BALLOT") {
  return {
    id: "e1",
    organizationId: "org-1",
    status: "VOTING",
    mode,
    votingClosesAt: null,
    contests: [
      { id: "con-1", title: "President", seats: 1, candidates: [{ id: "cand-a" }, { id: "cand-b" }] },
      { id: "con-2", title: "Board Members", seats: 2, candidates: [{ id: "cand-c" }, { id: "cand-d" }, { id: "cand-e" }] },
    ],
  };
}

function transactionRunsCallback() {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      ptaElectionVoter: {
        createMany: (...a: unknown[]) => txCreateManyVoters(...a),
        updateMany: (...a: unknown[]) => txUpdateManyVoters(...a),
      },
      ptaElection: { update: (...a: unknown[]) => txUpdateElection(...a) },
      ptaBallotChoice: { createMany: (...a: unknown[]) => txCreateManyChoices(...a) },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueProfile.mockResolvedValue({ electionsEnabled: true });
  txUpdateManyVoters.mockResolvedValue({ count: 1 });
  transactionRunsCallback();
});

describe("feature gate (§21)", () => {
  it("everything is dark when electionsEnabled is off (the default)", async () => {
    findUniqueProfile.mockResolvedValueOnce({ electionsEnabled: false });
    await expect(ensureElectionsEnabled("org-1")).rejects.toMatchObject({ code: "PTA_ELECTIONS_DISABLED", status: 403 });
    findUniqueProfile.mockResolvedValueOnce(null);
    await expect(ensureElectionsEnabled("org-1")).rejects.toMatchObject({ code: "PTA_ELECTIONS_DISABLED" });
  });
});

describe("ballot secrecy — THE invariant", () => {
  it("secret-ballot choice inserts carry no voter identity of any kind", async () => {
    findFirstElection.mockResolvedValueOnce(votingElection("SECRET_BALLOT"));
    findFirstVoter.mockResolvedValueOnce({ id: "v1", hasVoted: false, name: "Pat Parent" });

    await castVote({
      organizationId: "org-1",
      electionId: "e1",
      householdAdultId: "adult-1",
      choices: [{ contestId: "con-1", candidateId: "cand-a" }],
      ...actor,
    });

    const rows = txCreateManyChoices.mock.calls[0][0].data as Record<string, unknown>[];
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["candidateId", "contestId", "electionId", "openVoterName", "organizationId"]);
      expect(row.openVoterName).toBeNull();
      expect(JSON.stringify(row)).not.toContain("adult-1");
      expect(JSON.stringify(row)).not.toContain("v1");
      expect(JSON.stringify(row)).not.toContain("Pat Parent");
    }
  });

  it("OPEN mode stamps the snapshot name (roll-call semantics)", async () => {
    findFirstElection.mockResolvedValueOnce(votingElection("OPEN"));
    findFirstVoter.mockResolvedValueOnce({ id: "v1", hasVoted: false, name: "Pat Parent" });
    await castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "con-1", candidateId: "cand-a" }], ...actor });
    const rows = txCreateManyChoices.mock.calls[0][0].data as { openVoterName: string | null }[];
    expect(rows[0].openVoterName).toBe("Pat Parent");
  });

  it("participation is audited; choices never are", async () => {
    findFirstElection.mockResolvedValueOnce(votingElection());
    findFirstVoter.mockResolvedValueOnce({ id: "v1", hasVoted: false, name: "Pat" });
    await castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "con-1", candidateId: "cand-a" }], ...actor });
    const audit = createAuditEvent.mock.calls[0][0];
    expect(audit.action).toBe("pta.election.vote_cast");
    expect(JSON.stringify(audit.metadata)).not.toContain("cand-a");
    expect(JSON.stringify(audit.metadata)).not.toContain("con-1");
  });
});

describe("casting rules", () => {
  it("only snapshotted voters may cast; a second cast is refused", async () => {
    findFirstElection.mockResolvedValueOnce(votingElection());
    findFirstVoter.mockResolvedValueOnce(null);
    await expect(
      castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "late-joiner", choices: [{ contestId: "con-1", candidateId: "cand-a" }], ...actor })
    ).rejects.toMatchObject({ code: "PTA_NOT_ELIGIBLE_VOTER" });

    findFirstElection.mockResolvedValueOnce(votingElection());
    findFirstVoter.mockResolvedValueOnce({ id: "v1", hasVoted: true, name: "Pat" });
    await expect(
      castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "con-1", candidateId: "cand-a" }], ...actor })
    ).rejects.toMatchObject({ code: "PTA_ALREADY_VOTED", status: 409 });
  });

  it("a concurrent double-cast loses on the guarded voter-row flip and writes no choices", async () => {
    findFirstElection.mockResolvedValueOnce(votingElection());
    findFirstVoter.mockResolvedValueOnce({ id: "v1", hasVoted: false, name: "Pat" });
    txUpdateManyVoters.mockResolvedValueOnce({ count: 0 });
    await expect(
      castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "con-1", candidateId: "cand-a" }], ...actor })
    ).rejects.toMatchObject({ code: "PTA_ALREADY_VOTED" });
    expect(txCreateManyChoices).not.toHaveBeenCalled();
    expect(txUpdateManyVoters.mock.calls[0][0].where).toMatchObject({ id: "v1", hasVoted: false });
  });

  it("ballots are validated: foreign contests/candidates and over-seat picks are rejected", async () => {
    findFirstElection.mockResolvedValue(votingElection());
    findFirstVoter.mockResolvedValue({ id: "v1", hasVoted: false, name: "Pat" });

    await expect(
      castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "foreign", candidateId: "cand-a" }], ...actor })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    await expect(
      castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "con-1", candidateId: "cand-c" }], ...actor })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    await expect(
      castVote({
        organizationId: "org-1",
        electionId: "e1",
        householdAdultId: "adult-1",
        choices: [
          { contestId: "con-1", candidateId: "cand-a" },
          { contestId: "con-1", candidateId: "cand-b" },
        ],
        ...actor,
      })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("voting outside the window is refused", async () => {
    findFirstElection.mockResolvedValueOnce({ ...votingElection(), votingClosesAt: new Date(Date.now() - 60_000) });
    findFirstVoter.mockResolvedValueOnce({ id: "v1", hasVoted: false, name: "Pat" });
    await expect(
      castVote({ organizationId: "org-1", electionId: "e1", householdAdultId: "adult-1", choices: [{ contestId: "con-1", candidateId: "cand-a" }], ...actor })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});

describe("lifecycle & snapshot", () => {
  it("opening voting snapshots every adult of an active household, transactionally", async () => {
    findFirstElection
      .mockResolvedValueOnce({
        id: "e1",
        status: "DRAFT",
        votingOpensAt: null,
        contests: [{ id: "con-1", candidates: [{ id: "cand-a", isWithdrawn: false }] }],
        voters: [],
      })
      .mockResolvedValueOnce({ id: "e1", status: "VOTING", contests: [], voters: [] });
    findManyAdults.mockResolvedValueOnce([
      { id: "a1", name: "Pat" },
      { id: "a2", name: "Sam" },
    ]);

    await setElectionStatus({ organizationId: "org-1", electionId: "e1", status: "VOTING", ...actor });

    expect(findManyAdults.mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", household: { status: "ACTIVE" } });
    const rows = txCreateManyVoters.mock.calls[0][0].data as { householdAdultId: string }[];
    expect(rows.map((row) => row.householdAdultId)).toEqual(["a1", "a2"]);
    expect(txUpdateElection.mock.calls[0][0].data.status).toBe("VOTING");
  });

  it("certification stamps who and when; certified elections are terminal", async () => {
    findFirstElection
      .mockResolvedValueOnce({ id: "e1", status: "CLOSED", contests: [], voters: [] })
      .mockResolvedValueOnce({ id: "e1", status: "CERTIFIED", contests: [], voters: [] });
    updateElection.mockResolvedValueOnce({ id: "e1" });
    await setElectionStatus({ organizationId: "org-1", electionId: "e1", status: "CERTIFIED", ...actor });
    expect(updateElection.mock.calls[0][0].data).toMatchObject({ status: "CERTIFIED", certifiedByUserId: "admin-1" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.election.certified" }));

    findFirstElection.mockResolvedValueOnce({ id: "e1", status: "CERTIFIED", contests: [], voters: [] });
    await expect(setElectionStatus({ organizationId: "org-1", electionId: "e1", status: "VOTING", ...actor })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("results are refused before CLOSED (managers) and before CERTIFIED (members)", async () => {
    findFirstElection.mockResolvedValue({ id: "e1", status: "VOTING", mode: "SECRET_BALLOT", certifiedAt: null, title: "t", contests: [], voters: [] });
    await expect(getElectionResults("org-1", "e1", "CLOSED")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    findFirstElection.mockResolvedValue({ id: "e1", status: "CLOSED", mode: "SECRET_BALLOT", certifiedAt: null, title: "t", contests: [], voters: [] });
    await expect(getElectionResults("org-1", "e1", "CERTIFIED")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("tallies come from anonymous choice counts and include turnout", async () => {
    findFirstElection.mockResolvedValueOnce({
      id: "e1",
      status: "CLOSED",
      mode: "SECRET_BALLOT",
      certifiedAt: null,
      title: "Board Election",
      contests: [{ id: "con-1", title: "President", seats: 1, candidates: [{ id: "cand-a", name: "Alice", isWithdrawn: false }, { id: "cand-b", name: "Bob", isWithdrawn: false }] }],
      voters: [{ hasVoted: true }, { hasVoted: true }, { hasVoted: false }],
    });
    groupByChoices.mockResolvedValueOnce([
      { contestId: "con-1", candidateId: "cand-a", _count: 2 },
    ]);
    const results = await getElectionResults("org-1", "e1", "CLOSED");
    expect(results.turnout).toEqual({ eligible: 3, voted: 2 });
    expect(results.contests[0].candidates[0]).toMatchObject({ name: "Alice", votes: 2 });
    expect(results.contests[0].candidates[1]).toMatchObject({ name: "Bob", votes: 0 });
  });
});
