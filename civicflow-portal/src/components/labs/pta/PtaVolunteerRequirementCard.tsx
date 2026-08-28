"use client";

import { useEffect, useState } from "react";

type ElectionType = "VOLUNTEER" | "FULL_BUYOUT" | "PARTIAL_BUYOUT";

interface SummaryLike {
  period: { id: string; name: string; volunteerDeadline: string | null; buyoutFullAllowed: boolean; buyoutIncrementMinutes: number };
  requirement: { requiredMinutes: number; assignmentType: string; exempt: boolean };
  totals: {
    verifiedMinutes: number;
    eventMinutes: number;
    nonEventMinutes: number;
    pendingMinutes: number;
    purchasedMinutes: number;
    creditMinutes: number;
    waivedMinutes: number;
    outstandingBalanceCents: number;
  };
  remainingMinutes: number;
  perHourRateCents: number | null;
  fullBuyoutRateCents: number | null;
}

function hours(minutes: number) {
  return (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-E (docs/pta-volunteer-hours.md).
 * The family-facing "Volunteer Requirement" surface (spec §8). Fetches its
 * own data (this page has no server-rendered props to drill through — the
 * summary depends on client interaction like electing/re-quoting). Fully
 * responsive: single column on phones, side-by-side stat groups from `sm`
 * up, per spec §6's phone/tablet/desktop requirement.
 */
export function PtaVolunteerRequirementCard({ buyoutAvailable }: { buyoutAvailable: boolean }) {
  const [summary, setSummary] = useState<SummaryLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [electionType, setElectionType] = useState<ElectionType>("VOLUNTEER");
  const [hoursWanted, setHoursWanted] = useState("");
  const [quote, setQuote] = useState<{ totalCents: number; hoursElectedMinutes: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [electing, setElecting] = useState(false);
  const [electionSaved, setElectionSaved] = useState(false);

  const [disputeText, setDisputeText] = useState("");
  const [disputePending, setDisputePending] = useState(false);
  const [disputeSubmitted, setDisputeSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/labs/pta/volunteer-hours/my-household/summary")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data?.ok) {
          setError(data?.error || "Unable to load your volunteer requirement.");
          return;
        }
        setSummary(data.data);
      })
      .catch(() => !cancelled && setError("Unable to connect. Please try again."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function runQuote() {
    if (!summary) return;
    setQuoting(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/volunteer-hours/my-household/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: summary.period.id,
          electionType,
          ...(electionType === "PARTIAL_BUYOUT" ? { hoursElectedMinutes: Math.round(Number(hoursWanted || 0) * 60) } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to generate a quote.");
        setQuote(null);
        return;
      }
      setQuote(data.data);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setQuoting(false);
    }
  }

  async function submitElection() {
    if (!summary) return;
    setElecting(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/volunteer-hours/my-household/election", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: summary.period.id,
          electionType,
          ...(electionType === "PARTIAL_BUYOUT" ? { hoursElectedMinutes: Math.round(Number(hoursWanted || 0) * 60) } : {}),
          acknowledged,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to record your choice.");
        return;
      }
      setElectionSaved(true);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setElecting(false);
    }
  }

  async function submitDispute() {
    if (!summary || !disputeText.trim()) return;
    setDisputePending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/volunteer-hours/my-household/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId: summary.period.id, description: disputeText.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to submit your report.");
        return;
      }
      setDisputeSubmitted(true);
      setDisputeText("");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setDisputePending(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-600">Loading your volunteer requirement...</p>;
  if (!summary) {
    return <p className="text-sm text-slate-600">No volunteer hour requirement is currently active for your family.</p>;
  }

  const stats: Array<[string, string]> = [
    ["Required hours", hours(summary.requirement.requiredMinutes)],
    ["Verified hours", hours(summary.totals.verifiedMinutes)],
    ["  Event hours", hours(summary.totals.eventMinutes)],
    ["  Non-event hours", hours(summary.totals.nonEventMinutes)],
    ["Pending approval", hours(summary.totals.pendingMinutes)],
    ["Purchased hours", hours(summary.totals.purchasedMinutes)],
    ["Waived / credited", hours(summary.totals.waivedMinutes + summary.totals.creditMinutes)],
    ["Remaining required", hours(summary.remainingMinutes)],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{summary.period.name}</h3>
        {summary.period.volunteerDeadline ? (
          <p className="text-xs text-slate-500">Volunteer completion deadline: {summary.period.volunteerDeadline.slice(0, 10)}</p>
        ) : null}
        {summary.requirement.exempt ? <p className="mt-1 text-sm font-medium text-emerald-700">Your family is exempt this period.</p> : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <dt className="text-xs font-medium text-slate-500">{label.trim()}</dt>
            <dd className="text-lg font-semibold text-slate-900">{value}h</dd>
          </div>
        ))}
      </dl>

      {summary.totals.outstandingBalanceCents > 0 ? (
        <p className="text-sm font-medium text-amber-700">Outstanding balance: {money(summary.totals.outstandingBalanceCents)}</p>
      ) : null}

      {buyoutAvailable && !summary.requirement.exempt ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">Volunteer or pay for hours</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>I want to...</span>
              <select
                value={electionType}
                onChange={(e) => {
                  setElectionType(e.target.value as ElectionType);
                  setQuote(null);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="VOLUNTEER">Complete the required volunteer hours myself</option>
                {summary.fullBuyoutRateCents != null && summary.period.buyoutFullAllowed ? (
                  <option value="FULL_BUYOUT">Purchase all required volunteer hours</option>
                ) : null}
                {summary.perHourRateCents != null ? <option value="PARTIAL_BUYOUT">Purchase part of my volunteer hours</option> : null}
              </select>
            </label>
            {electionType === "PARTIAL_BUYOUT" ? (
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>Hours to purchase</span>
                <input
                  type="number"
                  min={0}
                  step={summary.period.buyoutIncrementMinutes / 60}
                  value={hoursWanted}
                  onChange={(e) => {
                    setHoursWanted(e.target.value);
                    setQuote(null);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            ) : null}
          </div>
          <button
            type="button"
            disabled={quoting || (electionType === "PARTIAL_BUYOUT" && !hoursWanted)}
            onClick={runQuote}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            {quoting ? "Calculating..." : "Get a quote"}
          </button>

          {quote ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                Hours purchased: <strong>{hours(quote.hoursElectedMinutes)}h</strong>
              </p>
              <p>
                Hours you&apos;ll still need to volunteer:{" "}
                <strong>{hours(Math.max(0, summary.remainingMinutes - quote.hoursElectedMinutes))}h</strong>
              </p>
              <p>
                Total cost: <strong>{money(quote.totalCents)}</strong>
              </p>
              <p className="text-xs text-slate-500">
                Selecting this option records your choice — it is not a payment. Refunds follow your PTA&apos;s stated refund
                policy. Purchased hours are credited only once payment is confirmed.
              </p>
              <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>I understand the above and want to proceed with this choice.</span>
              </label>
              <button
                type="button"
                disabled={electing || !acknowledged}
                onClick={submitElection}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {electing ? "Saving..." : "Confirm my choice"}
              </button>
            </div>
          ) : null}

          {electionSaved ? (
            <p className="text-sm font-medium text-emerald-700">
              Your choice has been recorded. An officer will follow up with instructions to complete payment if needed.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-900">Report a missing or incorrect volunteer record</h4>
        <textarea
          value={disputeText}
          onChange={(e) => setDisputeText(e.target.value)}
          rows={2}
          placeholder="Describe the shift or activity — date, event, who volunteered."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={disputePending || !disputeText.trim()}
          onClick={submitDispute}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          {disputePending ? "Submitting..." : "Submit report"}
        </button>
        {disputeSubmitted ? <p className="text-sm text-emerald-700">Thanks — an officer will review this.</p> : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
