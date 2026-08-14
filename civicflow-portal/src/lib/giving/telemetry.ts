/**
 * CORE-GIVE-K (§71) — structured giving telemetry. One JSON line per event
 * to stdout (the platform's structured-log convention). SANITIZED BY
 * CONSTRUCTION: the allowlist below is the only way data gets in — ids,
 * amounts in cents, statuses. Never emails, names, or card data.
 */

const ALLOWED_KEYS = new Set([
  "organizationId",
  "contributionId",
  "scheduleId",
  "pledgeId",
  "fundId",
  "statementId",
  "sessionId",
  "amountCents",
  "status",
  "outcome",
  "reason",
  "frequency",
  "matchStatus",
  "truncated",
  "count",
]);

export type GivingEventName =
  | "GIVING_CHECKOUT_STARTED"
  | "GIVING_PAYMENT_RECORDED"
  | "GIVING_PAYMENT_DUPLICATE_IGNORED"
  | "GIVING_PAYMENT_REJECTED"
  | "GIVING_RECURRING_CREATED"
  | "GIVING_RECURRING_PAUSED"
  | "GIVING_RECURRING_RESUMED"
  | "GIVING_RECURRING_CANCELLED"
  | "GIVING_REFUND_COMPLETED"
  | "GIVING_STATEMENT_GENERATED"
  | "GIVING_RECONCILIATION_MISMATCH"
  | "GIVING_RECONCILIATION_TRUNCATED";

export function logGivingEvent(event: GivingEventName, metadata: Record<string, string | number | boolean | null | undefined>) {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (ALLOWED_KEYS.has(key) && value !== null && value !== undefined) clean[key] = value;
  }
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...clean }));
}
