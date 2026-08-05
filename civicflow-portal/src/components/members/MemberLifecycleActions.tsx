"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TERMINATION_REASONS } from "@/lib/member-lifecycle-reasons";

type FieldErrors = Record<string, string[]>;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-lifecycle-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="member-lifecycle-dialog-title" className="text-lg font-semibold text-slate-950">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function TerminateMemberButton({ memberId, memberName }: { memberId: string; memberName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate());
  const [internalNotes, setInternalNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
    setFieldErrors({});
  }

  async function submit() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/members/${memberId}/terminate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode, reasonOther: reasonOther || undefined, effectiveDate, internalNotes: internalNotes || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to terminate this member.");
        setFieldErrors(data?.details?.fieldErrors ?? {});
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
      >
        Terminate Membership
      </button>
      {open ? (
        <Modal title={`Terminate ${memberName}'s membership`} onClose={close}>
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              This ends the member&apos;s active status and, if they have app login access in this organization, suspends
              that access. Historical dues, contributions, and activity records are preserved.
            </p>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Reason</span>
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a reason…</option>
                {TERMINATION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {fieldErrors.reasonCode ? <p className="text-sm text-red-700">{fieldErrors.reasonCode[0]}</p> : null}
            </label>
            {reasonCode === "OTHER" ? (
              <label className="block space-y-1 text-sm font-medium text-slate-900">
                <span>Describe the reason</span>
                <textarea
                  value={reasonOther}
                  onChange={(e) => setReasonOther(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                {fieldErrors.reasonOther ? <p className="text-sm text-red-700">{fieldErrors.reasonOther[0]}</p> : null}
              </label>
            ) : null}
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Effective date</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {fieldErrors.effectiveDate ? <p className="text-sm text-red-700">{fieldErrors.effectiveDate[0]}</p> : null}
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Internal notes (optional, staff-only)</span>
              <textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !reasonCode || !effectiveDate}
                className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {pending ? "Terminating…" : "Terminate"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function ReinstateMemberButton({ memberId, memberName }: { memberId: string; memberName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate());
  const [internalNotes, setInternalNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
    setFieldErrors({});
  }

  async function submit() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/members/${memberId}/reinstate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, effectiveDate, internalNotes: internalNotes || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to reinstate this member.");
        setFieldErrors(data?.details?.fieldErrors ?? {});
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
      >
        Reinstate Membership
      </button>
      {open ? (
        <Modal title={`Reinstate ${memberName}'s membership`} onClose={close}>
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              This restores the member to active status. It does not automatically restore app login access — grant
              that separately from Settings → Users &amp; Roles if this member previously had it.
            </p>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Reason</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {fieldErrors.reason ? <p className="text-sm text-red-700">{fieldErrors.reason[0]}</p> : null}
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Effective date</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {fieldErrors.effectiveDate ? <p className="text-sm text-red-700">{fieldErrors.effectiveDate[0]}</p> : null}
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Internal notes (optional, staff-only)</span>
              <textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !reason.trim() || !effectiveDate}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {pending ? "Reinstating…" : "Reinstate"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
