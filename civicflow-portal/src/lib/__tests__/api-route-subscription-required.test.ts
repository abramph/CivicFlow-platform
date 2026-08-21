import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { withApiErrorHandling } from "@/lib/api-route";
import { SubscriptionRequiredError } from "@/lib/subscription-gate";

describe("withApiErrorHandling — SubscriptionRequiredError becomes a structured 402", () => {
  it("returns 402 with code/reason/message and no Stripe identifiers or internal detail", async () => {
    const res = await withApiErrorHandling(async () => {
      throw new SubscriptionRequiredError(
        "TRIAL_EXPIRED",
        "Your organization's Unestra trial has ended. An organization owner must activate a subscription to restore access."
      );
    });
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      code: "ORGANIZATION_SUBSCRIPTION_REQUIRED",
      reason: "TRIAL_EXPIRED",
      message: "Your organization's Unestra trial has ended. An organization owner must activate a subscription to restore access.",
    });
    expect(JSON.stringify(body)).not.toMatch(/price_|sub_|cus_|sk_|rk_|stack/i);
  });

  it("preserves the specific reason for each denial cause", async () => {
    const res = await withApiErrorHandling(async () => {
      throw new SubscriptionRequiredError("SUBSCRIPTION_PAST_DUE", "Your organization's subscription payment is past due.");
    });
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.reason).toBe("SUBSCRIPTION_PAST_DUE");
  });
});
