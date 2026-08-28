import { prisma } from "@/lib/prisma";
import { calculateProcessingCostCoverageCents } from "@/lib/giving/coverage-math";

/**
 * COST-POLICY v2 (docs/payment-cost-policy-v2.md) — the server-authoritative
 * payment-cost policy. Everything here derives from SERVER-SIDE facts; no
 * function in this module accepts a client-supplied nature, rate, fee, or
 * amount other than the payer's boolean opt-in for OPTIONAL coverage.
 *
 * The governing invariant (§4): processing costs never reduce the amount
 * credited toward a member's obligation. Whatever this module decides about
 * coverage, the obligation/contribution principal recorded downstream is
 * ALWAYS the base amount — allocation by principal, never by Stripe net.
 */

export type PaymentNatureValue = "FIXED_OBLIGATION" | "VOLUNTARY" | "OFFLINE" | "EXEMPT";

export type PaymentPurpose =
  | "giving"
  | "giving-recurring"
  | "public-give"
  | "payment-link-campaign"
  | "payment-link-event"
  | "payment-link-dues"
  | "payment-link-general"
  | "member-dues"
  | "offline-entry"
  /// Volunteer Hour Requirements & Buyout program, VH-F (docs/pta-volunteer-hours.md).
  /// A family's own choice — not owed unless they elect it, same voluntary
  /// shape as "giving," never a donation/tax-deductible contribution
  /// (spec §17). The remaining-hours assessment (VH-G) is the fixed-
  /// obligation counterpart once posted.
  | "pta-volunteer-buyout";

/**
 * §2 — derive the payment nature from what the payment actually IS.
 * Vertical never overrides nature: a church event ticket is FIXED, a PTA
 * donation is VOLUNTARY, payroll-deducted union dues are OFFLINE.
 */
export function derivePaymentNature(input: {
  purpose: PaymentPurpose;
  /// For program-backed giving: the program's own server-enforced fields.
  programType?: string | null;
  programObligationNature?: "REQUIRED" | "VOLUNTARY" | null;
}): PaymentNatureValue {
  switch (input.purpose) {
    case "offline-entry":
      return "OFFLINE";
    case "member-dues":
    case "payment-link-dues":
    // Event-registration links are fixed-price purchases (§2), not gifts.
    case "payment-link-event":
      return "FIXED_OBLIGATION";
    case "payment-link-campaign":
    case "payment-link-general":
    case "public-give":
      return "VOLUNTARY";
    case "giving":
    case "giving-recurring":
      // Core Giving 2.0's own model: REQUIRED is legal only for DUES-type
      // programs; everything else is voluntary by construction.
      if (input.programObligationNature === "REQUIRED" && input.programType === "DUES") {
        return "FIXED_OBLIGATION";
      }
      return "VOLUNTARY";
    case "pta-volunteer-buyout":
      return "VOLUNTARY";
  }
}

export interface CoveragePlan {
  /** Whether a coverage line exists on this checkout at all. */
  offered: boolean;
  /** True only when coverage is REQUIRED (non-removable). Never true today
   * for card payments — see eligibility note below. */
  required: boolean;
  coverageCents: number;
  totalCents: number;
  /** What the plan resolved to, persisted on the PendingPayment record. */
  coverageMode:
    | "NONE"
    | "LEGACY_OPTIONAL"
    | "V2_OPTIONAL"
    | "V2_REQUIRED"
    | "V2_ORGANIZATION_ABSORBED"
    | "V2_FALLBACK_ORGANIZATION_ABSORBED"
    | "V2_FALLBACK_REQUIRE_ACH"
    | "V2_FALLBACK_OFFER_ALTERNATIVES";
  /** Payment-method restriction the checkout should apply (REQUIRE_ACH). */
  restrictToPaymentMethods: string[] | null;
  /** §8 fallback disclosure to show the payer, when applicable. */
  fallbackMessage: string | null;
  policyVersion: string | null;
}

export const COST_POLICY_VERSION = "v2.0";

/**
 * §15 global flags — env-driven kill switches, all defaulting to the safe
 * state. `mandatoryObligationCoverage` MUST stay off until a compliant
 * card-eligibility mechanism exists (§5/§7 STOP finding: Stripe exposes no
 * generally available first-party surcharging capability for standard US
 * Connect accounts, so Unestra cannot distinguish eligible credit cards
 * from prohibited debit/prepaid cards before payment).
 */
export function getGlobalCostPolicyFlags() {
  return {
    mandatoryObligationCoverage: process.env.MANDATORY_OBLIGATION_COVERAGE === "true",
    paymentMethodEligibilityCheck: process.env.PAYMENT_METHOD_ELIGIBILITY_CHECK === "true",
    paymentCostReconciliation: process.env.PAYMENT_COST_RECONCILIATION !== "false",
  };
}

