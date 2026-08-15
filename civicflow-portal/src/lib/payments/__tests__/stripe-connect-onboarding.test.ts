import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrg = vi.fn();
const findUniqueAccount = vi.fn();
const createAccountRow = vi.fn();
const upsertAccount = vi.fn();
const updateAccount = vi.fn();
const stripeAccountsCreate = vi.fn();
const stripeAccountsRetrieve = vi.fn();
const stripeAccountLinksCreate = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
let testKey: string | undefined = "sk_test_x";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrg(...a) },
    organizationStripeAccount: {
      findUnique: (...a: unknown[]) => findUniqueAccount(...a),
      create: (...a: unknown[]) => createAccountRow(...a),
      upsert: (...a: unknown[]) => upsertAccount(...a),
      update: (...a: unknown[]) => updateAccount(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    accounts: { create: (...a: unknown[]) => stripeAccountsCreate(...a), retrieve: (...a: unknown[]) => stripeAccountsRetrieve(...a) },
    accountLinks: { create: (...a: unknown[]) => stripeAccountLinksCreate(...a) },
  }),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ STRIPE_TEST_SECRET_KEY: testKey, NEXTAUTH_URL: "https://app.example" }) }));
vi.mock("stripe", () => ({
  default: class MockStripe {
    accounts = { create: (...a: unknown[]) => stripeAccountsCreate(...a), retrieve: (...a: unknown[]) => stripeAccountsRetrieve(...a) };
    accountLinks = { create: (...a: unknown[]) => stripeAccountLinksCreate(...a) };
  },
}));

import { refreshAccountStatus, startConnectOnboarding } from "@/lib/payments/stripe-connect";

beforeEach(() => {
  vi.clearAllMocks();
  testKey = "sk_test_x";
  stripeAccountsCreate.mockResolvedValue({ id: "acct_new" });
  stripeAccountLinksCreate.mockResolvedValue({ url: "https://connect.stripe.com/setup/x" });
  upsertAccount.mockResolvedValue({});
  updateAccount.mockResolvedValue({});
  findUniqueAccount.mockResolvedValue(null);
});

