import { prisma } from "@/lib/prisma";
import type { SubscriptionStatus } from "@prisma/client";

/**
 * LAUNCH-BLOCKER: the canonical, single source of truth for whether an
 * organization may use Unestra's paid functionality right now. Every
 * server-side enforcement point — web pages, API routes, mobile routes,
 * deep links, public organization-scoped submission routes, and background
 * jobs — must call resolveOrganizationAccess() (or the throwing wrapper
 * assertOrganizationAccess()) rather than re-deriving trial/subscription
 * logic independently. Before this file existed, trial expiration was
 * checked only for display (see plan-gate.ts's getTrialStatus/getOrgPlan)
 * and never actually blocked access — this is what makes it enforceable.
 *
 * Access rule (exactly, per the approved policy):
 *   billingExempt == true
 *   OR trialEndsAt > authoritativeServerTime
 *   OR an ACTIVE Subscription row exists for the organization
 *
 * "ACTIVE" here means Prisma SubscriptionStatus.active specifically — never
 * infer access from "a Subscription row exists" alone. The existing Stripe
 * webhook mapping (src/app/api/webhooks/stripe/route.ts's
 * mapSubscriptionStatus) already collapses Stripe's incomplete/
 * incomplete_expired/paused/canceled statuses into our "cancelled" value —
 * that mapping is intentionally lossy for *display* purposes but is exactly
 * right for this gate, since every one of those Stripe statuses must deny
 * access and "cancelled" already does. Stripe's own "trialing" status is
 * deliberately NOT treated as active-equivalent: Unestra never sets a Stripe
 * trial_period_days (the 30-day trial is internal-only, tracked via
 * Organization.trialEndsAt above), so a real subscription should never be
 * observed in "trialing" — if one ever is, this gate denies it rather than
 * silently trusting an unexpected state.
 */
export type AccessDenialReason =
  | "TRIAL_EXPIRED"
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_PAST_DUE"
  | "SUBSCRIPTION_CANCELED"
  | "SUBSCRIPTION_INCOMPLETE";

export interface OrganizationAccessResult {
  allowed: boolean;
  reason: AccessDenialReason | null;
  trialEndsAt: Date | null;
  subscriptionStatus: SubscriptionStatus | null;
  billingExempt: boolean;
}

const REASON_MESSAGES: Record<AccessDenialReason, string> = {
  TRIAL_EXPIRED:
    "Your organization's Unestra trial has ended. An organization owner must activate a subscription to restore access.",
  SUBSCRIPTION_REQUIRED:
    "Your organization needs an active Unestra subscription to access this feature. An organization owner must activate a subscription to restore access.",
  SUBSCRIPTION_PAST_DUE:
    "Your organization's subscription payment is past due. An organization owner must update billing to restore access.",
  SUBSCRIPTION_CANCELED:
    "Your organization's subscription has been canceled. An organization owner must reactivate a subscription to restore access.",
  SUBSCRIPTION_INCOMPLETE:
    "Your organization's subscription could not be completed. An organization owner must complete billing setup to restore access.",
};

/**
 * Pure, read-only access decision — never throws, never redirects. Callers
 * that need to enforce the decision use assertOrganizationAccess() below.
 * `now` is exposed as a parameter (rather than always reading Date.now()
 * internally) purely for deterministic testing — production callers should
 * omit it and let it default to the real authoritative server clock. There
 * is deliberately no cached/scheduled-job version of this: trial validity is
 * recomputed from the server clock on every call, so access ends exactly
 * when trialEndsAt passes without waiting on a cron sweep.
 */
