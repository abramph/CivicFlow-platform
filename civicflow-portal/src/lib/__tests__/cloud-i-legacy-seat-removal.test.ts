import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * CLOUD-I: a targeted regression scan over customer-facing rendered
 * surfaces only — never historical migrations, comments, or non-rendered
 * code, which would make this scan noisy and meaningless. Each banned
 * string represents a real, previously-live piece of the legacy paid-seat
 * add-on or obsolete pricing language.
 */
const CUSTOMER_FACING_FILES = [
  "../../components/app/BillingPlans.tsx",
  "../../components/app/BillingActions.tsx",
  "../../app/pricing/PricingContent.tsx",
  "../../app/settings/billing/page.tsx",
  // CLOUD-K: the trial-expiration SubscriptionWall lives here — it shipped
  // with obsolete Essential/Elite cards and a "500 member" cap for weeks
  // because this scan didn't cover it.
  "../../app/(portal)/layout.tsx",
].map((rel) => path.resolve(__dirname, rel));

const BANNED_PATTERNS: [string, RegExp][] = [
  ["+$8 seat pricing", /\+\$8/],
  ["'3 portal' seat count", /3 portal/i],
  ["additional seat purchase language", /additional seats?\s+(available for purchase|purchase)/i],
  ["per-member pricing language", /per[- ]member/i],
  ["obsolete SaaS branding", /Unestra SaaS/],
  // CLOUD-J: the annual discount is now exactly one month, and the 30-day
  // trial is a separate concept — "X months free" marketing is obsolete and
  // conflates the two.
  ["obsolete 'months free' annual marketing", /months? free/i],
  // CLOUD-K: member caps don't exist on any plan — "Up to N members" is
  // always a stale-legacy-catalog leak on a customer-facing surface.
  ["obsolete member-cap language", /up to [\d,]+ members/i],
  ["retired Essential/Elite tier marketing", /Subscribe to Essential|Essential or Elite/],
];

describe("CLOUD-I: customer-facing surfaces never reintroduce legacy paid-seat/pricing language", () => {
  for (const filePath of CUSTOMER_FACING_FILES) {
    const source = readFileSync(filePath, "utf8");
    const relName = path.basename(filePath);

    for (const [label, pattern] of BANNED_PATTERNS) {
      it(`${relName} does not contain ${label}`, () => {
        expect(source).not.toMatch(pattern);
      });
    }
  }

  it("BillingPlans.tsx has no seat-quantity stepper control", () => {
    const source = readFileSync(path.resolve(__dirname, "../../components/app/BillingPlans.tsx"), "utf8");
    expect(source).not.toMatch(/SeatStepper|additionalSeats/);
  });

  it("BillingActions.tsx's checkout POST body never includes a seat field", () => {
    const source = readFileSync(path.resolve(__dirname, "../../components/app/BillingActions.tsx"), "utf8");
    expect(source).not.toMatch(/additionalSeats/);
  });
});
