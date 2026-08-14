"use client";

import { useState } from "react";

const REPORT_LABELS: { value: string; label: string; individual: boolean }[] = [
  { value: "summary", label: "Contribution Summary (monthly)", individual: false },
  { value: "by-fund", label: "Contributions by Fund", individual: false },
  { value: "by-program", label: "Contributions by Program", individual: false },
  { value: "methods", label: "Contribution Methods", individual: false },
  { value: "year-over-year", label: "Year-over-Year Giving", individual: false },
  { value: "recurring", label: "Recurring Giving", individual: true },
  { value: "pledge-progress", label: "Pledge Progress", individual: true },
  { value: "failures", label: "Payment Failures", individual: true },
  { value: "refunds", label: "Refunds", individual: true },
  { value: "offline", label: "Offline Contributions", individual: true },
];

/** CORE-GIVE-K (§52) — report runner. The server enforces every permission;
 * this component only hides what the viewer cannot use. */
export function GivingReports({
  funds,
  viewer,
}: {
  funds: { id: string; name: string }[];
  viewer: { canSeeIndividual: boolean; canExport: boolean };
}) {
  const year = new Date().getFullYear();
  const [type, setType] = useState("summary");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year + 1}-01-01`);
  const [fundId, setFundId] = useState("");
  const [report, setReport] = useState<{ columns: string[]; rows: (string | number)[][] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = () =>
    `/api/giving/reports?type=${encodeURIComponent(type)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${
      fundId ? `&fundId=${encodeURIComponent(fundId)}` : ""
    }`;

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(query());
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to run the report.");
        return;
      }
      setReport(data.data);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const options = REPORT_LABELS.filter((option) => !option.individual || viewer.canSeeIndividual);
  const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950";

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Report</span>
          <select value={type} onChange={(event) => setType(event.target.value)} className={`${inputClass} block w-64`}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={`${inputClass} block`} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>To (exclusive)</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={`${inputClass} block`} />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Fund</span>
          <select value={fundId} onChange={(event) => setFundId(event.target.value)} className={`${inputClass} block w-48`}>
            <option value="">All funds</option>
            {funds.map((fund) => (
              <option key={fund.id} value={fund.id}>
                {fund.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={run}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Run
        </button>
        {viewer.canExport && report ? (
          <a
            href={`${query()}&format=csv`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            Export CSV
          </a>
        ) : null}
      </div>

      {report ? (
        report.rows.length === 0 ? (
          <p className="text-sm text-slate-600">No data in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr>
                  {report.columns.map((column) => (
                    <th key={column} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 text-slate-800">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
