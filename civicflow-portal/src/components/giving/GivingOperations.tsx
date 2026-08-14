"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  CHECK: "Check",
  ACH: "Bank transfer (ACH)",
  ZELLE: "Zelle",
  CASH_APP: "Cash App",
  VENMO: "Venmo",
  PAYPAL: "PayPal",
  ZEFFY: "Zeffy",
};

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface ReconItem {
  classification: string;
  kind: string;
  description: string;
  reference: string;
}

/** CORE-GIVE-F — offline entry + corrections + reconciliation. The server
 * enforces every rule; reconciliation is read-only by design. */
export function GivingOperations({
  funds,
  members,
  recent,
  canReconcile,
}: {
  funds: { id: string; name: string }[];
  members: { id: string; name: string }[];
  recent: {
    id: string;
    contributionNumber: string | null;
    amount: number;
    date: string;
    method: string;
    attribution: string;
    fundName: string;
    voided: boolean;
  }[];
  canReconcile: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CHECK");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memberId, setMemberId] = useState("");
  const [contributorName, setContributorName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");

  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctReason, setCorrectReason] = useState("");
  const [correctAmount, setCorrectAmount] = useState("");

  const [recon, setRecon] = useState<ReconItem[] | null>(null);
  const [stmtYear, setStmtYear] = useState(new Date().getFullYear());
  const [stmtData, setStmtData] = useState<{
    exceptions: { kind: string; description: string; count: number }[];
    statements: { id: string; subject: string; version: number; status: string; total: number }[];
  } | null>(null);

  async function record() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/giving/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId,
          amount: Number(amount),
          method,
          contributionDate: date,
          memberId: memberId || null,
          contributorName: contributorName.trim() || null,
          anonymous,
          reference: reference.trim() || null,
          memo: memo.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to record the contribution.");
        return;
      }
      setNotice(`Recorded ${data.data.contributionNumber ?? ""} — ${money(Number(data.data.amount))}.`);
      setAmount("");
      setReference("");
      setMemo("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function correct(row: { id: string; amount: number; fundName: string }) {
    setPending(true);
    setError(null);
    try {
      const fund = funds.find((candidate) => candidate.name === row.fundName) ?? funds[0];
      const res = await fetch(`/api/giving/offline/${row.id}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: correctReason.trim(),
          corrected: {
            fundId: fund?.id,
            amount: Number(correctAmount),
            method,
            contributionDate: date,
            memberId: memberId || null,
            contributorName: contributorName.trim() || null,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to correct the contribution.");
        return;
      }
      setCorrectingId(null);
      setCorrectReason("");
      setNotice("Corrected — the original is voided and preserved; the replacement is linked.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function loadStatements(year: number) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/giving/statements?year=${year}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to load statements.");
        return;
      }
      setStmtData({ exceptions: data.data.exceptions, statements: data.data.statements });
    } finally {
      setPending(false);
    }
  }

  async function bulkGenerate(year: number) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, all: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to generate statements.");
        return;
      }
      setNotice(`Prepared ${data.data.generated} statement(s); ${data.data.skipped} already current. Nothing was emailed.`);
      await loadStatements(year);
    } finally {
      setPending(false);
    }
  }

  async function runReconciliation() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/reconciliation");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to run reconciliation.");
        return;
      }
      setRecon(data.data.items as ReconItem[]);
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-slate-900">Record an offline contribution</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Fund</span>
            <select value={fundId} onChange={(event) => setFundId(event.target.value)} className={inputClass}>
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Amount ($)</span>
            <input type="number" min={0.01} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass}>
              {Object.entries(METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Date received</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Member (optional)</span>
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)} disabled={anonymous} className={inputClass}>
              <option value="">—</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Or contributor name</span>
            <input value={contributorName} onChange={(event) => setContributorName(event.target.value)} disabled={anonymous} className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="h-4 w-4" />
            <span>Anonymous (name hidden from public displays; finance staff can still see this entry)</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Check # / reference (optional)</span>
            <input value={reference} onChange={(event) => setReference(event.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Memo (optional)</span>
            <input value={memo} onChange={(event) => setMemo(event.target.value)} className={inputClass} />
          </label>
        </div>
        <button
          type="button"
          disabled={pending || !fundId || !(Number(amount) > 0)}
          onClick={record}
          className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Record contribution
        </button>
      </section>

      <section className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Recent offline entries</h3>
        {recent.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {recent.map((row) => (
              <li key={row.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={row.voided ? "text-slate-400 line-through" : "text-slate-800"}>
                    {new Date(row.date).toLocaleDateString()} — {row.attribution} — {row.fundName} —{" "}
                    {METHOD_LABELS[row.method] ?? row.method}
                    {row.contributionNumber ? <span className="ml-2 font-mono text-xs text-slate-400">{row.contributionNumber}</span> : null}
                    {row.voided ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">voided</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{money(row.amount)}</span>
                    {!row.voided ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectingId(correctingId === row.id ? null : row.id);
                          setCorrectAmount(String(row.amount));
                        }}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Correct
                      </button>
                    ) : null}
                  </span>
                </div>
                {correctingId === row.id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>Corrected amount ($)</span>
                      <input type="number" min={0.01} step="0.01" value={correctAmount} onChange={(event) => setCorrectAmount(event.target.value)} className={inputClass + " w-32"} />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>Reason (required)</span>
                      <input value={correctReason} onChange={(event) => setCorrectReason(event.target.value)} className={inputClass + " w-72"} />
                    </label>
                    <button
                      type="button"
                      disabled={pending || !correctReason.trim() || !(Number(correctAmount) > 0)}
                      onClick={() => correct(row)}
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Void &amp; replace
                    </button>
                    <p className="w-full text-xs text-slate-500">
                      The original entry stays on record as voided with your reason; the replacement links back to it.
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>


      <section className="border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Annual statements</h3>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={2000}
              max={2100}
              value={stmtYear}
              onChange={(event) => setStmtYear(Number(event.target.value))}
              className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              aria-label="Statement year"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => loadStatements(stmtYear)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              Check exceptions
            </button>
            <button
              type="button"
              disabled={pending || stmtData === null}
              onClick={() => bulkGenerate(stmtYear)}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Prepare statements
            </button>
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Preparing generates PDFs only — nothing is emailed. Members can download their own statement from their Giving page.
        </p>
        {stmtData ? (
          <div className="mt-2 space-y-2">
            {stmtData.exceptions.length > 0 ? (
              <ul className="space-y-1">
                {stmtData.exceptions.map((exception) => (
                  <li key={exception.kind} className="text-sm font-medium text-amber-800">
                    ⚠ {exception.description} ({exception.count})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm font-medium text-emerald-700">No exceptions — ready to prepare.</p>
            )}
            {stmtData.statements.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {stmtData.statements.map((statement) => (
                  <li key={statement.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className={statement.status === "SUPERSEDED" ? "text-slate-400" : "text-slate-800"}>
                      {statement.subject} · v{statement.version}
                      {statement.status === "SUPERSEDED" ? " (superseded)" : ""} — {money(statement.total)}
                    </span>
                    <a
                      href={`/api/giving/statements/${statement.id}/download`}
                      className="text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {canReconcile ? (
        <section className="border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Reconciliation</h3>
            <button
              type="button"
              disabled={pending}
              onClick={runReconciliation}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              Run reconciliation
            </button>
          </div>
          <p className="text-xs text-slate-500">Read-only: discrepancies are named for review, never auto-corrected.</p>
          {recon !== null ? (
            recon.length === 0 ? (
              <p className="mt-2 text-sm font-medium text-emerald-700">Everything matches. No discrepancies found.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {recon.map((item, index) => (
                  <li key={`${item.kind}-${index}`} className="text-sm">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        item.classification === "PROVIDER_ONLY"
                          ? "bg-red-100 text-red-800"
                          : item.classification === "UNESTRA_ONLY"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-sky-100 text-sky-800"
                      }`}
                    >
                      {item.classification.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <span className="text-slate-800">{item.description}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      ) : null}

      {notice ? <p className="text-sm font-medium text-emerald-700">{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
