"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
};

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusBadgeClass(status: string): string {
  if (status === "PAID") return "bg-emerald-100 text-emerald-800";
  if (status === "APPROVED") return "bg-sky-100 text-sky-800";
  if (status === "REJECTED") return "bg-red-100 text-red-800";
  if (status === "UNDER_REVIEW") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

interface BudgetLineView {
  id: string;
  name: string;
  categoryName: string | null;
  plannedAmount: number;
  actualAmount: number;
  variance: number;
}

interface ReimbursementView {
  id: string;
  payeeName: string;
  description: string;
  amount: number;
  status: string;
  submittedBy: string;
  submittedByIsViewer: boolean;
  categoryName: string | null;
  eventTitle: string | null;
  committeeName: string | null;
  createdAt: string;
  rejectionReason: string | null;
}

/** PTA-H — treasurer dashboard. The server enforces every workflow rule
 * (transitions, self-approval ban, PAID booking); this component only hides
 * controls the caller cannot use. */
export function PtaFinanceDashboard({
  fiscalYear,
  summary,
  budget,
  reimbursements,
  categories,
  committees,
  events,
  viewer,
}: {
  fiscalYear: string;
  summary: {
    contributionsTotal: number;
    expendituresTotal: number;
    pendingReimbursements: { count: number; total: number };
    approvedUnpaidReimbursements: { count: number; total: number };
  };
  budget: { totals: { planned: number; actual: number; variance: number }; lines: BudgetLineView[] };
  reimbursements: ReimbursementView[];
  categories: { id: string; name: string }[];
  committees: { id: string; name: string }[];
  events: { id: string; title: string }[];
  viewer: { canManageBudget: boolean; canSubmit: boolean; canManageReimbursements: boolean };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Budget add form.
  const [lineName, setLineName] = useState("");
  const [lineCategoryId, setLineCategoryId] = useState("");
  const [linePlanned, setLinePlanned] = useState("");

  // Reimbursement submit form.
  const [showSubmit, setShowSubmit] = useState(false);
  const [payeeName, setPayeeName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [eventId, setEventId] = useState("");
  const [committeeId, setCommitteeId] = useState("");

  // Per-row action state.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");

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

  async function submitReimbursement() {
    const ok = await call("/api/reimbursements", {
      method: "POST",
      body: JSON.stringify({
        payeeName: payeeName.trim(),
        description: description.trim(),
        amount: Number(amount),
        categoryId: categoryId || null,
        eventId: eventId || null,
        committeeId: committeeId || null,
      }),
    });
    if (ok) {
      setShowSubmit(false);
      setPayeeName("");
      setDescription("");
      setAmount("");
      setCategoryId("");
      setEventId("");
      setCommitteeId("");
      router.refresh();
    }
  }

  async function transition(requestId: string, body: Record<string, unknown>) {
    if (await call(`/api/reimbursements/${requestId}`, { method: "PATCH", body: JSON.stringify(body) })) {
      setRejectingId(null);
      setRejectReason("");
      setPayingId(null);
      setPaymentReference("");
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  const td = "py-2 pr-4 text-slate-800";
  const th = "py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

  const net = summary.contributionsTotal - summary.expendituresTotal;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-4">
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xl font-bold text-slate-900">{money(summary.contributionsTotal)}</p>
          <p className="text-xs text-slate-500">income (contributions)</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xl font-bold text-slate-900">{money(summary.expendituresTotal)}</p>
          <p className="text-xs text-slate-500">spending</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className={`text-xl font-bold ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{money(net)}</p>
          <p className="text-xs text-slate-500">net this year</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-4 py-3">
          <p className="text-xl font-bold text-amber-800">
            {summary.pendingReimbursements.count} / {money(summary.pendingReimbursements.total)}
          </p>
          <p className="text-xs text-amber-700">reimbursements awaiting review</p>
        </div>
        <div className="rounded-xl bg-sky-50 px-4 py-3">
          <p className="text-xl font-bold text-sky-800">
            {summary.approvedUnpaidReimbursements.count} / {money(summary.approvedUnpaidReimbursements.total)}
          </p>
          <p className="text-xs text-sky-700">approved, not yet paid</p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Budget vs. actual — {fiscalYear}</h3>
        {budget.lines.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No budget lines yet{viewer.canManageBudget ? " — add your first below." : "."}</p>
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
                      {viewer.canManageBudget ? (
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
        {viewer.canManageBudget ? (
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
              Link a line to an expenditure category and its Actual column fills itself from the ledger (including paid reimbursements).
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Reimbursements</h3>
          {viewer.canSubmit ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowSubmit((value) => !value)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {showSubmit ? "Cancel" : "Request reimbursement"}
            </button>
          ) : null}
        </div>

        {showSubmit ? (
          <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Pay back to</span>
              <input value={payeeName} onChange={(event) => setPayeeName(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Amount ($)</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min={0.01} step="0.01" className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
              <span>What was purchased and why</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Category</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={inputClass}>
                <option value="">—</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Event (optional)</span>
              <select value={eventId} onChange={(event) => setEventId(event.target.value)} className={inputClass}>
                <option value="">—</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Committee (optional)</span>
              <select value={committeeId} onChange={(event) => setCommitteeId(event.target.value)} className={inputClass}>
                <option value="">—</option>
                {committees.map((committee) => (
                  <option key={committee.id} value={committee.id}>
                    {committee.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                disabled={pending || !payeeName.trim() || !description.trim() || !amount || Number(amount) <= 0}
                onClick={submitReimbursement}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Submit request
              </button>
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Attach receipts after submitting (from the request row). Approval is always by a different officer than the submitter.
            </p>
          </div>
        ) : null}

        {reimbursements.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No reimbursement requests{viewer.canManageReimbursements ? "." : " of yours yet."}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reimbursements.map((row) => (
              <li key={row.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {money(row.amount)} to {row.payeeName}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {row.submittedBy}
                      {row.submittedByIsViewer ? " (you)" : ""} · {new Date(row.createdAt).toLocaleDateString()}
                      {row.categoryName ? ` · ${row.categoryName}` : ""}
                      {row.eventTitle ? ` · ${row.eventTitle}` : ""}
                      {row.committeeName ? ` · ${row.committeeName}` : ""}
                    </p>
                  </div>
                  {viewer.canManageReimbursements && (row.status === "SUBMITTED" || row.status === "UNDER_REVIEW" || row.status === "APPROVED") ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {row.status === "SUBMITTED" ? (
                        <button type="button" disabled={pending} onClick={() => transition(row.id, { status: "UNDER_REVIEW" })} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
                          Start review
                        </button>
                      ) : null}
                      {row.status !== "APPROVED" ? (
                        <button
                          type="button"
                          disabled={pending || row.submittedByIsViewer}
                          title={row.submittedByIsViewer ? "You cannot approve your own request." : undefined}
                          onClick={() => transition(row.id, { status: "APPROVED" })}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      ) : (
                        <button type="button" disabled={pending} onClick={() => setPayingId(payingId === row.id ? null : row.id)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                          Mark paid
                        </button>
                      )}
                      <button type="button" disabled={pending} onClick={() => setRejectingId(rejectingId === row.id ? null : row.id)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-700">{row.description}</p>
                {row.status === "REJECTED" && row.rejectionReason ? (
                  <p className="mt-1 text-xs font-medium text-red-700">Rejected: {row.rejectionReason}</p>
                ) : null}
                {rejectingId === row.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Reason (required)" className={inputClass + " w-80"} />
                    <button
                      type="button"
                      disabled={pending || !rejectReason.trim()}
                      onClick={() => transition(row.id, { status: "REJECTED", rejectionReason: rejectReason.trim() })}
                      className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      Confirm reject
                    </button>
                  </div>
                ) : null}
                {payingId === row.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Check # / reference (optional)" className={inputClass + " w-80"} />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => transition(row.id, { status: "PAID", paymentReference: paymentReference.trim() || null })}
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Confirm paid — books the expense
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
