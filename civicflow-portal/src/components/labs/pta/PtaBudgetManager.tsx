"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface BudgetLineView {
  id: string;
  name: string;
  categoryName: string | null;
  plannedAmount: number;
  actualAmount: number;
  variance: number;
}

/** feature/pta-treasurer-expenditure-experience (E1) — extracted unchanged
 * from the original PtaFinanceDashboard's budget section (same markup, same
 * behavior, same /api/budget calls); now its own Budget section. Adds one
 * link into the new Expenditures tab, since actuals now have somewhere to
 * drill into. */
export function PtaBudgetManager({
  fiscalYear,
  budget,
  categories,
  canManageBudget,
}: {
  fiscalYear: string;
  budget: { totals: { planned: number; actual: number; variance: number }; lines: BudgetLineView[] };
  categories: { id: string; name: string }[];
  canManageBudget: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineName, setLineName] = useState("");
  const [lineCategoryId, setLineCategoryId] = useState("");
  const [linePlanned, setLinePlanned] = useState("");

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

  async function addBudgetLine() {
    const planned = Number(linePlanned);
    const ok = await call("/api/budget", {
      method: "POST",
      body: JSON.stringify({ fiscalYear, name: lineName.trim(), categoryId: lineCategoryId || null, plannedAmount: planned }),
    });
    if (ok) {
      setLineName("");
      setLineCategoryId("");
      setLinePlanned("");
      router.refresh();
    }
  }

  async function deactivateLine(lineId: string) {
    if (await call(`/api/budget/${lineId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })) {
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  const td = "py-2 pr-4 text-slate-800";
  const th = "py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Budget vs. actual — {fiscalYear}</h3>
      {budget.lines.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">No budget lines yet{canManageBudget ? " — add your first below." : "."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr>
                <th className={th}>Line</th>
                <th className={th}>Category</th>
                <th className={th}>Budget</th>
                <th className={th}>Actual</th>
                <th className={th}>Variance</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {budget.lines.map((line) => (
                <tr key={line.id}>
                  <td className={`${td} font-medium text-slate-900`}>{line.name}</td>
                  <td className={td}>{line.categoryName ?? "—"}</td>
                  <td className={td}>{money(line.plannedAmount)}</td>
                  <td className={td}>{money(line.actualAmount)}</td>
                  <td className={`${td} font-semibold ${line.variance >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(line.variance)}</td>
                  <td className="py-2 text-right">
                    {canManageBudget ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => deactivateLine(line.id)}
                        className="text-xs font-semibold text-slate-400 hover:text-red-700 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className={td}>Total</td>
                <td className={td} />
                <td className={td}>{money(budget.totals.planned)}</td>
                <td className={td}>{money(budget.totals.actual)}</td>
                <td className={`${td} ${budget.totals.variance >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(budget.totals.variance)}</td>
                <td className="py-2" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {canManageBudget ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Line name</span>
            <input value={lineName} onChange={(event) => setLineName(event.target.value)} placeholder="Teacher Appreciation" className={inputClass + " w-56"} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Category (for actuals)</span>
            <select value={lineCategoryId} onChange={(event) => setLineCategoryId(event.target.value)} className={inputClass + " w-56"}>
              <option value="">— none —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Budget ($)</span>
            <input value={linePlanned} onChange={(event) => setLinePlanned(event.target.value)} type="number" min={0} step="0.01" className={inputClass + " w-32"} />
          </label>
          <button
            type="button"
            disabled={pending || !lineName.trim() || linePlanned === "" || Number(linePlanned) < 0}
            onClick={addBudgetLine}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Add line
          </button>
          <p className="w-full text-xs text-slate-500">
            Link a line to an expenditure category and its Actual column fills itself from the ledger (including paid reimbursements) — see the{" "}
            <Link href="/labs/pta/finance/expenditures" className="font-semibold text-emerald-700 hover:underline">
              Expenditures
            </Link>{" "}
            tab for the underlying records.
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
