import type { OrganizationVertical } from "@prisma/client";

/**
 * Unestra Cloud pricing (CLOUD-B) — per-vertical, unlimited-ordinary-member
 * subscription plans. See docs/unestra-cloud-pricing-architecture.md for the
 * audit this replaces, the approved pricing table, and the explicitly-flagged
 * assumptions (seat pricing and feature-bundle parity were not specified in
 * the product brief and are carried over from the legacy `essential`/`elite`
 * tiers rather than invented here).
 *
 * `free`/`essential`/`elite` are kept ONLY so getPlan()/planRank() can still
 * resolve historical Organization.plan / Subscription.plan string values
 * already sitting in the database — they are not offered at checkout
 * anymore (see /api/billing/checkout's accepted-plan validation).
 */
export type CloudPlanId =
  | "pta_monthly"
  | "pta_annual"
  | "community_monthly"
  | "community_annual"
  | "church_monthly"
  | "church_annual"
  | "union_monthly"
  | "union_annual";
export type LegacyPlanId = "free" | "essential" | "elite";
export type PlanId = CloudPlanId | LegacyPlanId;
export type BillingInterval = "month" | "year";

/**
 * The four vertical price points a Cloud plan can belong to. HOA folds into
 * COMMUNITY pricing (explicit product decision, 2026-08-18) rather than
 * getting its own price — see resolvePricingVertical().
 */
export type PricingVertical = "PTA" | "COMMUNITY" | "CHURCH" | "UNION";

/** Maps an org's actual OrganizationVertical (5 values) onto the 4 pricing
 * verticals. HOA -> COMMUNITY is the only non-identity mapping. */
export function resolvePricingVertical(vertical: OrganizationVertical): PricingVertical {
  if (vertical === "HOA") return "COMMUNITY";
  return vertical;
}

export interface PlanLimits {
  /** Always Infinity for every Cloud plan — unlimited ordinary members is
   * universal, not a plan feature (see checkMemberLimit/requireMemberSlot,
   * now permanent no-ops). Kept on the type so getOrganizationEntitlements's
   * display consumers don't need a separate code path for legacy plans that
   * still resolve a finite legacy limit. */
  members: number;
  emailCampaigns: boolean;
  pdfExport: boolean;
  advancedReports: boolean;
  apiAccess: boolean;
}

/**
 * Every plan-gated boolean capability (everything in PlanLimits except the
 * numeric `members` limit, which has its own checkMemberLimit/requireMemberSlot
 * pair). Deriving this from PlanLimits instead of hand-listing the strings
 * means adding a new Unestra Labs flag (meetingIntelligence, aiAnnouncements,
 * etc.) to PlanLimits automatically makes it a valid requirePlanFeature()
 * argument — no second list to keep in sync.
 */
export type FeatureKey = Exclude<keyof PlanLimits, "members">;

export interface PlanConfig {
  id: PlanId;
  name: string;
  description: string;
  /** null for legacy plans that don't belong to a pricing vertical. */
  vertical: PricingVertical | null;
  /** null for legacy plans (their id already encodes no interval) or the
   * free plan (no billing interval at all). */
  interval: BillingInterval | null;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  monthlyPriceEnvKey: string | null;
  yearlyPriceEnvKey: string | null;
  seatMonthlyPriceEnvKey: string | null;
  seatYearlyPriceEnvKey: string | null;
  includedSeats: number;
  additionalSeatCentsMonthly: number;
  additionalSeatCentsYearly: number;
  /** @deprecated use monthlyPriceEnvKey */
  priceEnvKey: string | null;
  limits: PlanLimits;
  highlights: string[];
  /** False for the legacy tiers — excluded from /pricing and
   * /api/billing/checkout's accepted-plan list, but still resolvable by
   * getPlan() for historical data. */
  active: boolean;
  /** Stable Stripe Price lookup key convention (see
   * scripts/setup-stripe-cloud-prices — CLOUD-E), e.g.
   * "unestra_cloud_pta_monthly". Null for legacy plans. */
  stripeLookupKey: string | null;
  /** Display order on /pricing. Legacy plans sort last. */
  displayOrder: number;
}

/**
 * CLOUD-I: Cloud plans never charge for administrative seats. This is
 * display-only historical/informational data (matches the real included
 * admin-seat allowance in src/lib/admin-seats.ts's INCLUDED_ADMIN_SEATS —
 * duplicated here as a plain literal rather than imported, since admin-
 * seats.ts imports resolvePricingVertical from this very file and importing
 * back would create a cycle). No seatMonthlyPriceEnvKey/seatYearlyPriceEnvKey
 * is ever set for a Cloud plan, so seatPriceIdForPlan() always returns null
 * for them and no checkout can ever add a seat line item — this is enforced
 * structurally, not just by the checkout route no longer asking for a
 * quantity. If this number ever needs to change, update
 * admin-seats.ts's INCLUDED_ADMIN_SEATS too — they must stay in sync.
 */
