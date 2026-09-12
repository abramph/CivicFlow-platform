/**
 * Pure, framework-free logic for the super-admin SMS add-on enrollment UI.
 *
 * The super-admin "SMS Administration → Organizations" screen enrolls and
 * un-enrolls organizations in the SMS add-on through the canonical
 * `PUT /api/admin/sms/organizations/[id]` route. That route enforces a strict
 * contract (see its docstring):
 *   - it may only NEWLY activate the add-on for `billingExempt` organizations
 *     (paid orgs must go through the Stripe subscription-item flow);
 *   - any activate/deactivate transition requires a non-empty, trimmed
 *     `reason` (audited);
 *   - an activation must yield a positive monthly quota.
 *
 * All of the client's decisions that need to mirror that contract live here as
 * pure functions so they can be unit-tested without a DOM and reused by the
 * React control without drifting from the server. This module is safe to
 * import from a client component: it has no server-only, Prisma, or Node
 * dependencies.
 */

/** Mirrors the server's `reason: z.string().max(500)` bound so the textarea and
 *  the client-side check reject before a doomed round-trip. */
export const SMS_ENROLLMENT_REASON_MAX_LENGTH = 500;

/** The quota the enable form pre-fills (visibly, still editable). Matches the
 *  add-on's standard included allowance (SMS_ADDON.includedMessagesPerMonth). */
export const DEFAULT_SMS_ENROLLMENT_QUOTA = 1000;

/**
 * Upper bound on the monthly quota. `OrganizationSmsSettings.smsMonthlyLimit`
 * is a Postgres `Int` (int4), so its hard ceiling is 2,147,483,647 — anything
 * larger would overflow the column on write. This is a storage bound, NOT a
 * business/pricing limit (none is defined); the same value is enforced in the
 * API schema so client and server reject identically.
 */
export const SMS_MAX_MONTHLY_QUOTA = 2_147_483_647;

export type EnrollmentMode = "enable" | "disable" | "managed_by_billing";

export interface EnrollmentOrg {
  billingExempt: boolean;
  smsAddOnActive: boolean;
}

/**
 * Which enrollment control an organization gets:
 *   - non-exempt (paid) org → "managed_by_billing": no super-admin enable/
 *     disable control at all (the API would reject a fresh activation, and
 *     disabling here would desync the Stripe subscription item). The org's
 *     add-on is managed through its own billing.
 *   - exempt + not active → "enable": show the confirmation form.
 *   - exempt + active → "disable": show the disable confirmation.
 */
export function resolveEnrollmentMode(org: EnrollmentOrg): EnrollmentMode {
  if (!org.billingExempt) return "managed_by_billing";
  return org.smsAddOnActive ? "disable" : "enable";
}

/** The two modes that actually submit a transition (have a confirmation form). */
export type EnrollmentActionMode = "enable" | "disable";

export interface EnrollmentFormValues {
  /** Raw textarea value (not yet trimmed). */
  reason: string;
  /** Raw quota input value; only consulted in "enable" mode. */
  quota?: string;
}

export interface EnrollmentValidation {
  ok: boolean;
  reasonError?: string;
  quotaError?: string;
  /** Present only when ok: the trimmed reason. */
  reason?: string;
  /** Present only when ok && mode === "enable": the parsed positive integer. */
  quota?: number;
}

/**
 * Validates a raw quota string. A quota must be a POSITIVE WHOLE NUMBER —
 * zero, negative, decimal, non-numeric, and empty are all rejected. Returns an
 * error message, or null when valid.
 */
export function validateQuota(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter a monthly message quota.";
  // Digits only — rejects a leading "-", a decimal point, whitespace, and letters.
  if (!/^\d+$/.test(trimmed)) return "Quota must be a positive whole number (no decimals, signs, or letters).";
  const value = Number(trimmed);
  // A very long digit string parses to a non-safe integer (and would overflow
  // the int4 column); reject it rather than silently truncating.
  if (!Number.isSafeInteger(value) || value <= 0) return "Quota must be greater than zero.";
  if (value > SMS_MAX_MONTHLY_QUOTA) return `Quota cannot exceed ${SMS_MAX_MONTHLY_QUOTA.toLocaleString()}.`;
  return null;
}

/**
 * Client-side gate mirroring the server contract. In "enable" mode both a
 * reason and a positive-integer quota are required; in "disable" mode only a
 * reason. Never mutates its input; returns per-field errors so the form can
 * keep the user's entries and surface each problem in place.
 */
