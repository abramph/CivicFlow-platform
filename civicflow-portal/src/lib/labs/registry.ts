/**
 * Unestra Labs feature registry — the single source of truth for which
 * experimental/beta/AI-assisted/premium capabilities exist, their lifecycle,
 * and the access rules a capability requires. See docs/unestra-labs.md.
 *
 * This registry answers exactly one question: "does this feature exist, and
 * what does using it require?" It does not itself decide whether a specific
 * organization or user currently has access — that's `getOrganizationLabAccess`
 * / `requireOrganizationLabFeature` in `./access.ts`, which reads this
 * registry alongside organization entitlement, enrollment, and RBAC state.
 */

export const LAB_LIFECYCLE = [
  "INTERNAL",
  "ALPHA",
  "BETA",
  "PREVIEW",
  "GENERAL_AVAILABILITY",
  "RETIRED",
] as const;

export type LabLifecycle = (typeof LAB_LIFECYCLE)[number];

export type LabRiskClassification = "low" | "medium" | "high";

export interface LabFeatureDefinition {
  /** Stable key — must match the object key it's registered under. Never reuse a retired key for a different capability. */
  key: string;
  name: string;
  description: string;
  lifecycle: LabLifecycle;
  /**
   * Whether an organization must hold a qualifying plan entitlement before
   * enrollment can even be considered. When true, the resolver checks
   * billing-exempt status or elite-plan resolution (see
   * requiresElitePlanOrBillingExempt in ./access.ts) — a conservative
   * default for "premium/experimental," not a promise made on any pricing
   * page. Revisit per-feature the moment a real commercial policy exists.
   */
  requiresEntitlement: boolean;
  /**
   * Whether an explicit OrganizationLabFeature enrollment row with
   * status ENABLED is required in addition to entitlement. Every feature
   * in this registry today requires enrollment — there is intentionally no
   * "entitled implies enabled" shortcut, so enabling a capability for an
   * organization is always a distinct, auditable action.
   */
  requiresEnrollment: boolean;
  /**
   * Internal-only features can never be enabled for an ordinary customer
   * organization, regardless of entitlement or enrollment state — only for
   * organizations with Organization.billingExempt = true (APH Technologies
   * today). This is a hard ceiling checked before entitlement/enrollment.
   */
  internalOnly: boolean;
  /** Whether usage of this feature should be recorded via recordLabUsage(). */
  metered: boolean;
  helpText?: string;
  riskClassification?: LabRiskClassification;
}

/**
 * Reserved Unestra Labs keys. Every one of these (aside from
 * labsFrameworkPreview) is a registry placeholder only: lifecycle INTERNAL,
 * internalOnly true, no UI surface, no pricing claim, not enabled for any
 * organization. They exist so the enrollment/entitlement/audit machinery has
 * a real typed key to be built and tested against before the corresponding
 * product capability exists. Promoting one out of INTERNAL is a product
 * decision made later — see docs/unestra-labs.md's rollout example.
 */