const CLOUD_INCLUDED_ADMIN_SEATS: Record<PricingVertical, number> = {
  PTA: 10,
  COMMUNITY: 10,
  CHURCH: 15,
  UNION: 15,
};

/** Every Cloud plan grants the same full entitlement bundle — pricing here
 * is driven by vertical, not a feature ladder (no differentiated per-
 * vertical feature matrix was specified). Matches the legacy `elite` tier. */
const CLOUD_FEATURE_BUNDLE: Omit<PlanLimits, "members"> = {
  emailCampaigns: true,
  pdfExport: true,
  advancedReports: true,
  apiAccess: true,
};

function cloudPlan(args: {
  id: CloudPlanId;
  name: string;
  vertical: PricingVertical;
  interval: BillingInterval;
  priceCents: number;
  priceEnvKey: string;
  displayOrder: number;
}): PlanConfig {
  const isMonthly = args.interval === "month";
  return {
    id: args.id,
    name: args.name,
    description: `Unestra Cloud for ${args.vertical === "COMMUNITY" ? "community & nonprofit" : args.vertical.toLowerCase()} organizations — unlimited members.`,
    vertical: args.vertical,
    interval: args.interval,
    monthlyPriceCents: isMonthly ? args.priceCents : 0,
    yearlyPriceCents: isMonthly ? 0 : args.priceCents,
    monthlyPriceEnvKey: isMonthly ? args.priceEnvKey : null,
    yearlyPriceEnvKey: isMonthly ? null : args.priceEnvKey,
    // No paid seat add-on at launch (CLOUD-I) — null env keys make
    // seatPriceIdForPlan() always return null for a Cloud plan, so no
    // checkout can ever attach a seat line item.
    seatMonthlyPriceEnvKey: null,
    seatYearlyPriceEnvKey: null,
    includedSeats: CLOUD_INCLUDED_ADMIN_SEATS[args.vertical],
    additionalSeatCentsMonthly: 0,
    additionalSeatCentsYearly: 0,
    priceEnvKey: args.priceEnvKey,
    limits: { members: Infinity, ...CLOUD_FEATURE_BUNDLE },
    highlights: [
      "Unlimited members",
      `${CLOUD_INCLUDED_ADMIN_SEATS[args.vertical]} administrative seats included`,
      "Email campaigns",
      "PDF export",
      "Advanced reports & analytics",
      "API access",
    ],
    active: true,
    stripeLookupKey: `unestra_cloud_${args.id}`,
    displayOrder: args.displayOrder,
  };
}

export const CLOUD_PLANS: Record<CloudPlanId, PlanConfig> = {
  pta_monthly: cloudPlan({ id: "pta_monthly", name: "Unestra Cloud — PTA/PTO", vertical: "PTA", interval: "month", priceCents: 4900, priceEnvKey: "STRIPE_PRICE_PTA_MONTHLY", displayOrder: 0 }),
  pta_annual: cloudPlan({ id: "pta_annual", name: "Unestra Cloud — PTA/PTO", vertical: "PTA", interval: "year", priceCents: 49000, priceEnvKey: "STRIPE_PRICE_PTA_YEARLY", displayOrder: 1 }),
  community_monthly: cloudPlan({ id: "community_monthly", name: "Unestra Cloud — Community", vertical: "COMMUNITY", interval: "month", priceCents: 5900, priceEnvKey: "STRIPE_PRICE_COMMUNITY_MONTHLY", displayOrder: 2 }),
  community_annual: cloudPlan({ id: "community_annual", name: "Unestra Cloud — Community", vertical: "COMMUNITY", interval: "year", priceCents: 59000, priceEnvKey: "STRIPE_PRICE_COMMUNITY_YEARLY", displayOrder: 3 }),
  church_monthly: cloudPlan({ id: "church_monthly", name: "Unestra Cloud — Church", vertical: "CHURCH", interval: "month", priceCents: 7900, priceEnvKey: "STRIPE_PRICE_CHURCH_MONTHLY", displayOrder: 4 }),
  church_annual: cloudPlan({ id: "church_annual", name: "Unestra Cloud — Church", vertical: "CHURCH", interval: "year", priceCents: 79000, priceEnvKey: "STRIPE_PRICE_CHURCH_YEARLY", displayOrder: 5 }),
  union_monthly: cloudPlan({ id: "union_monthly", name: "Unestra Cloud — Union", vertical: "UNION", interval: "month", priceCents: 12900, priceEnvKey: "STRIPE_PRICE_UNION_MONTHLY", displayOrder: 6 }),
  union_annual: cloudPlan({ id: "union_annual", name: "Unestra Cloud — Union", vertical: "UNION", interval: "year", priceCents: 129000, priceEnvKey: "STRIPE_PRICE_UNION_YEARLY", displayOrder: 7 }),
};

