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
  if (!Number.isInteger(value) || value <= 0) return "Quota must be greater than zero.";
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

/** True only when no request is in flight — the single guard the control uses
 *  to make a double-click (or a second submit) a no-op. */
export function canSubmitEnrollment(state: { submitting: boolean }): boolean {
  return !state.submitting;
}
