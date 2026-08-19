import { prisma } from "@/lib/prisma";
import { getPlan, resolvePricingVertical, type FeatureKey, type PlanId, type CloudPlanId } from "@/lib/plans";

export interface TrialStatus {
  isInTrial: boolean;
  trialEndsAt: Date | null;
  daysRemaining: number;
}

/**
 * Whether an organization is exempt from ordinary trial/subscription
 * gating — currently true for exactly one organization: APH Technologies,
 * LLC, the internal platform-owning organization (see the migration that
 * sets Organization.billingExempt). Never derived from the caller's
 * identity, role, or PlatformAccess grant — a platform administrator
 * opening any other (unpaid) organization must still see that
 * organization's real billing state.
 */
export async function isBillingExempt(organizationId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { billingExempt: true },
  });
  return org?.billingExempt ?? false;
}

export async function getOrgPlan(organizationId: string): Promise<PlanId> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, billingExempt: true, primaryVertical: true },
  });
  // Internal/platform-owned organizations (see Organization.billingExempt)
  // get full-featured access with no plan limits or trial framing — they
  // are not a paying customer and never will be. This is a narrow,
  // explicit, ID-keyed exemption (see the migration that sets it), never
  // inferred from the caller's identity, role, or PlatformAccess grant.
  if (org?.billingExempt) return "elite";
  const plan = (org?.plan ?? "free") as PlanId;
  // During active trial, the org gets full access to its OWN vertical's
  // Cloud plan at no charge (not a hardcoded legacy tier) — a trialing PTA
  // org should see PTA branding/features during the trial, not "Essential".
  if (plan === "free" && org?.trialEndsAt && org.trialEndsAt > new Date()) {
    const vertical = resolvePricingVertical(org.primaryVertical ?? "COMMUNITY");
    return `${vertical.toLowerCase()}_monthly` as CloudPlanId;
  }
  return plan;
}

export async function getTrialStatus(organizationId: string): Promise<TrialStatus> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, billingExempt: true },
  });

  // A billing-exempt organization is never "in a trial" — it has permanent,
  // unconditional access, so there is nothing counting down and no
  // trial-ended state to reach.
  if (org?.billingExempt) {
    return { isInTrial: false, trialEndsAt: null, daysRemaining: 0 };
  }

  const now = new Date();
  const trialEndsAt = org?.trialEndsAt ?? null;
  const isInTrial =
    org?.plan === "free" && trialEndsAt !== null && trialEndsAt > now;
  const daysRemaining = isInTrial
    ? Math.ceil((trialEndsAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return { isInTrial, trialEndsAt, daysRemaining };
}

/**
 * Unestra Cloud (CLOUD-C): ordinary-member count is no longer a pricing
 * input for ANY organization, on ANY plan (Cloud or legacy) — every
 * standard subscription includes unlimited ordinary members, full stop.
 * This is why the gate itself always reports `allowed: true, limit:
 * Infinity` rather than deferring to a per-plan `limits.members` value the
 * way it used to (see plans.ts's PlanConfig.limits.members doc comment —
 * legacy plans still carry historical numbers there for record-keeping,
 * but nothing reads them for enforcement anymore). `current` is still
 * computed and returned — member count remains real operational/reporting
 * data (dashboards, Operations Center, vertical reporting), it has just
 * stopped being a gate. The `plan` parameter and PlanId import are kept so
 * every existing call site (createMember, mobile admin create, QR intake,
 * import engines) continues to compile unchanged.
 */
export async function checkMemberLimit(
  organizationId: string,
  _plan?: PlanId
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const current = await prisma.orgMember.count({ where: { organizationId } });
  return { allowed: true, current, limit: Infinity };
}

/** Permanent no-op — kept as a named call site (rather than deleted and
 * removed from every caller) so a future, deliberate reintroduction of
 * member-based limits has one place to change, and so this file's own
 * history documents that the removal was intentional, not an oversight. */
export async function requireMemberSlot(_organizationId: string): Promise<void> {
  return;
}

/**
 * "Portal user seats" are staff logins (everything except the constituent-
 * facing MEMBER role) — the only roles ever assignable through the Users &
 * Roles UI (see UsersAndRolesManager.tsx's roleOptions, which excludes
 * MEMBER entirely). A MEMBER-role OrganizationMembership is created when an
 * existing OrgMember (constituent) accepts an app invite for their own
 * portal access (see accept-invite.ts) — that's a constituent gaining
 * self-service access to their own dues/payments, not a "portal user seat"
 * in the marketed/billed sense, and must never consume from the same pool
 * as real staff invites.
 */
const STAFF_SEAT_ROLES = ["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"] as const;

export async function checkSeatLimit(
  organizationId: string
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, trialEndsAt: true, seatLimit: true },
  });

  const planId = await getOrgPlan(organizationId);
  const planConfig = getPlan(planId);
  const limit = org?.seatLimit ?? planConfig.includedSeats;
  const current = await prisma.organizationMembership.count({
    where: { organizationId, role: { in: [...STAFF_SEAT_ROLES] } },
  });

  return { allowed: current < limit, current, limit };
}