const LEGACY_PLANS: Record<LegacyPlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    description: "Internal state — no public free plan.",
    vertical: null,
    interval: null,
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    monthlyPriceEnvKey: null,
    yearlyPriceEnvKey: null,
    seatMonthlyPriceEnvKey: null,
    seatYearlyPriceEnvKey: null,
    includedSeats: 3,
    additionalSeatCentsMonthly: 0,
    additionalSeatCentsYearly: 0,
    priceEnvKey: null,
    limits: { members: 50, emailCampaigns: false, pdfExport: false, advancedReports: false, apiAccess: false },
    highlights: [],
    active: false,
    stripeLookupKey: null,
    displayOrder: 100,
  },
  essential: {
    id: "essential",
    name: "Essential (legacy)",
    description: "Legacy plan — no longer sold. Kept for historical Organization/Subscription records.",
    vertical: null,
    interval: null,
    monthlyPriceCents: 4900,
    yearlyPriceCents: 53900,
    monthlyPriceEnvKey: "STRIPE_PRICE_ESSENTIAL_MONTHLY",
    yearlyPriceEnvKey: "STRIPE_PRICE_ESSENTIAL_YEARLY",
    seatMonthlyPriceEnvKey: "STRIPE_PRICE_ESSENTIAL_SEAT_MONTHLY",
    seatYearlyPriceEnvKey: "STRIPE_PRICE_ESSENTIAL_SEAT_YEARLY",
    includedSeats: 3,
    additionalSeatCentsMonthly: 800,
    additionalSeatCentsYearly: 8800,
    priceEnvKey: "STRIPE_PRICE_ESSENTIAL_MONTHLY",
    limits: { members: 500, emailCampaigns: true, pdfExport: true, advancedReports: false, apiAccess: false },
    highlights: [],
    active: false,
    stripeLookupKey: null,
    displayOrder: 101,
  },
  elite: {
    id: "elite",
    name: "Elite (legacy)",
    description: "Legacy plan — no longer sold. Kept for historical Organization/Subscription records.",
    vertical: null,
    interval: null,
    monthlyPriceCents: 9900,
    yearlyPriceCents: 108900,
    monthlyPriceEnvKey: "STRIPE_PRICE_ELITE_MONTHLY",
    yearlyPriceEnvKey: "STRIPE_PRICE_ELITE_YEARLY",
    seatMonthlyPriceEnvKey: "STRIPE_PRICE_ELITE_SEAT_MONTHLY",
    seatYearlyPriceEnvKey: "STRIPE_PRICE_ELITE_SEAT_YEARLY",
    includedSeats: 10,
    additionalSeatCentsMonthly: 500,
    additionalSeatCentsYearly: 5500,
    priceEnvKey: "STRIPE_PRICE_ELITE_MONTHLY",
    limits: { members: Infinity, emailCampaigns: true, pdfExport: true, advancedReports: true, apiAccess: true },
    highlights: [],
    active: false,
    stripeLookupKey: null,
    displayOrder: 102,
  },
};

export const PLANS: Record<PlanId, PlanConfig> = { ...CLOUD_PLANS, ...LEGACY_PLANS };

export function getPlan(planId: string): PlanConfig {
  return PLANS[planId as PlanId] ?? PLANS.community_monthly;
}

/** The two Cloud plans (monthly + annual) sold for a given pricing
 * vertical, in display order. */
export function plansForVertical(vertical: PricingVertical): PlanConfig[] {
  return Object.values(CLOUD_PLANS)
    .filter((p) => p.vertical === vertical)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Every active (sold) Cloud plan, in display order — for /pricing. */
export function activePlans(): PlanConfig[] {
  return Object.values(CLOUD_PLANS).sort((a, b) => a.displayOrder - b.displayOrder);
}

export function planRank(planId: string): number {
  // Legacy free < legacy essential < legacy elite < any Cloud plan. Cloud
  // plans don't have a meaningful relative rank against each other (they're
  // different verticals, not tiers of one ladder) — they all rank above the
  // legacy ladder, equally, since this function exists for "did the org
  // upgrade" checks against historical legacy state, not Cloud-to-Cloud
  // comparison.
  const legacyRanks: Record<LegacyPlanId, number> = { free: 0, essential: 1, elite: 2 };
  if (planId in legacyRanks) return legacyRanks[planId as LegacyPlanId];
  return planId in CLOUD_PLANS ? 3 : 0;
}

export function isPaidPlan(planId: string): boolean {
  if (planId in CLOUD_PLANS) return true;
  return planId === "essential" || planId === "elite";
}