/**
 * §8 — what a checkout SURFACE should render for a given nature, before an
 * amount exists: no control (NONE), the voluntary unchecked checkbox
 * (OPTIONAL), or the non-editable required summary (REQUIRED — unreachable
 * until a compliant eligibility mechanism ships). Rates feed the client's
 * live ESTIMATE only; the checkout route re-resolves authoritatively.
 */
export async function resolveCoverageDisplayPolicy(input: {
  organizationId: string;
  nature: PaymentNatureValue;
}): Promise<{
  display: "NONE" | "OPTIONAL" | "REQUIRED";
  percentBps: number;
  fixedCents: number;
  fallbackMessage: string | null;
  /** LAUNCH-SAFE §4: show "Amount credited toward dues $X" — v2 fixed
   * obligations where the org absorbs the cost. The member-facing total
   * stays the principal. */
  showCreditedNotice: boolean;
}> {
  const [plan, settings] = await Promise.all([
    resolveCoveragePlan({ organizationId: input.organizationId, nature: input.nature, baseCents: 100, payerOptedIn: true }),
    prisma.orgSettings.findUnique({
      where: { organizationId: input.organizationId },
      select: {
        processingCostCoveragePercentBps: true,
        processingCostCoverageFixedCents: true,
        paymentCostPolicyV2Enabled: true,
      },
    }),
  ]);
  return {
    display: plan.required ? "REQUIRED" : plan.offered ? "OPTIONAL" : "NONE",
    percentBps: settings?.processingCostCoveragePercentBps ?? 0,
    fixedCents: settings?.processingCostCoverageFixedCents ?? 0,
    fallbackMessage: plan.fallbackMessage,
    showCreditedNotice:
      Boolean(settings?.paymentCostPolicyV2Enabled) && input.nature === "FIXED_OBLIGATION" && !plan.offered && !plan.required,
  };
}

/**
 * §3 — resolve the coverage plan for one checkout. Reads the org's policy
 * + legacy CONNECT-F settings; the ONLY client input is `payerOptedIn`
 * (meaningful solely for OPTIONAL plans).
 *
 * With `paymentCostPolicyV2Enabled` OFF (every org today), this reproduces
 * the legacy CONNECT-F/FEE-COVER-C behavior exactly, for every nature —
 * §15's "migrate without changing active checkout behavior".
 */
