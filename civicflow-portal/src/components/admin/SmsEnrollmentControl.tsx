"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SMS_ENROLLMENT_QUOTA,
  SMS_ENROLLMENT_REASON_MAX_LENGTH,
  createEnrollmentSubmitter,
  resolveEnrollmentMode,
  type EnrollmentActionMode,
  type EnrollmentSubmitter,
} from "@/lib/sms-admin-enrollment";

export interface EnrollmentControlOrg {
  id: string;
  name: string;
  billingExempt: boolean;
  smsAddOnActive: boolean;
  smsMonthlyLimit: number;
}

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * The confirmation dialog for a billing-exempt enable/disable transition.
 * Accessible: role="dialog" + aria-modal, labelled/described, first field
 * focused on open, Escape + focus-trap on Tab, server/field errors announced
 * via role="alert". Submits the canonical PUT exactly once; on error it keeps
 * the dialog (and the entered reason/quota) so nothing is retyped.
 */
function EnrollmentDialog({
  org,
  mode,
  onClose,
}: {
  org: EnrollmentControlOrg;
  mode: EnrollmentActionMode;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const descId = useId();
  const reasonErrId = useId();
  const quotaErrId = useId();
  const formErrId = useId();

  const [reason, setReason] = useState("");
  const [quota, setQuota] = useState(mode === "enable" ? String(DEFAULT_SMS_ENROLLMENT_QUOTA) : "");
  const [submitting, setSubmitting] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  // One coordinator per open dialog. It owns the SYNCHRONOUS in-flight lock
  // that actually prevents a double-submit (the `submitting` state below is
  // async and only drives the visible disabled/loading UI).
  const submitterRef = useRef<EnrollmentSubmitter | null>(null);
  if (submitterRef.current === null) submitterRef.current = createEnrollmentSubmitter(mode);

  useEffect(() => {
    // Focus the first field when the dialog opens (quota in enable mode, the
    // reason textarea in disable mode).
    getFocusable(dialogRef.current)[0]?.focus();
  }, []);

  function requestClose() {
    if (submitting) return;
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = getFocusable(dialogRef.current);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Clear prior errors for this attempt; the coordinator re-populates field
    // errors via onValidationError if the input is still invalid.
    setReasonError(null);
    setQuotaError(null);
    setFormError(null);

    // The coordinator owns the synchronous in-flight lock: a second call in
    // the same tick returns "skipped" before issuing any request. On error it
    // releases the lock (leaving the dialog open with the entered reason/quota
    // intact) so the admin can correct and retry. Never reads the response
    // body (which could carry a Stripe subscription-item id) — success just
    // refreshes and closes.
    await submitterRef.current!.submit(
      { reason, quota },
      {
        request: async (payload) => {
          const res = await fetch(`/api/admin/sms/organizations/${org.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => null);
          return { ok: Boolean(res.ok && data?.ok), error: data?.error };
        },
        onStart: () => setSubmitting(true),
        onSuccess: () => {
          router.refresh();
          onClose();
        },
        onServerError: (message) => {
          setFormError(message);
          setSubmitting(false);
        },
        onNetworkError: (message) => {
          setFormError(message);
          setSubmitting(false);
        },
        onValidationError: (validation) => {
          setReasonError(validation.reasonError ?? null);
          setQuotaError(validation.quotaError ?? null);
        },
      }
    );
  }

  const isEnable = mode === "enable";
  const heading = isEnable ? `Enable SMS add-on for ${org.name}` : `Disable SMS add-on for ${org.name}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {heading}
        </h2>

        <p id={descId} className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {isEnable ? (
            <>
              This is a <strong>billing-exempt administrative enrollment</strong>. It grants the SMS add-on directly and
              will <strong>not</strong> create any Stripe subscription, invoice, or charge.
            </>
          ) : (
            <>
              Disabling <strong>immediately blocks new SMS sends and retries</strong> for this organization. Existing
              usage counts and billing-period history are <strong>preserved</strong>, not erased.
            </>
          )}
        </p>

        {formError ? (
          <div
            id={formErrId}
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
          {isEnable ? (
            <div>
              <label htmlFor={`${titleId}-quota`} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                Monthly message quota
              </label>
              <input
                id={`${titleId}-quota`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
                disabled={submitting}
                aria-invalid={quotaError ? true : undefined}
                aria-describedby={quotaError ? quotaErrId : undefined}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Defaults to {DEFAULT_SMS_ENROLLMENT_QUOTA.toLocaleString()} messages/month. Sending pauses when the
                allowance is reached (hard stop).
              </p>
              {quotaError ? (
                <p id={quotaErrId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                  {quotaError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <label htmlFor={`${titleId}-reason`} className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              Audit reason
            </label>
            <textarea
              id={`${titleId}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              rows={3}
              maxLength={SMS_ENROLLMENT_REASON_MAX_LENGTH}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? reasonErrId : undefined}
              placeholder={isEnable ? "Why this org is being enrolled (recorded in the audit log)" : "Why the add-on is being disabled (recorded in the audit log)"}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Required. Up to {SMS_ENROLLMENT_REASON_MAX_LENGTH} characters. Stored on the audit event.
            </p>
            {reasonError ? (
              <p id={reasonErrId} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                {reasonError}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={submitting}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${
                isEnable ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-700 hover:bg-red-800"
              }`}
            >
              {submitting ? (isEnable ? "Enabling…" : "Disabling…") : isEnable ? "Enable add-on" : "Disable add-on"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * The per-row SMS enrollment control shown in the super-admin SMS
 * Organizations table. Context-aware:
 *   - paid (non-exempt) org  → a truthful "Managed through organization
 *     billing" status with a pointer to the billing flow, and NO super-admin
 *     enable/disable button (the API would reject a fresh activation, and this
 *     route never touches Stripe).
 *   - billing-exempt, inactive → an "Enable" button opening the confirmation
 *     form (reason + positive quota).
 *   - billing-exempt, active   → a "Disable" button opening the confirmation
 *     (reason + hard-stop warning).
 * Never renders a Stripe identifier.
 */
export function SmsEnrollmentControl({ org }: { org: EnrollmentControlOrg }) {
  const mode = resolveEnrollmentMode(org);
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setDialogOpen(false);
    // Return focus to the control that opened the dialog.
    triggerRef.current?.focus();
  }

  if (mode === "managed_by_billing") {
    return (
      <div className="text-xs text-slate-600 dark:text-slate-300">
        <span className="font-medium text-slate-700 dark:text-slate-200">Managed through organization billing</span>
        <p className="mt-0.5 text-slate-500 dark:text-slate-400">
          Paid orgs add SMS through Settings → Billing (subscription-backed). Not enrollable here.
        </p>
      </div>
    );
  }

  const isEnable = mode === "enable";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setDialogOpen(true)}
        className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${
          isEnable ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
        }`}
      >
        {isEnable ? "Enable" : "Disable"}
      </button>
      {dialogOpen ? <EnrollmentDialog org={org} mode={isEnable ? "enable" : "disable"} onClose={closeDialog} /> : null}
    </>
  );
}