describe("startConnectOnboarding (§3/§6/§10)", () => {
  it("creates a STANDARD account + hosted link for a live org — mode decided server-side", async () => {
    findUniqueOrg.mockResolvedValueOnce({ name: "Real Org", email: "org@example.com", billingExempt: false });
    const result = await startConnectOnboarding({ organizationId: "org-1", baseUrl: "https://app.example", actorUserId: "own" });
    expect(result.accountMode).toBe("live");
    expect(stripeAccountsCreate.mock.calls[0][0]).toMatchObject({ type: "standard" });
    expect(createAccountRow.mock.calls[0][0].data).toMatchObject({
      organizationId: "org-1",
      stripeAccountId: "acct_new",
      onboardingStatus: "ONBOARDING_STARTED",
    });
    const link = stripeAccountLinksCreate.mock.calls[0][0];
    expect(link.return_url).toBe("https://app.example/settings/payments?stripe=return");
    expect(result.url).toContain("connect.stripe.com");
  });

  it("billing-exempt org + test key configured → TEST-MODE account", async () => {
    findUniqueOrg.mockResolvedValueOnce({ name: "Demo Church", email: null, billingExempt: true });
    const result = await startConnectOnboarding({ organizationId: "org-demo", baseUrl: "https://app.example", actorUserId: "own" });
    expect(result.accountMode).toBe("test");
  });

  it("billing-exempt WITHOUT a test key falls back to live (never fails open into test)", async () => {
    testKey = undefined;
    findUniqueOrg.mockResolvedValueOnce({ name: "Demo Church", email: null, billingExempt: true });
    const result = await startConnectOnboarding({ organizationId: "org-demo", baseUrl: "https://app.example", actorUserId: "own" });
    expect(result.accountMode).toBe("live");
  });

  it("a never-submitted account with the WRONG mode is corrected in place, not permanently pinned", async () => {
    // Real incident: an account was created in "live" mode before the test
    // key was ever configured; once the key exists, the next attempt must
    // switch modes rather than resuming the stale live shell forever.
    findUniqueOrg.mockResolvedValueOnce({ name: "Demo Church", email: null, billingExempt: true });
    findUniqueAccount.mockResolvedValueOnce({
      organizationId: "org-demo",
      stripeAccountId: "acct_old_live",
      accountMode: "live",
      detailsSubmitted: false,
      disabledAt: null,
    });
    stripeAccountsCreate.mockResolvedValueOnce({ id: "acct_new_test" });
    const result = await startConnectOnboarding({ organizationId: "org-demo", baseUrl: "https://app.example", actorUserId: "own" });
    expect(result.accountMode).toBe("test");
    expect(result.resumed).toBe(false);
    expect(stripeAccountsCreate).toHaveBeenCalledTimes(1);
    // The existing ROW is updated in place — never a second row.
    expect(createAccountRow).not.toHaveBeenCalled();
    const updateCall = updateAccount.mock.calls.find((call) => call[0]?.data?.stripeAccountId === "acct_new_test");
    expect(updateCall?.[0]).toMatchObject({
      where: { organizationId: "org-demo" },
      data: { stripeAccountId: "acct_new_test", accountMode: "test", onboardingStatus: "ONBOARDING_STARTED" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payments.stripe_account_mode_corrected" })
    );
  });

  it("a SUBMITTED account keeps its mode even if the desired mode later changes", async () => {
    findUniqueOrg.mockResolvedValueOnce({ name: "Demo Church", email: null, billingExempt: true });
    findUniqueAccount.mockResolvedValueOnce({
      organizationId: "org-demo",
      stripeAccountId: "acct_submitted_live",
      accountMode: "live",
      detailsSubmitted: true,
      disabledAt: null,
    });
    const result = await startConnectOnboarding({ organizationId: "org-demo", baseUrl: "https://app.example", actorUserId: "own" });
    expect(result.accountMode).toBe("live");
    expect(result.resumed).toBe(true);
    expect(stripeAccountsCreate).not.toHaveBeenCalled();
  });

  it("an existing account RESUMES (no second account is created); a disconnected one refuses", async () => {
    findUniqueOrg.mockResolvedValue({ name: "Org", email: null, billingExempt: false });
    findUniqueAccount.mockResolvedValueOnce({ stripeAccountId: "acct_existing", accountMode: "live", disabledAt: null });
    const result = await startConnectOnboarding({ organizationId: "org-1", baseUrl: "https://app.example", actorUserId: "own" });
    expect(result.resumed).toBe(true);
    expect(stripeAccountsCreate).not.toHaveBeenCalled();
    expect(stripeAccountLinksCreate.mock.calls[0][0].account).toBe("acct_existing");

    findUniqueAccount.mockResolvedValueOnce({ stripeAccountId: "acct_x", accountMode: "live", disabledAt: new Date() });
    await expect(
      startConnectOnboarding({ organizationId: "org-1", baseUrl: "https://app.example", actorUserId: "own" })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("refreshAccountStatus (§6 — return proves nothing, only provider truth does)", () => {
  it("fetches the account from Stripe and persists the derived snapshot", async () => {
    findUniqueAccount
      .mockResolvedValueOnce({ stripeAccountId: "acct_1", accountMode: "live" }) // refresh lookup
      .mockResolvedValueOnce({ // getAccountView lookup
        onboardingStatus: "PAYMENTS_ENABLED",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsCurrentlyDueCount: 0,
        country: "US",
        defaultCurrency: "usd",
        connectedAt: new Date(),
        lastSyncedAt: new Date(),
        disabledAt: null,
        accountMode: "live",
      });
    stripeAccountsRetrieve.mockResolvedValueOnce({
      id: "acct_1",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], eventually_due: [] },
    });
    const view = await refreshAccountStatus("org-1");
    expect(upsertAccount).toHaveBeenCalled();
    expect(view?.statusLabel).toBe("Payments enabled");
  });

  it("no account row → 404 (nothing to sync)", async () => {
    findUniqueAccount.mockResolvedValueOnce(null);
    await expect(refreshAccountStatus("org-1")).rejects.toMatchObject({ status: 404 });
  });
});
