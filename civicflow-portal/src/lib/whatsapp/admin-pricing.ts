import { WHATSAPP_ADDON } from "@/lib/whatsapp/pricing";

/**
 * Internal cost-tracking for the WhatsApp Administration module (PR D) —
 * purely for the super-admin cost/profit dashboard, mirrors
 * sms-admin-pricing.ts's shape. Simpler than SMS's version: WhatsApp has no
 * plan-tier system (a user-confirmed PR D scope decision — flat pricing
 * only), so there's a single WHATSAPP_ADDON.monthlyPriceCents rather than a
 * per-org planPriceCents field, and no carrier-fee line item (no such field
 * exists on PlatformWhatsAppSettings, and Meta's conversation-based pricing
 * doesn't map onto SMS's carrier-fee model).
 */
export interface OrgWhatsAppChargeInput {
  whatsappMonthlyLimit: number;
  whatsappUsedThisPeriod: number;
  whatsappOverageRateCents: number;
}

export interface OrgWhatsAppCharge {
  planPriceCents: number;
  overageMessages: number;
  overageChargeCents: number;
  totalChargeCents: number;
}

/** Computes what an org "owes" this period, for display only — this never touches Stripe. */
export function computeOrgWhatsAppCharges(settings: OrgWhatsAppChargeInput): OrgWhatsAppCharge {
  const overageMessages = Math.max(0, settings.whatsappUsedThisPeriod - settings.whatsappMonthlyLimit);
  const overageChargeCents = overageMessages * settings.whatsappOverageRateCents;
  return {
    planPriceCents: WHATSAPP_ADDON.monthlyPriceCents,
    overageMessages,
    overageChargeCents,
    totalChargeCents: WHATSAPP_ADDON.monthlyPriceCents + overageChargeCents,
  };
}

export interface WhatsAppCostSummaryInput {
  organizations: OrgWhatsAppChargeInput[];
  /** Sum of WhatsAppMessage.actualCostCents (real Twilio Price) where known, falling back to costEstimateCents otherwise. */
  twilioCostCents: number;
}

export interface WhatsAppCostSummary {
  customerChargesCents: number;
  twilioCostCents: number;
  profitCents: number;
}

/** Cross-org rollup for the admin cost/profit dashboard. */
export function computeWhatsAppCostSummary(input: WhatsAppCostSummaryInput): WhatsAppCostSummary {
  const customerChargesCents = input.organizations.reduce(
    (sum, org) => sum + computeOrgWhatsAppCharges(org).totalChargeCents,
    0
  );
  return {
    customerChargesCents,
    twilioCostCents: input.twilioCostCents,
    profitCents: customerChargesCents - input.twilioCostCents,
  };
}
