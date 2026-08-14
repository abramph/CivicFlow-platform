import type { OrganizationStripeAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";

/**
 * CONNECT-A (docs/stripe-connect-architecture.md) — the organization
 * connected-account layer. THE RULES:
 *  - the connected account is resolved SERVER-SIDE from the organization;
 *    no function here accepts an `acct_…` id from a caller (§10 — client
 *    input can never choose a payment destination);
 *  - `acct_…` ids are identifiers, never secrets; no Stripe credentials
 *    are ever stored (§4);
 *  - accounts are never deleted; disconnection is DISABLED + disabledAt
 *    (§26) because settled charges reference the account forever;
 *  - money flows are NOT wired through this layer yet: charge-context
 *    enforcement arrives per-flow in CONNECT-C/D/E behind the §55 gate.
 */

/** Shape of the Stripe Account fields status derivation depends on —
 * matches Stripe.Account without importing the SDK type (pure/testable). */
export interface StripeAccountSnapshot {
  id: string;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  country?: string | null;
  default_currency?: string | null;
  requirements?: {
    currently_due?: string[] | null;
    eventually_due?: string[] | null;
    disabled_reason?: string | null;
  } | null;
}

export type DerivedStripeStatus =
  | "ONBOARDING_STARTED"
  | "ACTION_REQUIRED"
  | "CONNECTED"
  | "PAYMENTS_ENABLED"
  | "RESTRICTED"
  | "DISABLED";

/** §5 status derivation — pure. PAYOUTS_PENDING is a UI presentation of
 * PAYMENTS_ENABLED with payoutsEnabled=false, not a stored state. */
export function deriveAccountStatus(account: StripeAccountSnapshot): DerivedStripeStatus {
  const currentlyDue = account.requirements?.currently_due?.length ?? 0;
  const disabledReason = account.requirements?.disabled_reason ?? null;

  if (disabledReason) {
    // Stripe's own disabled reasons (e.g. "requirements.past_due",
    // "rejected.*", "under_review") — payments are off until resolved.
    return disabledReason.startsWith("rejected") ? "DISABLED" : "RESTRICTED";
  }
  if (account.charges_enabled) {
    return currentlyDue > 0 ? "ACTION_REQUIRED" : "PAYMENTS_ENABLED";
  }
  if (account.details_submitted) {
    return currentlyDue > 0 ? "ACTION_REQUIRED" : "CONNECTED";
  }
  return "ONBOARDING_STARTED";
}

/** Persist a fresh provider snapshot onto our row (upsert-by-org). Never
 * writes credentials; never deletes. */
export async function recordAccountSync(organizationId: string, account: StripeAccountSnapshot, accountMode: "test" | "live") {
  const status = deriveAccountStatus(account);
  const data = {
    stripeAccountId: account.id,
    accountMode,
    onboardingStatus: status,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    requirementsCurrentlyDueCount: account.requirements?.currently_due?.length ?? 0,
    requirementsEventuallyDueCount: account.requirements?.eventually_due?.length ?? 0,
    country: account.country ?? null,
    defaultCurrency: account.default_currency ?? null,
    lastSyncedAt: new Date(),
    ...(status === "PAYMENTS_ENABLED" ? { connectedAt: new Date() } : {}),
  };
  return prisma.organizationStripeAccount.upsert({
    where: { organizationId },
    create: { organizationId, ...data, connectedAt: status === "PAYMENTS_ENABLED" ? new Date() : null },
    update: {
      ...data,
      // connectedAt is first-transition-only; don't refresh it on every sync.
      ...(status === "PAYMENTS_ENABLED" ? {} : { connectedAt: undefined }),
    },
  });
}

export interface ConnectedChargeContext {
  stripeConnectedAccountId: string;
  accountMode: string;
}

/**
 * THE §10/§55 resolver: session-derived organizationId → the org's OWN
 * connected account, charges-enabled or nothing. Signature deliberately has
 * no account parameter — a client-supplied `acct_…` is unrepresentable.
 * Not yet wired into money flows (CONNECT-C/D/E do that per flow).
 */
export async function resolveConnectedAccountForCharges(organizationId: string): Promise<ConnectedChargeContext> {
  const account = await prisma.organizationStripeAccount.findUnique({ where: { organizationId } });
  if (!account || account.disabledAt) {
    throw new FinanceError("Payments are not set up for this organization yet.", 409);
  }
  if (!account.chargesEnabled) {
    throw new FinanceError("Stripe needs additional information before this organization can accept payments.", 409);
  }
  return { stripeConnectedAccountId: account.stripeAccountId, accountMode: account.accountMode };
}

/** Read-only status view for settings surfaces (§5/§24). Null = never
 * connected (NOT_CONNECTED is the absence of a row). */
export async function getAccountView(organizationId: string): Promise<
  | null
  | (Pick<
      OrganizationStripeAccount,
      | "onboardingStatus"
      | "chargesEnabled"
      | "payoutsEnabled"
      | "detailsSubmitted"
      | "requirementsCurrentlyDueCount"
      | "country"
      | "defaultCurrency"
      | "connectedAt"
      | "lastSyncedAt"
      | "disabledAt"
      | "accountMode"
    > & { statusLabel: string })
> {
  const account = await prisma.organizationStripeAccount.findUnique({ where: { organizationId } });
  if (!account) return null;
  const statusLabel = account.disabledAt
    ? "Disconnected"
    : account.onboardingStatus === "PAYMENTS_ENABLED" && !account.payoutsEnabled
      ? "Payments enabled — payouts pending"
      : {
          ONBOARDING_STARTED: "Onboarding started",
          ACTION_REQUIRED: "Action required",
          CONNECTED: "Connected — payments not yet enabled",
          PAYMENTS_ENABLED: "Payments enabled",
          RESTRICTED: "Restricted by Stripe",
          DISABLED: "Disabled",
        }[account.onboardingStatus];
  return {
    onboardingStatus: account.onboardingStatus,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted,
    requirementsCurrentlyDueCount: account.requirementsCurrentlyDueCount,
    country: account.country,
    defaultCurrency: account.defaultCurrency,
    connectedAt: account.connectedAt,
    lastSyncedAt: account.lastSyncedAt,
    disabledAt: account.disabledAt,
    accountMode: account.accountMode,
    statusLabel,
  };
}
