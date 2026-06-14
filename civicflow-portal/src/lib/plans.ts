export type PlanId = "free" | "essential" | "elite";

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
  priceEnvKey: string | null;
  limits: PlanLimits;
  highlights: string[];
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    description: "Get started at no cost. Perfect for small orgs just getting organized.",
    monthlyPriceCents: 0,
    priceEnvKey: null,
    limits: {
      members: 50,
      emailCampaigns: false,
      pdfExport: false,
      advancedReports: false,
      apiAccess: false,
    },
    highlights: [
      "Up to 50 members",
      "Dues tracking",
      "Contributions",
      "Events & meetings",
      "CSV export",
    ],
  },
  essential: {
    id: "essential",
    name: "Essential",
    description: "For growing organizations that need full member management and communication tools.",
    monthlyPriceCents: 4900,
    priceEnvKey: "STRIPE_PRICE_ESSENTIAL_MONTHLY",
    limits: {
      members: 500,
      emailCampaigns: true,
      pdfExport: true,
      advancedReports: false,
      apiAccess: false,
    },
    highlights: [
      "Up to 500 members",
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
    priceEnvKey: "STRIPE_PRICE_ELITE_MONTHLY",
    limits: {
      members: Infinity,
      emailCampaigns: true,
      pdfExport: true,
      advancedReports: true,
      apiAccess: true,
    },
    highlights: [
      "Unlimited members",
      "Advanced reports & analytics",
      "API access",
      "Priority support",
      "All Essential features",
    ],
  },
};

export function getPlan(planId: string): PlanConfig {
  return PLANS[(planId as PlanId)] ?? PLANS.free;
}

export function planRank(planId: string): number {
  const ranks: Record<PlanId, number> = { free: 0, essential: 1, elite: 2 };
  return ranks[(planId as PlanId)] ?? 0;
}

export function isPaidPlan(planId: string): boolean {
  return planId === "essential" || planId === "elite";
}