export async function resolveOrganizationAccess(
  organizationId: string,
  now: Date = new Date()
): Promise<OrganizationAccessResult> {
  const [org, subscriptions] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { billingExempt: true, trialEndsAt: true },
    }),
    prisma.subscription.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    }),
  ]);

  if (!org) {
    return {
      allowed: false,
      reason: "SUBSCRIPTION_REQUIRED",
      trialEndsAt: null,
      subscriptionStatus: null,
      billingExempt: false,
    };
  }

  if (org.billingExempt) {
    return { allowed: true, reason: null, trialEndsAt: org.trialEndsAt, subscriptionStatus: null, billingExempt: true };
  }

  if (org.trialEndsAt && org.trialEndsAt.getTime() > now.getTime()) {
    return { allowed: true, reason: null, trialEndsAt: org.trialEndsAt, subscriptionStatus: null, billingExempt: false };
  }

  const activeSubscription = subscriptions.find((s) => s.status === "active");
  if (activeSubscription) {
    return { allowed: true, reason: null, trialEndsAt: org.trialEndsAt, subscriptionStatus: "active", billingExempt: false };
  }

  // Denied. Pick the most specific, actionable reason: prefer the most
  // recent subscription attempt's own status (tells the owner exactly what
  // went wrong — payment failed vs. canceled vs. never completed) over the
  // generic trial-expired framing, which only applies when there is no
  // subscription history to be more specific about.
  const mostRecentStatus = subscriptions[0]?.status ?? null;
  let reason: AccessDenialReason;
  if (mostRecentStatus === "past_due") reason = "SUBSCRIPTION_PAST_DUE";
  else if (mostRecentStatus === "cancelled") reason = "SUBSCRIPTION_CANCELED";
  else if (mostRecentStatus === "unpaid" || mostRecentStatus === "trialing") reason = "SUBSCRIPTION_INCOMPLETE";
  else if (org.trialEndsAt) reason = "TRIAL_EXPIRED";
  else reason = "SUBSCRIPTION_REQUIRED";

  return { allowed: false, reason, trialEndsAt: org.trialEndsAt, subscriptionStatus: mostRecentStatus, billingExempt: false };
}

/** Safe, client-facing message for a given denial reason — never includes Stripe identifiers or internal billing detail. */
export function accessDenialMessage(reason: AccessDenialReason): string {
  return REASON_MESSAGES[reason];
}

/**
 * The message shown to an anonymous/public visitor (payment links, QR
 * member-intake, public giving pages) when the organization behind the
 * resource they're submitting to is billing-inactive. Deliberately generic
 * — an anonymous submitter must never learn that a specific organization's
 * billing/trial state is the cause, unlike the authenticated 402 messages
 * above, which are shown only to that organization's own staff.
 */
export const PUBLIC_UNAVAILABLE_MESSAGE =
  "This organization's online services are temporarily unavailable. Please contact the organization directly.";

/**
 * Thrown by assertOrganizationAccess() — carries a 402 status (Payment
 * Required) so withApiErrorHandling returns the structured
 * ORGANIZATION_SUBSCRIPTION_REQUIRED body every API/mobile client can key
 * off of, without ever leaking a stack trace, Stripe identifier, or
 * internal billing detail (see api-route.ts's handling).
 */
export class SubscriptionRequiredError extends Error {
  readonly status = 402;
  readonly code = "ORGANIZATION_SUBSCRIPTION_REQUIRED";
  constructor(readonly reason: AccessDenialReason, message: string) {
    super(message);
    this.name = "SubscriptionRequiredError";
  }
}

/**
 * The throwing enforcement wrapper every guard chokepoint (requireOrganization
 * in auth-guards.ts, the mobile guards in mobile-auth.ts, and any public
 * organization-scoped route) calls. Never scatter an independent
 * trialEndsAt/subscriptionStatus comparison anywhere else — always route
 * through this.
 */
export async function assertOrganizationAccess(organizationId: string): Promise<OrganizationAccessResult> {
  const result = await resolveOrganizationAccess(organizationId);
  if (!result.allowed) {
    // result.reason is guaranteed non-null whenever allowed is false.
    throw new SubscriptionRequiredError(result.reason as AccessDenialReason, accessDenialMessage(result.reason as AccessDenialReason));
  }
  return result;
}
