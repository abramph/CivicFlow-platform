import { prisma } from "@/lib/prisma";
import { getOrgPlan, getTrialStatus, isBillingExempt } from "@/lib/plan-gate";
import { isPaidPlan } from "@/lib/plans";
import { findLabFeature, listLabFeatures, type LabFeatureKey, type LabLifecycle } from "./registry";

export const LAB_DENIAL_CODES = [
  "LAB_FEATURE_UNKNOWN",
  "LAB_FEATURE_INTERNAL_ONLY",
  "LAB_FEATURE_NOT_ENTITLED",
  "LAB_FEATURE_NOT_ENROLLED",
  "LAB_FEATURE_DISABLED",
  "LAB_FEATURE_SUSPENDED",
  "LAB_FEATURE_RETIRED",
  "LAB_FEATURE_NOT_ENABLED",
] as const;

export type LabDenialCode = (typeof LAB_DENIAL_CODES)[number];

export interface LabAccessResult {
  featureKey: string;
  exists: boolean;
  lifecycle: LabLifecycle | null;
  /** Whether the organization's plan/billing-exempt status satisfies the feature's entitlement requirement (true when the feature doesn't require one). */
  entitled: boolean;
  /** Whether an OrganizationLabFeature row exists for this org+feature (true when the feature doesn't require enrollment). */
  enrolled: boolean;
  /** Raw enrollment row status === ENABLED (true when enrollment isn't required at all). */
  enabled: boolean;
  /** The final answer: can this organization use this feature right now. */
  available: boolean;
  denialReason: LabDenialCode | null;
}

function denied(
  featureKey: string,
  reason: LabDenialCode,
  partial: Partial<Omit<LabAccessResult, "featureKey" | "denialReason">> = {}
): LabAccessResult {
  return {
    featureKey,
    exists: partial.exists ?? true,
    lifecycle: partial.lifecycle ?? null,
    entitled: partial.entitled ?? false,
    enrolled: partial.enrolled ?? false,
    enabled: partial.enabled ?? false,
    available: false,
    denialReason: reason,
  };
}

/**
 * Whether an organization satisfies the conservative default entitlement
 * bar for a Labs feature that requires one: billing-exempt (internal), or
 * an actual paid subscription — never a trial alone.
 *
 * Unestra Cloud (CLOUD-D): with per-vertical pricing there is no longer a
 * single "elite" tier to check against — getOrgPlan() now resolves a real
 * PTA subscriber to "pta_monthly", a real Union subscriber to
 * "union_monthly", etc., and (since CLOUD-D) a TRIALING org resolves to
 * that same vertical-keyed plan id too, so the plan id string alone can no
 * longer distinguish "actually paying" from "still trialing." This checks
 * isPaidPlan() (true for every Cloud plan and the legacy essential/elite
 * tiers) AND explicitly excludes active trials via getTrialStatus(), which
 * preserves the original policy exactly: billing-exempt, or a real paid
 * subscription — a trial alone is never sufficient. This is a policy
 * default for experimental/premium capabilities, not a claim made on any
 * pricing page — no Labs feature is customer-visible today. Revisit per
 * feature at real launch time (see docs/unestra-labs.md).
 */
async function requiresElitePlanOrBillingExempt(organizationId: string): Promise<boolean> {
  if (await isBillingExempt(organizationId)) return true;
  const [plan, trial] = await Promise.all([getOrgPlan(organizationId), getTrialStatus(organizationId)]);
  if (trial.isInTrial) return false;
  return isPaidPlan(plan);
}

/**
 * The centralized Labs access resolver — reads the registry (does this
 * exist, what does it require) and organization state (entitlement,
 * enrollment, org status) to answer "can this organization use this Labs
 * feature right now." Never consults PlatformAccess or the caller's own
 * role — those are orthogonal (see requireOrganizationLabFeature for the
 * user-permission layer, which callers must check separately with their
 * existing tenant RBAC guard).
 */
