"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OpenElectionView {
  electionId: string;
  title: string;
  description: string | null;
  mode: string;
  eligibilityNote: string | null;
  votingClosesAt: string | null;
  hasVoted: boolean;
  contests: { id: string; title: string; seats: number; candidates: { id: string; name: string; statement: string | null }[] }[];
}

interface CertifiedResultsView {
  electionId: string;
  title: string;
  contests: { title: string; seats: number; candidates: { name: string; votes: number }[] }[];
}

/** PTA-L — the member ballot. Selection state is local; the server enforces
 * eligibility, the seat limits, and ballot secrecy (see elections.ts). */
export function PtaMyElections({ open, certified }: { open: OpenElectionView[]; certified: CertifiedResultsView[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Set<string>>>({});

  function togglePick(contestId: string, candidateId: string, seats: number) {
    setPicks((current) => {
      const next = { ...current };
      const set = new Set(next[contestId] ?? []);
      if (set.has(candidateId)) {
        set.delete(candidateId);
      } else if (set.size < seats) {
        set.add(candidateId);
      }
      next[contestId] = set;
      return next;
    });
  }

  async function vote(election: OpenElectionView) {
    const choices = election.contests.flatMap((contest) =>
      [...(picks[contest.id] ?? [])].map((candidateId) => ({ contestId: contest.id, candidateId }))
    );
    if (choices.length === 0) {
      setError("Select at least one candidate before submitting.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/my/elections/${election.electionId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choices }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to submit your ballot.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (open.length === 0 && certified.length === 0) return null;

  return (
    <div className="space-y-4">
      {open.map((election) => (
        <div key={election.electionId} className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="text-sm font-semibold text-emerald-900">🗳 {election.title}</h3>
          {election.description ? <p className="mt-1 text-sm text-emerald-900">{election.description}</p> : null}
          <p className="mt-1 text-xs text-emerald-800">
            {election.mode === "SECRET_BALLOT"
              ? "Secret ballot: your choices are stored without your identity."
              : "Open vote: your choices are recorded with your name."}
            {election.eligibilityNote ? ` · ${election.eligibilityNote}` : ""}
            {election.votingClosesAt ? ` · closes ${new Date(election.votingClosesAt).toLocaleString()}` : ""}
          </p>
          {election.hasVoted ? (
            <p className="mt-2 text-sm font-semibold text-emerald-800">Your ballot has been cast. Thank you for voting!</p>
          ) : (
            <>
              {election.contests.map((contest) => (
                <div key={contest.id} className="mt-3">
                  <p className="text-sm font-semibold text-emerald-900">
                    {contest.title}
                    {contest.seats > 1 ? ` (choose up to ${contest.seats})` : ""}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {contest.candidates.map((candidate) => (
                      <li key={candidate.id}>
                        <label className="flex items-start gap-2 text-sm text-emerald-950">
                          <input
                            type="checkbox"
                            checked={(picks[contest.id] ?? new Set()).has(candidate.id)}
                            onChange={() => togglePick(contest.id, candidate.id, contest.seats)}
                            className="mt-0.5 h-4 w-4"
                          />
                          <span>
                            {candidate.name}
                            {candidate.statement ? <span className="block text-xs text-emerald-700">{candidate.statement}</span> : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => vote(election)}
                className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Cast my ballot
              </button>
              <p className="mt-1 text-xs text-emerald-700">A ballot cannot be changed after it is cast.</p>
            </>
          )}
        </div>
      ))}

      {certified.map((results) => (
        <div key={results.electionId} className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h3 className="text-sm font-semibold text-sky-900">Certified results — {results.title}</h3>
          {results.contests.map((contest) => (
            <div key={contest.title} className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{contest.title}</p>
              <ul className="text-sm text-sky-950">
                {contest.candidates.map((candidate, index) => (
                  <li key={candidate.name} className={index < contest.seats ? "font-semibold" : ""}>
                    {candidate.name} — {candidate.votes} vote{candidate.votes === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
