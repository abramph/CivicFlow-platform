"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  NOMINATIONS: "Nominations open",
  VOTING: "Voting open",
  CLOSED: "Voting closed",
  CERTIFIED: "Certified",
  CANCELLED: "Cancelled",
};

const NEXT_ACTIONS: Record<string, { status: string; label: string }[]> = {
  DRAFT: [
    { status: "NOMINATIONS", label: "Open nominations" },
    { status: "VOTING", label: "Open voting" },
    { status: "CANCELLED", label: "Cancel" },
  ],
  NOMINATIONS: [
    { status: "VOTING", label: "Open voting" },
    { status: "CANCELLED", label: "Cancel" },
  ],
  VOTING: [{ status: "CLOSED", label: "Close voting" }],
  CLOSED: [{ status: "CERTIFIED", label: "Certify results" }],
};

interface ElectionView {
  id: string;
  title: string;
  description: string | null;
  mode: string;
  status: string;
  votingClosesAt: string | null;
  certifiedAt: string | null;
  eligible: number;
  voted: number;
  contests: {
    id: string;
    title: string;
    seats: number;
    positionName: string | null;
    candidates: { id: string; name: string; statement: string | null; isWithdrawn: boolean }[];
  }[];
  results: { title: string; seats: number; candidates: { name: string; votes: number }[] }[] | null;
}

/** PTA-L — officer election administration. All rules (transitions, the
 * voting-open snapshot, secrecy) are server-side in elections.ts; this
 * component narrates and never grants. */
