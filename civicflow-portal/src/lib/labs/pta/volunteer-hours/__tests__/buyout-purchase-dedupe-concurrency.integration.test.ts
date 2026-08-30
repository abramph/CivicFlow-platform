import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fix/pta-volunteer-financial-controls, RV-2 — real-database concurrency
 * test for PtaVolunteerBuyoutPurchase's partial unique index (see the
 * schema-drift warning on that model and the migration
 * 20260830172424_pta_volunteer_buyout_purchase_pending_dedupe/migration.sql).
 * Mirrors assessment-charge-dedupe-concurrency.integration.test.ts's
 * structure and skip convention exactly — real Postgres, real
 * `createVolunteerBuyoutCheckout`/`recordVolunteerBuyoutPurchase` functions,
 * real requirement period + pricing window + household + ledger. The ONE
 * deliberate fake is Stripe itself (`@/lib/payments/stripe-connect`) — this
 * suite exists to prove the DATABASE constraint holds under genuine
 * concurrent load, not to exercise Stripe's live API, so Stripe is replaced
 * with a small in-memory fake that mimics the two behaviors this code
 * actually depends on: a Checkout Session's `status` field, and Stripe's own
 * idempotency-key caching. That second part is a real, if narrow, limitation
 * of this suite — it proves our code passes a deterministic key and that a
 * *compliant* idempotency implementation would collapse a retried call, not
 * that Stripe's production infrastructure enforces it (that's Stripe's
 * responsibility, not ours, and untestable locally).
 *
 * Covers every scenario listed in the review's item 2: 2 simultaneous
 * preparations, 10 simultaneous preparations, same idempotency key,
 * different idempotency keys for the same obligation, a supersession race
 * against an already-completed purchase, retry after expiration, retry
 * after failure, an attempt after the household is already fully paid, and
 * a webhook arriving concurrently with a replacement checkout attempt.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting vitest:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   PTA_VOLUNTEER_PURCHASE_DEDUPE_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/volunteer-hours/__tests__/buyout-purchase-dedupe-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_VOLUNTEER_PURCHASE_DEDUPE_RUN_DB_INTEGRATION_TEST === "1";

const resolveConnectedAccountForCharges = vi.fn();
const getStripeForMode = vi.fn();
vi.mock("@/lib/payments/stripe-connect", () => ({
  resolveConnectedAccountForCharges: (...a: unknown[]) => resolveConnectedAccountForCharges(...a),
  getStripeForMode: (...a: unknown[]) => getStripeForMode(...a),
}));

interface FakeSession {
  id: string;
  url: string;
  status: "open" | "complete" | "expired";
}

function createFakeStripe() {
  const sessionsById = new Map<string, FakeSession>();
  const sessionsByIdempotencyKey = new Map<string, FakeSession>();
  let counter = 0;

  const create = vi.fn(async (_params: unknown, options: { stripeAccount?: string; idempotencyKey?: string }) => {
    if (options.idempotencyKey && sessionsByIdempotencyKey.has(options.idempotencyKey)) {
      return sessionsByIdempotencyKey.get(options.idempotencyKey)!;
    }
    counter += 1;
    const session: FakeSession = { id: `cs_test_${counter}`, url: `https://checkout.example.test/cs_test_${counter}`, status: "open" };
    sessionsById.set(session.id, session);
    if (options.idempotencyKey) sessionsByIdempotencyKey.set(options.idempotencyKey, session);
    return session;
  });

  const retrieve = vi.fn(async (id: string) => {
    const session = sessionsById.get(id);
    if (!session) throw new Error(`No such checkout.session: ${id}`);
    return session;
  });

  return { stripe: { checkout: { sessions: { create, retrieve } } }, sessionsById };
}

