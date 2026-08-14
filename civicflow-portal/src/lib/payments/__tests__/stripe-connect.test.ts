import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueAccount = vi.fn();
const upsertAccount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationStripeAccount: {
      findUnique: (...a: unknown[]) => findUniqueAccount(...a),
      upsert: (...a: unknown[]) => upsertAccount(...a),
    },
  },
}));

import {
  deriveAccountStatus,
  recordAccountSync,
  resolveConnectedAccountForCharges,
} from "@/lib/payments/stripe-connect";
import { permissionsFor } from "@/lib/rbac";

beforeEach(() => {
  vi.clearAllMocks();
  upsertAccount.mockImplementation(async (args: { create: Record<string, unknown> }) => args.create);
});

describe("§5 status derivation (pure)", () => {
  it("maps provider snapshots to the six stored states", () => {
    expect(deriveAccountStatus({ id: "acct_1" })).toBe("ONBOARDING_STARTED");
    expect(deriveAccountStatus({ id: "acct_1", details_submitted: true })).toBe("CONNECTED");
    expect(
      deriveAccountStatus({ id: "acct_1", details_submitted: true, requirements: { currently_due: ["external_account"] } })
    ).toBe("ACTION_REQUIRED");
    expect(deriveAccountStatus({ id: "acct_1", charges_enabled: true, details_submitted: true })).toBe("PAYMENTS_ENABLED");
    expect(
      deriveAccountStatus({ id: "acct_1", charges_enabled: true, requirements: { currently_due: ["individual.id_number"] } })
    ).toBe("ACTION_REQUIRED");
    expect(
      deriveAccountStatus({ id: "acct_1", requirements: { disabled_reason: "requirements.past_due" } })
    ).toBe("RESTRICTED");
    expect(deriveAccountStatus({ id: "acct_1", requirements: { disabled_reason: "rejected.fraud" } })).toBe("DISABLED");
  });
});

describe("§10/§55 server-side charge-context resolution", () => {
  it("no account row → payments-not-set-up 409, and the signature admits no client account id", async () => {
    findUniqueAccount.mockResolvedValueOnce(null);
    await expect(resolveConnectedAccountForCharges("org-1")).rejects.toMatchObject({ status: 409 });
    // §62.2 structural guarantee: organizationId is the ONLY input.
    expect(resolveConnectedAccountForCharges.length).toBe(1);
  });

  it("disconnected (disabledAt) and charges-disabled accounts both refuse", async () => {
    findUniqueAccount.mockResolvedValueOnce({ stripeAccountId: "acct_1", chargesEnabled: true, disabledAt: new Date() });
    await expect(resolveConnectedAccountForCharges("org-1")).rejects.toMatchObject({ status: 409 });

    findUniqueAccount.mockResolvedValueOnce({ stripeAccountId: "acct_1", chargesEnabled: false, disabledAt: null });
    await expect(resolveConnectedAccountForCharges("org-1")).rejects.toMatchObject({ status: 409 });
  });

  it("a charges-enabled account resolves to ITS OWN acct id, queried by the caller's org", async () => {
    findUniqueAccount.mockResolvedValueOnce({ stripeAccountId: "acct_own", chargesEnabled: true, disabledAt: null, accountMode: "live" });
    const context = await resolveConnectedAccountForCharges("org-1");
    expect(context.stripeConnectedAccountId).toBe("acct_own");
    expect(findUniqueAccount.mock.calls[0][0].where).toEqual({ organizationId: "org-1" });
  });
});

describe("account sync (§4 — identifiers only, never credentials)", () => {
  it("persists provider truth without any secret-shaped fields", async () => {
    await recordAccountSync(
      "org-1",
      {
        id: "acct_1",
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        country: "US",
        default_currency: "usd",
        requirements: { currently_due: [], eventually_due: ["future.thing"] },
      },
      "test"
    );
    const created = upsertAccount.mock.calls[0][0].create;
    expect(created).toMatchObject({
      stripeAccountId: "acct_1",
      onboardingStatus: "PAYMENTS_ENABLED",
      chargesEnabled: true,
      payoutsEnabled: false,
      requirementsEventuallyDueCount: 1,
      accountMode: "test",
    });
    for (const key of Object.keys(created)) {
      expect(/secret|key|token|password/i.test(key)).toBe(false);
    }
  });
});

describe("§6 RBAC — finance can look, only officers can wire", () => {
  it("OWNER/ADMIN hold all four; FINANCE holds view+refresh only; STAFF holds none", () => {
    for (const role of ["ORG_OWNER", "ORG_ADMIN"] as const) {
      const permissions = permissionsFor(role);
      for (const p of ["payments:stripe:view", "payments:stripe:refresh", "payments:stripe:connect", "payments:stripe:manage"]) {
        expect(permissions).toContain(p);
      }
    }
    const finance = permissionsFor("FINANCE");
    expect(finance).toContain("payments:stripe:view");
    expect(finance).toContain("payments:stripe:refresh");
    expect(finance).not.toContain("payments:stripe:connect");
    expect(finance).not.toContain("payments:stripe:manage");

    const staff = permissionsFor("STAFF");
    for (const p of ["payments:stripe:view", "payments:stripe:refresh", "payments:stripe:connect", "payments:stripe:manage"]) {
      expect(staff).not.toContain(p);
    }
  });
});