export function PtaElectionsManager({
  canManage,
  positions,
  elections,
}: {
  canManage: boolean;
  positions: { id: string; name: string }[];
  elections: ElectionView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("SECRET_BALLOT");
  const [eligibilityNote, setEligibilityNote] = useState("");

  const [contestTitles, setContestTitles] = useState<Record<string, string>>({});
  const [contestPositions, setContestPositions] = useState<Record<string, string>>({});
  const [candidateNames, setCandidateNames] = useState<Record<string, string>>({});

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return false;
      }
      return true;
    } catch {
      setError("Unable to connect. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function createElection() {
    const ok = await call("/api/labs/pta/elections", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), mode, eligibilityNote: eligibilityNote.trim() || null }),
    });
    if (ok) {
      setShowCreate(false);
      setTitle("");
      setEligibilityNote("");
      router.refresh();
    }
  }

  async function setStatus(electionId: string, status: string) {
    if (await call(`/api/labs/pta/elections/${electionId}`, { method: "PATCH", body: JSON.stringify({ status }) })) {
      router.refresh();
    }
  }

  async function addContest(electionId: string) {
    const contestTitle = (contestTitles[electionId] ?? "").trim();
    if (!contestTitle) return;
    const positionId = contestPositions[electionId] || null;
    const ok = await call(`/api/labs/pta/elections/${electionId}/contests`, {
      method: "POST",
      body: JSON.stringify({ title: contestTitle, positionId }),
    });
    if (ok) {
      setContestTitles((drafts) => ({ ...drafts, [electionId]: "" }));
      router.refresh();
    }
  }

  async function addCandidate(contestId: string) {
    const name = (candidateNames[contestId] ?? "").trim();
    if (!name) return;
    const ok = await call(`/api/labs/pta/elections/contests/${contestId}/candidates`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (ok) {
      setCandidateNames((drafts) => ({ ...drafts, [contestId]: "" }));
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
    <div className="space-y-5">
      {canManage ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setShowCreate((value) => !value)}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {showCreate ? "Cancel" : "Create election"}
        </button>
      ) : null}

      {showCreate ? (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="2027-2028 Board Election" className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Ballot mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)} className={inputClass}>
              <option value="SECRET_BALLOT">Secret ballot (votes stored without voter identity)</option>
              <option value="OPEN">Open / roll-call (votes attributed by name)</option>
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
            <span>Eligibility note (your local rules, shown to voters)</span>
            <input value={eligibilityNote} onChange={(event) => setEligibilityNote(event.target.value)} placeholder="One vote per adult of an active member household" className={inputClass} />
          </label>
          <div>
            <button
              type="button"
              disabled={pending || !title.trim()}
              onClick={createElection}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      ) : null}

      {elections.length === 0 ? (
        <p className="text-sm text-slate-600">No elections yet.</p>
      ) : (
        <ul className="space-y-3">
          {elections.map((election) => {
            const isOpen = openId === election.id;
            return (
              <li key={election.id} className="rounded-xl border border-slate-200">
                <button type="button" onClick={() => setOpenId(isOpen ? null : election.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
                  <span className="text-sm font-semibold text-slate-900">{election.title}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">{election.mode === "SECRET_BALLOT" ? "Secret ballot" : "Open vote"}</span>
                    {election.eligible > 0 ? (
                      <span className="text-slate-500">
                        turnout {election.voted}/{election.eligible}
                      </span>
                    ) : null}
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${
                        election.status === "VOTING"
                          ? "bg-emerald-100 text-emerald-800"
                          : election.status === "CERTIFIED"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {STATUS_LABELS[election.status] ?? election.status}
                    </span>
                  </span>
                </button>
                {isOpen ? (
                  <div className="space-y-4 border-t border-slate-100 px-4 py-3">
                    {election.contests.map((contest) => (
                      <div key={contest.id}>
                        <h4 className="text-sm font-semibold text-slate-900">
                          {contest.title}
                          {contest.positionName ? <span className="ml-1 text-xs text-slate-500">({contest.positionName})</span> : null}
                          {contest.seats > 1 ? <span className="ml-1 text-xs text-slate-500">— {contest.seats} seats</span> : null}
                        </h4>
                        <ul className="mt-1 text-sm text-slate-800">
                          {contest.candidates.map((candidate) => (
                            <li key={candidate.id} className={candidate.isWithdrawn ? "text-slate-400 line-through" : ""}>
                              {candidate.name}
                            </li>
                          ))}
                          {contest.candidates.length === 0 ? <li className="text-slate-500">No candidates yet.</li> : null}
                        </ul>
                        {canManage && ["DRAFT", "NOMINATIONS"].includes(election.status) ? (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <input
                              value={candidateNames[contest.id] ?? ""}
                              onChange={(event) => setCandidateNames((drafts) => ({ ...drafts, [contest.id]: event.target.value }))}
                              placeholder="Add candidate"
                              className={inputClass + " w-64"}
                            />
                            <button
                              type="button"
                              disabled={pending || !(candidateNames[contest.id] ?? "").trim()}
                              onClick={() => addCandidate(contest.id)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}

                    {canManage && ["DRAFT", "NOMINATIONS"].includes(election.status) ? (
                      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                        <label className="space-y-1 text-sm font-medium text-slate-900">
                          <span>New contest</span>
                          <input
                            value={contestTitles[election.id] ?? ""}
                            onChange={(event) => setContestTitles((drafts) => ({ ...drafts, [election.id]: event.target.value }))}
                            placeholder="President"
                            className={inputClass + " w-56"}
                          />
                        </label>
                        <label className="space-y-1 text-sm font-medium text-slate-900">
                          <span>Board position (optional)</span>
                          <select
                            value={contestPositions[election.id] ?? ""}
                            onChange={(event) => setContestPositions((drafts) => ({ ...drafts, [election.id]: event.target.value }))}
                            className={inputClass + " w-56"}
                          >
                            <option value="">—</option>
                            {positions.map((position) => (
                              <option key={position.id} value={position.id}>
                                {position.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={pending || !(contestTitles[election.id] ?? "").trim()}
                          onClick={() => addContest(election.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Add contest
                        </button>
                      </div>
                    ) : null}

                    {election.results ? (
                      <div className="rounded-lg bg-slate-50 p-3">
                        <h4 className="text-sm font-semibold text-slate-900">
                          Results {election.status === "CERTIFIED" ? "(certified)" : "(pending certification)"}
                        </h4>
                        {election.results.map((contest) => (
                          <div key={contest.title} className="mt-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{contest.title}</p>
                            <ul className="text-sm text-slate-800">
                              {contest.candidates.map((candidate, index) => (
                                <li key={candidate.name} className={index < contest.seats ? "font-semibold" : ""}>
                                  {candidate.name} — {candidate.votes} vote{candidate.votes === 1 ? "" : "s"}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        <p className="mt-2 text-xs text-slate-500">
                          Turnout {election.voted} of {election.eligible} eligible voters. Unestra makes no legal election-compliance claims.
                        </p>
                      </div>
                    ) : null}

                    {canManage ? (
                      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        {(NEXT_ACTIONS[election.status] ?? []).map((action) => (
                          <button
                            key={action.status}
                            type="button"
                            disabled={pending}
                            onClick={() => setStatus(election.id, action.status)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                              action.status === "CANCELLED"
                                ? "border border-red-300 bg-white text-red-700 hover:bg-red-50"
                                : "bg-emerald-700 text-white hover:bg-emerald-800"
                            }`}
                          >
                            {action.label}
                          </button>
                        ))}
                        {election.status === "CLOSED" ? (
                          <p className="w-full text-xs text-slate-500">Certifying finalizes results and publishes them to voters.</p>
                        ) : null}
                        {["DRAFT", "NOMINATIONS"].includes(election.status) ? (
                          <p className="w-full text-xs text-slate-500">
                            Opening voting freezes the voter roll: every adult of an active household at that moment may vote; later additions may not.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