export async function getOrganizationLabAccess(
  organizationId: string,
  featureKeyRaw: string
): Promise<LabAccessResult> {
  const feature = findLabFeature(featureKeyRaw);
  if (!feature) {
    return denied(featureKeyRaw, "LAB_FEATURE_UNKNOWN", { exists: false });
  }

  if (feature.lifecycle === "RETIRED") {
    return denied(feature.key, "LAB_FEATURE_RETIRED", { lifecycle: feature.lifecycle });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { billingExempt: true, status: true },
  });
  const isInternalOrg = org?.billingExempt ?? false;

  // Internal-only is a hard ceiling checked before entitlement/enrollment —
  // no customer organization can ever reach this feature regardless of plan
  // or enrollment state.
  if (feature.internalOnly && !isInternalOrg) {
    return denied(feature.key, "LAB_FEATURE_INTERNAL_ONLY", { lifecycle: feature.lifecycle });
  }

  // Invalid or non-active (suspended/cancelled) organization — denied
  // generically rather than distinguishing "doesn't exist" from "archived"
  // in the response, so this never leaks organization-existence information
  // to a caller who only has a bare id.
  if (!org || org.status !== "active") {
    return denied(feature.key, "LAB_FEATURE_NOT_ENABLED", { lifecycle: feature.lifecycle });
  }

  let entitled = true;
  if (feature.requiresEntitlement) {
    entitled = await requiresElitePlanOrBillingExempt(organizationId);
  }
  if (!entitled) {
    return denied(feature.key, "LAB_FEATURE_NOT_ENTITLED", { lifecycle: feature.lifecycle });
  }

  if (!feature.requiresEnrollment) {
    return {
      featureKey: feature.key,
      exists: true,
      lifecycle: feature.lifecycle,
      entitled: true,
      enrolled: true,
      enabled: true,
      available: true,
      denialReason: null,
    };
  }

  const enrollment = await prisma.organizationLabFeature.findUnique({
    where: { organizationId_featureKey: { organizationId, featureKey: feature.key } },
    select: { status: true },
  });

  if (!enrollment) {
    return denied(feature.key, "LAB_FEATURE_NOT_ENROLLED", { lifecycle: feature.lifecycle, entitled: true });
  }
  if (enrollment.status === "SUSPENDED") {
    return denied(feature.key, "LAB_FEATURE_SUSPENDED", { lifecycle: feature.lifecycle, entitled: true, enrolled: true });
  }
  if (enrollment.status === "DISABLED") {
    return denied(feature.key, "LAB_FEATURE_DISABLED", { lifecycle: feature.lifecycle, entitled: true, enrolled: true });
  }
  if (enrollment.status === "PENDING") {
    return denied(feature.key, "LAB_FEATURE_NOT_ENABLED", { lifecycle: feature.lifecycle, entitled: true, enrolled: true });
  }

  return {
    featureKey: feature.key,
    exists: true,
    lifecycle: feature.lifecycle,
    entitled: true,
    enrolled: true,
    enabled: true,
    available: true,
    denialReason: null,
  };
}

/**
 * Organization-facing snapshot for the Labs/Early Access settings page.
 * Internal-only features are never included unless the organization itself
 * is billing-exempt (APH Technologies) — an ordinary customer administrator
 * must never even see that internal-only rows exist, not just be denied
 * access to them.
 */
export async function listOrganizationLabAccess(organizationId: string): Promise<LabAccessResult[]> {
  const isInternalOrg = await isBillingExempt(organizationId);
  const visibleFeatures = listLabFeatures().filter(
    (feature) => feature.lifecycle !== "RETIRED" && (isInternalOrg || !feature.internalOnly)
  );
  return Promise.all(visibleFeatures.map((feature) => getOrganizationLabAccess(organizationId, feature.key)));
}

export class LabFeatureError extends Error {
  readonly status = 403;
  constructor(readonly code: LabDenialCode, readonly feature: string, message: string) {
    super(message);
    this.name = "LabFeatureError";
  }
}

const DENIAL_MESSAGES: Record<LabDenialCode, string> = {
  LAB_FEATURE_UNKNOWN: "This Labs feature does not exist.",
  LAB_FEATURE_INTERNAL_ONLY: "This Labs feature is internal-only and is not available to this organization.",
  LAB_FEATURE_NOT_ENTITLED: "This organization's plan does not include this Labs feature.",
  LAB_FEATURE_NOT_ENROLLED: "This organization is not enrolled in this Labs feature.",
  LAB_FEATURE_DISABLED: "This Labs feature has been disabled for this organization.",
  LAB_FEATURE_SUSPENDED: "This Labs feature has been suspended for this organization.",
  LAB_FEATURE_RETIRED: "This Labs feature has been retired and is no longer available.",
  LAB_FEATURE_NOT_ENABLED: "This Labs feature is not enabled for this organization.",
};

/**
 * The authoritative backend gate for a Labs feature action — call this at
 * the narrowest point that actually performs the gated action, exactly like
 * requirePlanFeature() (see docs/entitlements.md). Throws LabFeatureError
 * (never returns false silently) so a denial can't accidentally fall
 * through. Callers must separately check the acting user's own tenant RBAC
 * permission — this function only resolves organization-level access, not
 * per-user permission (see docs/unestra-labs.md's four-layer model).
 */
export async function requireOrganizationLabFeature(
  organizationId: string,
  featureKey: LabFeatureKey | string
): Promise<void> {
  const access = await getOrganizationLabAccess(organizationId, featureKey);
  if (!access.available) {
    const code = access.denialReason ?? "LAB_FEATURE_NOT_ENABLED";
    throw new LabFeatureError(code, access.featureKey, DENIAL_MESSAGES[code]);
  }
}