export const LAB_FEATURES = {
  labsFrameworkPreview: {
    key: "labsFrameworkPreview",
    name: "Labs Framework Preview",
    description:
      "Internal-only proof that the Unestra Labs enrollment framework works end to end. No AI functionality, no customer-visible product claim — renders a simple internal preview panel only.",
    lifecycle: "INTERNAL",
    requiresEntitlement: false,
    requiresEnrollment: true,
    internalOnly: true,
    metered: false,
    helpText: "Visible only to billing-exempt internal organizations (APH Technologies).",
    riskClassification: "low",
  },
  meetingIntelligence: {
    key: "meetingIntelligence",
    name: "Meeting Intelligence",
    description:
      "AI-assisted meeting recording upload, transcription, and draft-minutes generation. Implemented as an internal-only APH Technologies pilot (see docs/meeting-intelligence.md and docs/meeting-intelligence-pilot.md) — deployed but inert until an organization is explicitly enrolled via the Operations Center.",
    lifecycle: "INTERNAL",
    requiresEntitlement: true,
    requiresEnrollment: true,
    internalOnly: true,
    metered: true,
    riskClassification: "high",
  },
  aiAnnouncements: {
    key: "aiAnnouncements",
    name: "AI Announcements",
    description: "Registry placeholder for future AI-assisted announcement drafting. Not implemented.",
    lifecycle: "INTERNAL",
    requiresEntitlement: true,
    requiresEnrollment: true,
    internalOnly: true,
    metered: true,
    riskClassification: "medium",
  },
  policyAssistant: {
    key: "policyAssistant",
    name: "Policy Assistant",
    description: "Registry placeholder for future AI-assisted policy Q&A over an organization's own documents. Not implemented.",
    lifecycle: "INTERNAL",
    requiresEntitlement: true,
    requiresEnrollment: true,
    internalOnly: true,
    metered: true,
    riskClassification: "high",
  },
  executiveCopilot: {
    key: "executiveCopilot",
    name: "Executive Copilot",
    description: "Registry placeholder for a future AI assistant surfacing organizational insights to leadership. Not implemented.",
    lifecycle: "INTERNAL",
    requiresEntitlement: true,
    requiresEnrollment: true,
    internalOnly: true,
    metered: true,
    riskClassification: "high",
  },
  workflowAutomation: {
    key: "workflowAutomation",
    name: "Workflow Automation",
    description: "Registry placeholder for future rule-based/automated organizational workflows. Not implemented.",
    lifecycle: "INTERNAL",
    requiresEntitlement: true,
    requiresEnrollment: true,
    internalOnly: true,
    metered: true,
    riskClassification: "medium",
  },
  // RETIRED, not deleted (PR #40 — PTA/PTO graduation from Labs to a
  // first-class vertical; see docs/pta-access-architecture.md and
  // docs/labs-feature-lifecycle.md). Core PTA access is now gated
  // exclusively by `Organization.primaryVertical === "PTA"` — this key no
  // longer has any bearing on access. It is kept in the registry (rather
  // than deleted) purely so existing `OrganizationLabFeature` rows and
  // audit history referencing "ptaVertical" remain resolvable and
  // meaningful; RETIRED lifecycle already makes getOrganizationLabAccess()
  // deny new enrollment attempts and listOrganizationLabAccess() hide it
  // from the org-facing Labs page. setOrganizationLabEnrollment() separately
  // blocks new ENABLED/PENDING writes for any RETIRED feature (mirroring the
  // existing internalOnly write-time block) so Platform Admin cannot
  // "re-enable" it either. Never reuse this key for a different feature; a
  // genuinely new experimental PTA capability gets its own key (e.g.
  // ptaAdvancedAnalyticsPreview).
  ptaVertical: {
    key: "ptaVertical",
    name: "Unestra for PTA (retired — see primaryVertical)",
    description:
      "Retired. PTA/PTO graduated from this Labs-gated pilot to a first-class Unestra vertical in PR #40 — access is now controlled exclusively by Organization.primaryVertical === \"PTA\", not Labs enrollment. This entry is kept only so historical OrganizationLabFeature rows and audit events remain resolvable. See docs/pta-access-architecture.md.",
    lifecycle: "RETIRED",
    requiresEntitlement: true,
    requiresEnrollment: true,
    internalOnly: false,
    metered: false,
    helpText: "Retired — PTA/PTO is now a first-class vertical, not a Labs feature. See docs/pta-access-architecture.md.",
    riskClassification: "medium",
  },
} as const satisfies Record<string, LabFeatureDefinition>;

/**
 * Every valid Labs feature key, derived from the registry object itself —
 * never hand-listed elsewhere. Passing anything else to a Labs function is
 * a compile-time error wherever the function parameter is typed LabFeatureKey
 * instead of string.
 */
export type LabFeatureKey = keyof typeof LAB_FEATURES;

export function isLabFeatureKey(key: string): key is LabFeatureKey {
  return Object.prototype.hasOwnProperty.call(LAB_FEATURES, key);
}

export function getLabFeature(key: LabFeatureKey): LabFeatureDefinition {
  return LAB_FEATURES[key];
}

/** Looks up an arbitrary string (e.g. from a request body or URL param) safely, returning undefined instead of throwing for an unknown key. */
export function findLabFeature(key: string): LabFeatureDefinition | undefined {
  return isLabFeatureKey(key) ? LAB_FEATURES[key] : undefined;
}

export function listLabFeatures(): LabFeatureDefinition[] {
  return Object.values(LAB_FEATURES);
}