export function validateEnrollmentForm(mode: EnrollmentActionMode, values: EnrollmentFormValues): EnrollmentValidation {
  const result: EnrollmentValidation = { ok: true };

  const reason = values.reason.trim();
  if (!reason) {
    result.ok = false;
    result.reasonError = "A reason is required.";
  } else if (reason.length > SMS_ENROLLMENT_REASON_MAX_LENGTH) {
    result.ok = false;
    result.reasonError = `Keep the reason to ${SMS_ENROLLMENT_REASON_MAX_LENGTH} characters or fewer.`;
  } else {
    result.reason = reason;
  }

  if (mode === "enable") {
    const quotaError = validateQuota(values.quota ?? "");
    if (quotaError) {
      result.ok = false;
      result.quotaError = quotaError;
    } else {
      result.quota = Number((values.quota ?? "").trim());
    }
  }

  return result;
}

export interface ValidatedEnrollment {
  reason: string;
  /** Required for "enable", absent for "disable". */
  quota?: number;
}

/**
 * Builds the EXACT request body sent to `PUT /api/admin/sms/organizations/[id]`.
 * Intentionally minimal — the canonical route derives everything else — and it
 * never carries a Stripe identifier of any kind:
 *   - enable  → { smsAddOnActive: true,  smsMonthlyLimit, reason }
 *   - disable → { smsAddOnActive: false, reason }
 */
export function buildEnrollmentPayload(mode: EnrollmentActionMode, validated: ValidatedEnrollment): Record<string, unknown> {
  if (mode === "enable") {
    return { smsAddOnActive: true, smsMonthlyLimit: validated.quota, reason: validated.reason };
  }
  return { smsAddOnActive: false, reason: validated.reason };
}

/** True only when no request is in flight. Retained for the button's visible
 *  disabled state; it is NOT the concurrency guard (state is async). The real
 *  guard is the synchronous in-flight lock inside createEnrollmentSubmitter. */
export function canSubmitEnrollment(state: { submitting: boolean }): boolean {
  return !state.submitting;
}

export interface EnrollmentRequestResult {
  ok: boolean;
  error?: string;
}

export interface EnrollmentSubmitDeps {
  /** Performs the actual PUT and reports ok/error. Injected so the coordinator
   *  is testable without a DOM or a real network. */
  request: (payload: Record<string, unknown>) => Promise<EnrollmentRequestResult>;
  /** Show visible loading/disabled state (e.g. setSubmitting(true)). */
  onStart: () => void;
  /** Success: close the modal and refresh the table — called exactly once. */
  onSuccess: () => void;
  /** Server rejected: surface the message, clear loading; modal stays open. */
  onServerError: (message: string) => void;
  /** Network/unexpected failure: surface a message, clear loading. */
  onNetworkError: (message: string) => void;
  /** Client-side validation failed: surface per-field errors; no request made. */
  onValidationError: (validation: EnrollmentValidation) => void;
}

export type EnrollmentSubmitOutcome =
  | { status: "skipped" }
  | { status: "invalid" }
  | { status: "success"; payload: Record<string, unknown> }
  | { status: "server_error"; payload: Record<string, unknown> }
  | { status: "network_error"; payload: Record<string, unknown> };

/**
 * Owns a SYNCHRONOUS in-flight lock (a plain closure boolean, not React
 * state) and executes an injected request. Because the lock is acquired
 * before the first `await`, two submit() calls in the same tick can never
 * both issue a request: the first flips `inFlight` synchronously, the second
 * observes it and exits before building or sending anything. This is the
 * concurrency guarantee the async `submitting` React state cannot provide.
 *
 * The component holds one instance per open dialog via `useRef`, so the lock
 * survives re-renders. The lock is released on validation failure (never
 * acquired), server rejection, and network failure — so the user can correct
 * and retry — and is deliberately NOT released on success (the modal closes;
 * no further submit from this instance should occur).
 */
export function createEnrollmentSubmitter(mode: EnrollmentActionMode) {
  let inFlight = false;

  return {
    isInFlight: () => inFlight,
    async submit(values: EnrollmentFormValues, deps: EnrollmentSubmitDeps): Promise<EnrollmentSubmitOutcome> {
      // Synchronous guard — the entire point. A second immediate call returns
      // here, before validation or any request.
      if (inFlight) return { status: "skipped" };

      const validated = validateEnrollmentForm(mode, values);
      if (!validated.ok) {
        deps.onValidationError(validated);
        return { status: "invalid" };
      }

      // Acquire the lock synchronously, before awaiting anything.
      inFlight = true;
      deps.onStart();

      const payload = buildEnrollmentPayload(mode, { reason: validated.reason!, quota: validated.quota });
      try {
        const result = await deps.request(payload);
        if (!result.ok) {
          inFlight = false; // release: allow correct-and-retry
          deps.onServerError(result.error ?? "Unable to save changes. Please try again.");
          return { status: "server_error", payload };
        }
        // Exactly one refresh + close, on the single request that ran.
        deps.onSuccess();
        return { status: "success", payload };
      } catch {
        inFlight = false; // release on network failure
        deps.onNetworkError("Unable to connect. Please try again.");
        return { status: "network_error", payload };
      }
    },
  };
}

export type EnrollmentSubmitter = ReturnType<typeof createEnrollmentSubmitter>;