export async function resolveCoveragePlan(input: {
  organizationId: string;
  nature: PaymentNatureValue;
  baseCents: number;
  payerOptedIn: boolean;
}): Promise<CoveragePlan> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId: input.organizationId },
    select: {
      paymentCostPolicyV2Enabled: true,
      fixedObligationCoveragePolicy: true,
      voluntaryCoveragePolicy: true,
      ineligiblePaymentMethodFallback: true,
      fixedObligationPaymentPreference: true,
      achEnabled: true,
      policyAcceptedAt: true,
      policyVersion: true,
      processingCostCoverageMode: true,
      processingCostCoveragePercentBps: true,
      processingCostCoverageFixedCents: true,
    },
  });

  const none = (mode: CoveragePlan["coverageMode"]): CoveragePlan => ({
    offered: false,
    required: false,
    coverageCents: 0,
    totalCents: input.baseCents,
    coverageMode: mode,
    restrictToPaymentMethods: null,
    fallbackMessage: null,
    policyVersion: settings?.paymentCostPolicyV2Enabled ? (settings.policyVersion ?? COST_POLICY_VERSION) : null,
  });

  if (!settings) return none("NONE");
  if (input.nature === "OFFLINE") return none("NONE");

  const quote = (optedIn: boolean) => {
    const legacyOffered = settings.processingCostCoverageMode === "OPTIONAL_CONTRIBUTOR_COVERAGE";
    const coverageCents =
      legacyOffered && optedIn
        ? calculateProcessingCostCoverageCents(
            input.baseCents,
            settings.processingCostCoveragePercentBps,
            settings.processingCostCoverageFixedCents
          )
        : 0;
    return { legacyOffered, coverageCents };
  };

  // ── Legacy path: v2 disabled → CONNECT-F behavior, unchanged. ──
  if (!settings.paymentCostPolicyV2Enabled) {
    const { legacyOffered, coverageCents } = quote(input.payerOptedIn);
    if (!legacyOffered) return none("NONE");
    return {
      offered: true,
      required: false,
      coverageCents,
      totalCents: input.baseCents + coverageCents,
      coverageMode: "LEGACY_OPTIONAL",
      restrictToPaymentMethods: null,
      fallbackMessage: null,
      policyVersion: null,
    };
  }

  // ── v2 path ──
  const policyVersion = settings.policyVersion ?? COST_POLICY_VERSION;

  // LAUNCH-SAFE §1: fixed-obligation payment preference, applied to
  // whatever coverage outcome resolves below. ACH exists to REDUCE the
  // org's processing costs — it never changes what the member is credited.
  const applyPaymentPreference = (plan: CoveragePlan): CoveragePlan => {
    if (input.nature !== "FIXED_OBLIGATION") return plan;
    switch (settings.fixedObligationPaymentPreference) {
      case "REQUIRE_ACH":
        if (settings.achEnabled) {
          return {
            ...plan,
            restrictToPaymentMethods: ["us_bank_account"],
            fallbackMessage:
              plan.fallbackMessage ??
              "This organization uses bank transfer (ACH) for online dues and required payments to reduce processing costs.",
          };
        }
        // §2 fail-safe: ACH unavailable never creates an unusable checkout.
        return {
          ...plan,
          restrictToPaymentMethods: null,
          fallbackMessage:
            "Bank transfer is temporarily unavailable, so card payment is open for this obligation — the organization absorbs the card-processing cost and you are credited in full. You can also pay by cash, check, or any offline method your organization accepts.",
        };
      case "PREFER_ACH":
        if (settings.achEnabled) {
          return {
            ...plan,
            // Order matters: Stripe Checkout lists methods in the order
            // given, so ACH renders first.
            restrictToPaymentMethods: ["us_bank_account", "card"],
            fallbackMessage:
              plan.fallbackMessage ??
              "Paying by bank transfer (ACH) helps the organization reduce processing costs. Card is also accepted.",
          };
        }
        return plan;
      case "CARD_AND_ABSORB":
      default:
        return plan;
    }
  };

  if (input.nature === "VOLUNTARY") {
    if (settings.voluntaryCoveragePolicy === "ORGANIZATION_ABSORBS") {
      return none("V2_ORGANIZATION_ABSORBED");
    }
    const { legacyOffered, coverageCents } = quote(input.payerOptedIn);
    if (!legacyOffered) return none("V2_ORGANIZATION_ABSORBED");
    return {
      offered: true,
      required: false,
      coverageCents,
      totalCents: input.baseCents + coverageCents,
      coverageMode: "V2_OPTIONAL",
      restrictToPaymentMethods: null,
      fallbackMessage: null,
      policyVersion,
    };
  }

  // FIXED_OBLIGATION (and EXEMPT resolves to org-absorbs by definition)
  if (input.nature === "EXEMPT" || settings.fixedObligationCoveragePolicy === "ORGANIZATION_ABSORBS") {
    return applyPaymentPreference(none("V2_ORGANIZATION_ABSORBED"));
  }

  // REQUIRED_WHERE_PERMITTED. Also requires the §6 acknowledgment on file.
  const flags = getGlobalCostPolicyFlags();
  const mandatoryPermitted =
    flags.mandatoryObligationCoverage && flags.paymentMethodEligibilityCheck && settings.policyAcceptedAt !== null;

  if (mandatoryPermitted) {
    // Reachable only once a compliant eligibility mechanism ships (both
    // flags on). Coverage is required and non-removable (§8).
    const coverageCents = calculateProcessingCostCoverageCents(
      input.baseCents,
      settings.processingCostCoveragePercentBps,
      settings.processingCostCoverageFixedCents
    );
    return applyPaymentPreference({
      offered: true,
      required: true,
      coverageCents,
      totalCents: input.baseCents + coverageCents,
      coverageMode: "V2_REQUIRED",
      restrictToPaymentMethods: null,
      fallbackMessage: null,
      policyVersion,
    });
  }

  // Coverage cannot be applied compliantly → configured fallback (§5).
  // The member is credited full principal in every branch.
  switch (settings.ineligiblePaymentMethodFallback) {
    case "REQUIRE_ACH":
      if (settings.achEnabled) {
        return applyPaymentPreference({
          offered: false,
          required: false,
          coverageCents: 0,
          totalCents: input.baseCents,
          coverageMode: "V2_FALLBACK_REQUIRE_ACH",
          restrictToPaymentMethods: ["us_bank_account"],
          fallbackMessage:
            "Processing costs cannot be added to card payments right now. This payment uses bank transfer (ACH) instead.",
          policyVersion,
        });
      }
      // ACH not enabled → safe degradation to absorb, never a dead end.
      return applyPaymentPreference({
        ...none("V2_FALLBACK_ORGANIZATION_ABSORBED"),
        fallbackMessage:
          "Processing costs cannot be added to this payment method. The organization will absorb the processing cost — your payment is credited in full.",
        policyVersion,
      });
    case "OFFER_ALTERNATIVES":
      return applyPaymentPreference({
        ...none("V2_FALLBACK_OFFER_ALTERNATIVES"),
        fallbackMessage:
          "Processing costs cannot be added to this payment method. You can pay by another supported method, or continue — the organization will absorb the processing cost and your payment is credited in full.",
        policyVersion,
      });
    case "ORGANIZATION_ABSORBS":
    default:
      return applyPaymentPreference({
        ...none("V2_FALLBACK_ORGANIZATION_ABSORBED"),
        fallbackMessage: null,
        policyVersion,
      });
  }
}
