export type PlanId = "free" | "essential" | "elite";
export type BillingInterval = "month" | "year";

export interface PlanLimits {
  members: number;           // Infinity = unlimited
  emailCampaigns: boolean;
  pdfExport: boolean;
  advancedReports: boolean;
  apiAccess: boolean;
}

export interface PlanConfig {
  id: PlanId;
  name: string;
  description: string;
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
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    description: "Internal state — no public free plan.",
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
  },
  essential: {
    id: "essential",
    name: "Essential",
    description: "For growing organizations that need full member management and communication tools.",
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
    highlights: [
      "Up to 500 members",
      "3 portal user seats included",
      "Email & SMS campaigns",
      "PDF export",
      "Attendance tracking",
      "Payment import & reconciliation",
    ],
  },
  elite: {
    id: "elite",
    name: "Elite",
    description: "Unlimited scale with every feature for large or fast-growing organizations.",
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
    highlights: [
      "Unlimited members",
      "10 portal user seats included",
      "Advanced reports & analytics",
      "API access",
      "Priority support",
      "All Essential features",
    ],
  },
};

export function getPlan(planId: string): PlanConfig {
  return PLANS[(planId as PlanId)] ?? PLANS.essential;
}

export function planRank(planId: string): number {
  const ranks: Record<PlanId, number> = { free: 0, essential: 1, elite: 2 };
  return ranks[(planId as PlanId)] ?? 0;
}

export function isPaidPlan(planId: string): boolean {
  return planId === "essential" || planId === "elite";
}
