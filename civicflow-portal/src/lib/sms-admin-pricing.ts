/**
 * Internal cost-tracking plan tiers for the SMS Administration module —
 * purely for the super-admin cost/profit dashboard. Distinct from
 * SMS_ADDON (lib/sms-pricing.ts), which is still the real Stripe billing
 * constant that actually charges organizations; these tiers don't create
 * or touch any Stripe object.
 */
export type SmsPlanId = "STARTER" | "GROWTH" | "ENTERPRISE";

export interface SmsPlanTier {
  id: SmsPlanId;
  label: string;
  includedMessages: number;
  monthlyPriceCents: number;
  overageRateCents: number;
  /** ENTERPRISE has no fixed numbers — the admin types them in directly when assigning the plan. */
  custom: boolean;
}

export const SMS_PLAN_TIERS: Record<SmsPlanId, SmsPlanTier> = {
  STARTER: {
    id: "STARTER",
    label: "Starter",
    includedMessages: 1000,
    monthlyPriceCents: 1000,
    overageRateCents: 2,
    custom: false,
  },
  GROWTH: {
    id: "GROWTH",
    label: "Growth",
    includedMessages: 3000,
    monthlyPriceCents: 2500,
    overageRateCents: 1.5,
    custom: false,
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    label: "Enterprise",
    includedMessages: 0,
    monthlyPriceCents: 0,
    overageRateCents: 0,
    custom: true,
  },
};

export interface OrgSmsChargeInput {
  smsMonthlyLimit: number;
  smsUsedThisPeriod: number;
  smsOverageRateCents: number;
  planPriceCents: number;
}

export interface OrgSmsCharge {
  planPriceCents: number;
  overageMessages: number;
  overageChargeCents: number;
  totalChargeCents: number;
}

/** Computes what an org "owes" this period under its assigned plan, for display only — this never touches Stripe. */
export function computeOrgSmsCharges(settings: OrgSmsChargeInput): OrgSmsCharge {
  const overageMessages = Math.max(0, settings.smsUsedThisPeriod - settings.smsMonthlyLimit);
  const overageChargeCents = overageMessages * settings.smsOverageRateCents;
  return {
    planPriceCents: settings.planPriceCents,
    overageMessages,
    overageChargeCents,
    totalChargeCents: settings.planPriceCents + overageChargeCents,
  };
}

export interface SmsCostSummaryInput {
  organizations: OrgSmsChargeInput[];
  /** Sum of SmsMessage.actualCostCents (real Twilio Price) where known, falling back to costEstimateCents otherwise. */
  twilioCostCents: number;
  /** Configurable estimate — Twilio's basic Messages API doesn't expose carrier fees as their own line item. */
  carrierFeePercent: number;
}

export interface SmsCostSummary {
  customerChargesCents: number;
  twilioCostCents: number;
  carrierFeeCents: number;
  profitCents: number;
}

/** Cross-org rollup for the admin cost/profit dashboard. */
export function computeSmsCostSummary(input: SmsCostSummaryInput): SmsCostSummary {
  const customerChargesCents = input.organizations.reduce(
    (sum, org) => sum + computeOrgSmsCharges(org).totalChargeCents,
    0
  );
  const carrierFeeCents = Math.round((input.twilioCostCents * input.carrierFeePercent) / 100);
  const profitCents = customerChargesCents - input.twilioCostCents - carrierFeeCents;
  return { customerChargesCents, twilioCostCents: input.twilioCostCents, carrierFeeCents, profitCents };
}
