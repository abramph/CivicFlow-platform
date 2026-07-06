import type { PaymentReportCategory } from "@prisma/client";

/** Single source of truth for valid PaymentReport categories and their display labels. */
export const PAYMENT_REPORT_CATEGORIES = [
  "MEMBERSHIP_DUES",
  "EVENT_REGISTRATION",
  "DONATION",
  "FUNDRAISER",
  "MERCHANDISE",
  "SPONSORSHIP",
  "ASSESSMENT",
  "OTHER",
] as const satisfies readonly PaymentReportCategory[];

export const PAYMENT_REPORT_CATEGORY_LABELS: Record<PaymentReportCategory, string> = {
  MEMBERSHIP_DUES: "Membership Dues",
  EVENT_REGISTRATION: "Event Registration",
  DONATION: "Donation",
  FUNDRAISER: "Fundraiser",
  MERCHANDISE: "Merchandise",
  SPONSORSHIP: "Sponsorship",
  ASSESSMENT: "Assessment",
  OTHER: "Other",
};
