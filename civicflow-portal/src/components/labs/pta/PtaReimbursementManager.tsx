"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AttachmentManager } from "@/components/forms/AttachmentManager";

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
  VOIDED: "Voided",
  REVERSED: "Reversed",
};

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusBadgeClass(status: string): string {
  if (status === "PAID") return "bg-emerald-100 text-emerald-800";
  if (status === "APPROVED") return "bg-sky-100 text-sky-800";
  if (status === "REJECTED" || status === "REVERSED") return "bg-red-100 text-red-800";
  if (status === "VOIDED") return "bg-slate-200 text-slate-600";
  if (status === "UNDER_REVIEW") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
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

interface PaymentMethodOption {
  id: string;
  method: string;
  label: string;
}

/** feature/pta-treasurer-expenditure-experience (E1) — extracted unchanged
 * from the original PtaFinanceDashboard's reimbursement section (same
 * markup, same server-enforced workflow rules, same /api/reimbursements
 * calls); now its own Reimbursements section. Adds ?highlight=<id> support
 * so the Expenditures tab's "Created from reimbursement" link has somewhere
 * safe (organization-scoped, read-only) to land on. */
export function PtaReimbursementManager({
  reimbursements,
  categories,
  committees,
  events,
  paymentMethods,
  viewer,
}: {
  reimbursements: ReimbursementView[];
  categories: { id: string; name: string }[];
  committees: { id: string; name: string }[];
  events: { id: string; title: string }[];
  paymentMethods: PaymentMethodOption[];
  viewer: { canManageBudget: boolean; canSubmit: boolean; canManageReimbursements: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightRef = useRef<HTMLLIElement | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSubmit, setShowSubmit] = useState(false);
  const [payeeName, setPayeeName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [eventId, setEventId] = useState("");
  const [committeeId, setCommitteeId] = useState("");

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionAction, setCorrectionAction] = useState<"VOIDED" | "REVERSED">("VOIDED");
  const [correctionReason, setCorrectionReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [receiptsOpenId, setReceiptsOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightId]);

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
      setPaymentMethodId("");
      setCorrectingId(null);
      setCorrectionReason("");
      setConfirmText("");
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
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
            <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min={0} step="0.01" className={inputClass} />
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
            After submitting, use the &ldquo;Receipts&rdquo; button on your request to attach a receipt or invoice (PDF, JPEG, PNG, or HEIC). Approval is always by a different officer than the submitter.
          </p>
        </div>
      ) : null}

      {reimbursements.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No reimbursement requests{viewer.canManageReimbursements ? "." : " of yours yet."}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {reimbursements.map((row) => (
            <li
              key={row.id}
              ref={row.id === highlightId ? highlightRef : undefined}
              className={`rounded-xl border p-3 ${row.id === highlightId ? "border-sky-400 ring-2 ring-sky-200" : "border-slate-200"}`}
            >
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
                      <button
                        type="button"
                        disabled={pending || row.submittedByIsViewer}
                        title={row.submittedByIsViewer ? "You cannot mark your own request paid." : undefined}
                        onClick={() => setPayingId(payingId === row.id ? null : row.id)}
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Mark paid
                      </button>
                    )}
                    <button type="button" disabled={pending} onClick={() => setRejectingId(rejectingId === row.id ? null : row.id)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                ) : null}
                {viewer.canManageReimbursements && row.status === "PAID" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={pending || row.submittedByIsViewer}
                      title={row.submittedByIsViewer ? "You cannot correct your own request." : undefined}
                      onClick={() => {
                        setCorrectionAction("VOIDED");
                        setCorrectingId(correctingId === row.id && correctionAction === "VOIDED" ? null : row.id);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Void
                    </button>
                    <button
                      type="button"
                      disabled={pending || row.submittedByIsViewer}
                      title={row.submittedByIsViewer ? "You cannot correct your own request." : undefined}
                      onClick={() => {
                        setCorrectionAction("REVERSED");
                        setCorrectingId(correctingId === row.id && correctionAction === "REVERSED" ? null : row.id);
                      }}
                      className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reverse
                    </button>
                  </div>
                ) : null}
                {row.submittedByIsViewer || viewer.canManageReimbursements ? (
                  <button
                    type="button"
                    onClick={() => setReceiptsOpenId(receiptsOpenId === row.id ? null : row.id)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {receiptsOpenId === row.id ? "Hide receipts" : "Receipts"}
                  </button>
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
                  <select value={paymentMethodId} onChange={(event) => setPaymentMethodId(event.target.value)} className={inputClass + " w-56"}>
                    <option value="">How was this paid?</option>
                    {paymentMethods.map((methodOption) => (
                      <option key={methodOption.id} value={methodOption.id}>
                        {methodOption.label}
                      </option>
                    ))}
                  </select>
                  <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Check # / reference (optional)" className={inputClass + " w-64"} />
                  <button
                    type="button"
                    disabled={pending || !paymentMethodId}
                    onClick={() => transition(row.id, { status: "PAID", paymentMethodId, paymentReference: paymentReference.trim() || null })}
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    Confirm paid — books the expense
                  </button>
                  {paymentMethods.length === 0 ? (
                    <p className="w-full text-xs text-red-700">No active payment methods are configured for this organization yet — add one under Settings before marking reimbursements paid.</p>
                  ) : null}
                  <p className="w-full text-xs text-slate-500">Unestra does not process this payment — this records that it was paid outside Unestra.</p>
                </div>
              ) : null}
              {correctingId === row.id ? (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-600">
                    {correctionAction === "VOIDED"
                      ? "Use Void when this was marked paid by mistake and the external payment never happened."
                      : "Use Reverse when the external payment happened but was later cancelled, returned, or recovered outside Unestra. Unestra does not claim to have recovered the money itself."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Reason (required)" className={inputClass + " w-72"} />
                    <input
                      value={confirmText}
                      onChange={(event) => setConfirmText(event.target.value)}
                      placeholder={`Type ${correctionAction === "VOIDED" ? "VOID" : "REVERSE"} to confirm`}
                      className={inputClass + " w-56"}
                    />
                    <button
                      type="button"
                      disabled={pending || !correctionReason.trim() || confirmText !== (correctionAction === "VOIDED" ? "VOID" : "REVERSE")}
                      onClick={() => transition(row.id, { status: correctionAction, correctionReason: correctionReason.trim(), confirmText })}
                      className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {correctionAction === "VOIDED" ? "Confirm void" : "Confirm reversal"}
                    </button>
                  </div>
                </div>
              ) : null}
              {row.status === "VOIDED" || row.status === "REVERSED" ? (
                <p className="mt-1 text-xs font-medium text-slate-600">{STATUS_LABELS[row.status]} — see audit history for who and when.</p>
              ) : null}
              {receiptsOpenId === row.id ? (
                <div className="mt-3 rounded-lg border border-slate-200 p-3">
                  <AttachmentManager
                    entityType="REIMBURSEMENT"
                    entityId={row.id}
                    canWrite={row.submittedByIsViewer || viewer.canManageReimbursements}
                    titleLabel="Receipt title"
                  />
                </div>
              ) : null}
            </li>
          ))}
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