describe.skipIf(!RUN_INTEGRATION)("PtaVolunteerBuyoutPurchase — real duplicate-pending-purchase concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let householdId: string;
  let periodId: string;
  let actorUserId: string;
  let fakeStripe: ReturnType<typeof createFakeStripe>;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `pta-purchase-dedupe-${Date.now()}`, name: "Purchase Dedupe Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `purchase-dedupe-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const household = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Test Household", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    householdId = household.id;

    const now = new Date();
    const period = await prisma.ptaVolunteerRequirementPeriod.create({
      data: {
        organizationId: orgId,
        name: "Purchase Dedupe Test Period",
        periodType: "SCHOOL_YEAR",
        startsOn: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endsOn: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        requiredMinutesDefault: 1200,
        status: "ACTIVE",
      },
    });
    periodId = period.id;

    await prisma.ptaVolunteerPricingWindow.create({
      data: {
        organizationId: orgId,
        periodId,
        name: "Full buyout rate",
        startAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        rateType: "FULL_BUYOUT",
        amountCents: 25_000,
        active: true,
      },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakeStripe = createFakeStripe();
    resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_test", accountMode: "test" });
    getStripeForMode.mockResolvedValue(fakeStripe.stripe);
  });

  afterEach(async () => {
    await prisma?.ptaVolunteerLedgerEntry.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.pendingPayment.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerBuyoutPurchase.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  });

  afterAll(async () => {
    await prisma?.ptaVolunteerPricingWindow.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerRequirementPeriod.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaHousehold.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("real concurrency: 2 simultaneous checkout preparations produce exactly one PENDING purchase and at most one Stripe session", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId }))
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<{ url: string }> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const r of rejected) expect(r.reason).toMatchObject({ code: "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS" });
    // Every fulfilled call must point at the SAME url -- never two different sessions.
    expect(new Set(fulfilled.map((r) => r.value.url)).size).toBeLessThanOrEqual(1);

    const pendingCount = await prisma.ptaVolunteerBuyoutPurchase.count({
      where: { organizationId: orgId, requirementPeriodId: periodId, householdId, status: "PENDING" },
    });
    expect(pendingCount).toBe(1);
    expect(fakeStripe.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("real concurrency: 10 simultaneous checkout preparations produce exactly one PENDING purchase and at most one Stripe session", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId }))
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<{ url: string }> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled.length + rejected.length).toBe(10);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS" });
    expect(new Set(fulfilled.map((r) => r.value.url)).size).toBeLessThanOrEqual(1);

    const pendingCount = await prisma.ptaVolunteerBuyoutPurchase.count({
      where: { organizationId: orgId, requirementPeriodId: periodId, householdId, status: "PENDING" },
    });
    expect(pendingCount).toBe(1);
    // The database allowed exactly one row to exist -- so exactly one caller
    // ever reached Stripe, no matter how many of the 10 raced.
    expect(fakeStripe.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("same idempotency key: a retried call for the SAME purchase row's own checkout resolves to the identical Stripe session, never a second one", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });

    const purchase = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    const firstCallArgs = fakeStripe.stripe.checkout.sessions.create.mock.calls[0];
    const idempotencyKey = firstCallArgs[1].idempotencyKey;
    expect(idempotencyKey).toBe(`pta-volunteer-buyout-checkout:${purchase.id}`);

    // Simulate our own code retrying the exact same logical Stripe call
    // (e.g. after a lost/ambiguous network response) with the same key.
    const retried = await fakeStripe.stripe.checkout.sessions.create(firstCallArgs[0], { stripeAccount: "acct_test", idempotencyKey });
    expect(retried.id).toBe(purchase.providerSessionId);
    // Only one session was ever actually minted, despite two create() calls.
    expect(fakeStripe.sessionsById.size).toBe(1);
  });

  it("different idempotency keys for the same obligation never both reach Stripe -- the DB constraint, not the key, is what prevents duplication", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await Promise.allSettled(
      Array.from({ length: 2 }, () => createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId }))
    );

    // Each concurrent attempt would have derived a DIFFERENT key (from its
    // own would-be purchase row's id) had it reached Stripe -- but the
    // partial unique index ensures only one purchase row is ever created,
    // so create() is only ever invoked with ONE key, never two.
    expect(fakeStripe.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const keysUsed = fakeStripe.stripe.checkout.sessions.create.mock.calls.map((c: unknown[]) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keysUsed).size).toBe(1);
  });

  it("supersession race: a purchase already advanced to COMPLETED can never be superseded by a later request", async () => {
    const { createVolunteerBuyoutCheckout, recordVolunteerBuyoutPurchase } = await import("../purchases");
    await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    const purchaseA = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });

    const settleResult = await recordVolunteerBuyoutPurchase({
      organizationId: orgId,
      purchaseId: purchaseA.id,
      amountTotalCents: purchaseA.totalCents,
      stripeConnectedAccountId: "acct_test",
      providerPaymentIntentId: "pi_test_1",
      providerSessionId: purchaseA.providerSessionId!,
    });
    expect(settleResult).toEqual({ outcome: "RECORDED" });

    // The household's requirement is now fully satisfied -- a later request
    // must be rejected outright, never allowed to reach (and supersede) A.
    await expect(
      createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ALREADY_SATISFIED" });

    const refreshedA = await prisma.ptaVolunteerBuyoutPurchase.findUniqueOrThrow({ where: { id: purchaseA.id } });
    expect(refreshedA.status).toBe("COMPLETED");
  });

  it("retry after expiration: an expired Stripe session is superseded (not reused), and a fresh purchase+session is created", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const first = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    const purchaseA = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    fakeStripe.sessionsById.get(purchaseA.providerSessionId!)!.status = "expired";

    const second = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    expect(second.url).not.toBe(first.url);

    const refreshedA = await prisma.ptaVolunteerBuyoutPurchase.findUniqueOrThrow({ where: { id: purchaseA.id } });
    expect(refreshedA.status).toBe("FAILED");
    const pendingCount = await prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    expect(pendingCount).toBe(1);
  });

  it("retry after failure: a FAILED purchase is preserved (never deleted) and a fresh retry creates a new row normally", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    const purchaseA = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    // Simulate some other failure path (e.g. Stripe declined) marking it FAILED.
    await prisma.ptaVolunteerBuyoutPurchase.update({ where: { id: purchaseA.id }, data: { status: "FAILED" } });

    await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });

    const allRows = await prisma.ptaVolunteerBuyoutPurchase.findMany({ where: { organizationId: orgId, householdId } });
    expect(allRows).toHaveLength(2);
    expect(allRows.find((r: { id: string }) => r.id === purchaseA.id)?.status).toBe("FAILED");
    expect(allRows.filter((r: { status: string }) => r.status === "PENDING")).toHaveLength(1);
  });

  it("attempt after PAID: a household already fully bought out (offline) is rejected, never allowed to start a second checkout", async () => {
    const { createVolunteerBuyoutCheckout, recordOfflineVolunteerBuyoutPurchase } = await import("../purchases");
    await recordOfflineVolunteerBuyoutPurchase(
      orgId,
      periodId,
      householdId,
      { electionType: "FULL_BUYOUT", paymentMethod: "CASH" },
      { userId: actorUserId }
    );

    await expect(
      createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ALREADY_SATISFIED" });

    const pendingCount = await prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    expect(pendingCount).toBe(0);
  });

  it("webhook arriving during a replacement attempt: no double ledger credit, no double COMPLETED purchase, regardless of interleaving", async () => {
    const { createVolunteerBuyoutCheckout, recordVolunteerBuyoutPurchase } = await import("../purchases");
    await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    const purchaseA = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });

    await Promise.allSettled([
      recordVolunteerBuyoutPurchase({
        organizationId: orgId,
        purchaseId: purchaseA.id,
        amountTotalCents: purchaseA.totalCents,
        stripeConnectedAccountId: "acct_test",
        providerPaymentIntentId: "pi_test_1",
        providerSessionId: purchaseA.providerSessionId!,
      }),
      createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId }),
    ]);

    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals(orgId, periodId, householdId);
    // Never more than the household's actual 1200-minute requirement, no
    // matter which order the two operations actually interleaved in.
    expect(totals.purchasedMinutes).toBeLessThanOrEqual(1200);

    const completedCount = await prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId: orgId, householdId, status: "COMPLETED" } });
    expect(completedCount).toBeLessThanOrEqual(1);
  });

  // Deployment-gate review addendum: the 9 tests above were judged
  // insufficient proof on their own -- they show two simultaneous inserts
  // collapse to one row, but not the specific properties below. Writing
  // these surfaced a real gap (see purchases.ts's comment on the
  // `updateMany`/`attached.count === 0` guard just added): the final
  // providerSessionId-attach step used to be an unconditional `update`,
  // which the second test below would have caught failing before the fix.

  it("the returned checkout URL is always already durably attached to the purchase row by the time the caller sees it", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const result = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });

    // No delay, no extra await -- read the row back the instant the call
    // resolves. If the implementation ever returned session.url BEFORE
    // persisting providerSessionId, this (or a concurrent reader) could
    // observe a purchase row that doesn't yet match the URL the caller was
    // just handed.
    const purchase = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    expect(purchase.providerSessionId).not.toBeNull();
    const session = fakeStripe.sessionsById.get(purchase.providerSessionId!);
    expect(session?.url).toBe(result.url);
  });

  it("a caller that supersedes a row while its own attach is still in flight against Stripe never receives that row's URL, and the original caller safely retries instead of losing the payment", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");

    // Deterministically reproduce the "purchase row exists, providerSessionId
    // still null" window a truly concurrent race only hits by chance: hold
    // the FIRST caller's Stripe response back until the second caller has
    // had a chance to observe the still-unattached row and supersede it.
    // The DB insert (which is what makes the row visible to a concurrent
    // reader) happens strictly before the Stripe call in program order, so
    // delaying only the Stripe call reproduces the window precisely.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const realCreate = fakeStripe.stripe.checkout.sessions.create;
    let creates = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fakeStripe.stripe.checkout.sessions.create as any) = vi.fn(async (...args: unknown[]) => {
      creates += 1;
      if (creates === 1) await gate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (realCreate as any)(...args);
    });

    const firstPromise = createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    // Poll (rather than a fixed sleep) for the first caller's DB insert to
    // land -- robust to connection-pool cold-start variance instead of
    // depending on a guessed delay being long enough.
    let firstRow: { providerSessionId: string | null } | null = null;
    for (let attempt = 0; attempt < 50 && !firstRow; attempt += 1) {
      firstRow = await prisma.ptaVolunteerBuyoutPurchase.findFirst({ where: { organizationId: orgId, householdId, status: "PENDING" } });
      if (!firstRow) await new Promise((r) => setTimeout(r, 10));
    }
    if (!firstRow) throw new Error("first caller's PENDING row never appeared -- test setup failure, not the race under test");
    expect(firstRow.providerSessionId).toBeNull(); // confirms we actually caught the intended window (gated before Stripe attach)

    const secondOutcome = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId }).catch(
      (e) => e
    );

    releaseFirst();
    const firstOutcome = await firstPromise.catch((e) => e);

    // Whichever of the two ends up "in progress" (rejected, asked to retry)
    // must never carry a URL for a row nothing will honor -- and the one
    // that succeeds must have a URL that matches a currently-PENDING row.
    const outcomes = [firstOutcome, secondOutcome];
    const succeeded = outcomes.filter((o): o is { url: string } => typeof o === "object" && o !== null && "url" in o);
    const rejected = outcomes.filter((o) => o instanceof Error || (typeof o === "object" && o !== null && "code" in o));
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) expect(r).toMatchObject({ code: "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS" });

    for (const s of succeeded) {
      const pendingRow = await prisma.ptaVolunteerBuyoutPurchase.findFirst({ where: { organizationId: orgId, householdId, status: "PENDING", providerSessionId: { not: null } } });
      const session = pendingRow ? fakeStripe.sessionsById.get(pendingRow.providerSessionId!) : undefined;
      expect(session?.url).toBe(s.url);
    }

    // Exactly one PENDING row survives, and it is the one whose URL was
    // actually handed out -- never an orphaned FAILED row silently carrying
    // a live, payable Stripe session nobody will ever be routed to pay
    // through the app (the exact scenario that would have silently dropped
    // a real payment before the updateMany guard was added).
    const pendingCount = await prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    expect(pendingCount).toBe(1);
    const failedRows = await prisma.ptaVolunteerBuyoutPurchase.findMany({ where: { organizationId: orgId, householdId, status: "FAILED" } });
    for (const failed of failedRows) {
      if (failed.providerSessionId) {
        const staleSession = fakeStripe.sessionsById.get(failed.providerSessionId);
        expect(outcomes.some((o) => typeof o === "object" && o !== null && "url" in o && (o as { url: string }).url === staleSession?.url)).toBe(false);
      }
    }
  });

  it("a repeated (sequential, non-racing) request against a purchase still advancing through checkout reuses it rather than superseding it", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const first = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
    const purchaseA = await prisma.ptaVolunteerBuyoutPurchase.findFirstOrThrow({ where: { organizationId: orgId, householdId, status: "PENDING" } });

    // Not a race -- a plain second call, as if the family reloaded the page
    // or clicked "Buy out hours" again while the first session is still open.
    const second = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });

    expect(second.url).toBe(first.url);
    expect(fakeStripe.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const refreshedA = await prisma.ptaVolunteerBuyoutPurchase.findUniqueOrThrow({ where: { id: purchaseA.id } });
    expect(refreshedA.status).toBe("PENDING"); // never superseded to FAILED
    const pendingCount = await prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId: orgId, householdId, status: "PENDING" } });
    expect(pendingCount).toBe(1);
  });

  it("cross-household and cross-organization callers never receive another family's checkout URL", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");

    const otherHousehold = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: `Other Household ${Date.now()}`, status: "ACTIVE", schoolYear: "2026-2027" },
    });

    const otherOrg = await prisma.organization.create({
      data: { slug: `pta-purchase-dedupe-other-${Date.now()}`, name: "Other Org PTA", primaryVertical: "PTA" },
    });
    const now = new Date();
    const otherPeriod = await prisma.ptaVolunteerRequirementPeriod.create({
      data: {
        organizationId: otherOrg.id,
        name: "Other Org Period",
        periodType: "SCHOOL_YEAR",
        startsOn: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endsOn: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        requiredMinutesDefault: 1200,
        status: "ACTIVE",
      },
    });
    await prisma.ptaVolunteerPricingWindow.create({
      data: {
        organizationId: otherOrg.id,
        periodId: otherPeriod.id,
        name: "Other org full buyout rate",
        startAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        rateType: "FULL_BUYOUT",
        amountCents: 25_000,
        active: true,
      },
    });
    const otherOrgHousehold = await prisma.ptaHousehold.create({
      data: { organizationId: otherOrg.id, displayName: "Other Org Household", status: "ACTIVE", schoolYear: "2026-2027" },
    });

    try {
      const resultA = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
      const resultB = await createVolunteerBuyoutCheckout(orgId, periodId, otherHousehold.id, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
      const resultC = await createVolunteerBuyoutCheckout(otherOrg.id, otherPeriod.id, otherOrgHousehold.id, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });

      // Three distinct households (two different orgs) -- three distinct URLs, never shared.
      expect(new Set([resultA.url, resultB.url, resultC.url]).size).toBe(3);

      // Re-requesting for household A must still reuse ONLY household A's
      // session -- never B's or C's, even though all three are open PENDING
      // purchases at the same instant.
      const repeatA = await createVolunteerBuyoutCheckout(orgId, periodId, householdId, { electionType: "FULL_BUYOUT" }, { userId: actorUserId });
      expect(repeatA.url).toBe(resultA.url);
      expect(repeatA.url).not.toBe(resultB.url);
      expect(repeatA.url).not.toBe(resultC.url);
    } finally {
      await prisma.ptaVolunteerBuyoutPurchase.deleteMany({ where: { householdId: otherHousehold.id } });
      await prisma.ptaVolunteerBuyoutPurchase.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.ptaHousehold.deleteMany({ where: { id: { in: [otherHousehold.id, otherOrgHousehold.id] } } });
      await prisma.ptaVolunteerPricingWindow.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.ptaVolunteerRequirementPeriod.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });
});