/**
 * CLOUD-SEAT-C: this legacy role-name-based gate (which counted READ_ONLY as
 * seat-consuming) no longer enforces anything — every real enforcement call
 * site (organization-memberships POST/PATCH) now uses the capability-based
 * `lockAndAssertAdminSeatAvailable()` in admin-seats.ts instead, which is
 * also concurrency-safe (row-locked) where this never was. `checkSeatLimit`
 * itself is kept only for its current display use in
 * getOrganizationEntitlements() below — see admin-seats.ts's doc comment for
 * why READ_ONLY must never count. CLOUD-SEAT-E will replace that display
 * value with the new admin-seat summary; not done here to keep this PR
 * scoped to enforcement.
 */

/**
 * The authoritative backend gate for every plan-controlled feature
 * (emailCampaigns, pdfExport, advancedReports, apiAccess today; future
 * Unestra Labs keys later). Call this at the narrowest point that actually
 * performs the gated action — campaign send, PDF generation, etc. — not
 * just at a UI-adjacent layer, since UI hiding alone is never sufficient
 * enforcement. Throws PlanFeatureError (never silently returns false) so
 * callers can't accidentally ignore a denial.
 */
export async function requirePlanFeature(organizationId: string, feature: FeatureKey): Promise<void> {
  const planId = await getOrgPlan(organizationId);
  const config = getPlan(planId);
  if (!config.limits[feature]) {
    throw new PlanFeatureError(
      feature,
      `This feature is not included in your ${config.name} plan. Upgrade to access it.`
    );
  }
}

export interface OrganizationEntitlements {
  planId: PlanId;
  planName: string;
  /** True only for APH Technologies, LLC today — see isBillingExempt(). Not a paying customer; members/seats are still reported below (as unlimited, via getOrgPlan's elite resolution) for display consistency. */
  billingExempt: boolean;
  trial: TrialStatus;
  members: { allowed: boolean; current: number; limit: number };
  seats: { allowed: boolean; current: number; limit: number };
  /**
   * emailCampaigns and pdfExport are backed by real requirePlanFeature()
   * enforcement (see sendCommunicationCampaign, /api/reports/export,
   * /api/reports/send, /api/members/export). advancedReports and apiAccess
   * are exposed here for display only — see docs/entitlements.md for why
   * neither has a corresponding capability in the product today to enforce
   * against.
   */
  features: {
    emailCampaigns: boolean;
    pdfExport: boolean;
    advancedReports: boolean;
    apiAccess: boolean;
  };
}

/**
 * The single, consolidated entitlement snapshot for an organization — every
 * UI surface that needs to *display* plan/limit/feature state (billing
 * settings, the Operations Center, onboarding) should call this instead of
 * hand-rolling its own combination of getOrgPlan()/checkMemberLimit()/etc.
 * Enforcement (blocking a write) should still use the narrow, single-purpose
 * guards below (requireMemberSlot, requireSeatSlot, requirePlanFeature) —
 * this function is for reading/showing state, not gating an action.
 */
export async function getOrganizationEntitlements(organizationId: string): Promise<OrganizationEntitlements> {
  const [planId, billingExempt, trial, members, seats] = await Promise.all([
    getOrgPlan(organizationId),
    isBillingExempt(organizationId),
    getTrialStatus(organizationId),
    checkMemberLimit(organizationId),
    checkSeatLimit(organizationId),
  ]);
  const planConfig = getPlan(planId);

  return {
    planId,
    planName: planConfig.name,
    billingExempt,
    trial,
    members,
    seats,
    features: {
      emailCampaigns: planConfig.limits.emailCampaigns,
      pdfExport: planConfig.limits.pdfExport,
      advancedReports: planConfig.limits.advancedReports,
      apiAccess: planConfig.limits.apiAccess,
    },
  };
}

export class PlanLimitError extends Error {
  readonly status = 403;
  readonly code = "PLAN_LIMIT";
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/**
 * Thrown by requirePlanFeature() specifically — distinct from PlanLimitError
 * (a usage-count ceiling like members/seats) so the UI and API consumers can
 * tell "you're out of room" apart from "your plan doesn't include this at
 * all." Carries the feature key so the denial response can name exactly
 * what was blocked without the caller having to re-derive it.
 */
export class PlanFeatureError extends Error {
  readonly status = 403;
  readonly code = "PLAN_FEATURE_REQUIRED";
  constructor(readonly feature: FeatureKey, message: string) {
    super(message);
    this.name = "PlanFeatureError";
  }
}
