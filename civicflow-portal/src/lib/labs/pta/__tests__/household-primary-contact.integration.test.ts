import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database regression tests for the household billing-identity contact
 * sync (households.ts) that a mocked Prisma client cannot meaningfully
 * prove:
 *
 * 1. PtaHousehold.primaryContactAdultId is declared `onDelete: SetNull`
 *    against PtaHouseholdAdult — deleting the current primary contact adult
 *    must leave the household with a clean `null` (not a dangling FK), and
 *    must NOT retroactively clear the billing OrgMember's already-synced
 *    email. This is a deliberate design decision (see
 *    docs/pta-communication-identity.md): a previously-synced email is
 *    treated exactly like a manually-entered one once it exists — blanking
 *    it on guardian removal would trade a possibly-still-correct address
 *    for guaranteed non-delivery, which is strictly worse. A mocked test
 *    can't catch a wrong `onDelete` behavior at all, since mocks don't
 *    enforce FK semantics — only a real database can.
 * 2. The full sync loop end-to-end against a real OrgMember row: fills an
 *    empty email once, never overwrites a manually-set one afterward, even
 *    across a primary-contact reassignment.
 *
 * Skipped by default — run with DATABASE_URL pointed at a disposable/local
 * Postgres BEFORE starting vitest, matching this suite's existing
 * household-adult-constraint.integration.test.ts convention:
 *   DATABASE_URL="postgresql://postgres@localhost:55432/civicflow_disposable" \
 *   PTA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/__tests__/household-primary-contact.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("Household primary-contact billing sync — real database", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let organizationId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    const org = await prisma.organization.create({
      data: { slug: `pta-contact-sync-test-${Date.now()}`, name: "Contact Sync Test Org" },
    });
    organizationId = org.id;
    // createAuditEvent's actorUserId is a real FK against User — every
    // households.ts function called here writes an audit event, so a real
    // row is required, not just a string id (mirrors
    // household-adult-constraint.integration.test.ts's own setup).
    const actor = await prisma.user.create({
      data: { email: `pta-contact-sync-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    actorUserId = actor.id;
  });

  afterAll(async () => {
    await prisma?.organization.delete({ where: { id: organizationId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("deleting the primary contact adult clears primaryContactAdultId but leaves the already-synced OrgMember email untouched", async () => {
    const { createPtaHousehold, addPtaHouseholdAdult, removePtaHouseholdAdult } = await import("../households");

    const household = await createPtaHousehold({
      organizationId,
      displayName: "Deleted Guardian Test Household",
      schoolYear: "2026-2027",
      actorUserId,
    });

    const adult = await addPtaHouseholdAdult({
      organizationId,
      householdId: household.id,
      name: "Departing Guardian",
      email: "departing-guardian@example.test",
      makePrimaryContact: true,
      actorUserId,
    });

    const syncedMember = await prisma.orgMember.findUnique({ where: { id: household.orgMemberId! } });
    expect(syncedMember.email).toBe("departing-guardian@example.test");

    await removePtaHouseholdAdult(organizationId, household.id, adult.id, actorUserId);

    const householdAfterDelete = await prisma.ptaHousehold.findUnique({ where: { id: household.id } });
    expect(householdAfterDelete.primaryContactAdultId).toBeNull(); // SetNull, not a dangling reference

    const memberAfterDelete = await prisma.orgMember.findUnique({ where: { id: household.orgMemberId! } });
    expect(memberAfterDelete.email).toBe("departing-guardian@example.test"); // deliberately not cleared
  });

  it("reassigning primary contact to a second guardian fills email only if it was still empty", async () => {
    const { createPtaHousehold, addPtaHouseholdAdult, setPtaHouseholdPrimaryContact } = await import("../households");

    const household = await createPtaHousehold({
      organizationId,
      displayName: "Multiple Guardians Test Household",
      schoolYear: "2026-2027",
      actorUserId,
    });

    // Neither adult is made primary at add-time (mirrors the real officer
    // web UI flow before this PR: two adults added, no primary contact
    // chosen yet).
    const adultA = await addPtaHouseholdAdult({
      organizationId,
      householdId: household.id,
      name: "Guardian A",
      email: "guardian-a@example.test",
      actorUserId,
    });
    const adultB = await addPtaHouseholdAdult({
      organizationId,
      householdId: household.id,
      name: "Guardian B",
      email: "guardian-b@example.test",
      actorUserId,
    });

    let member = await prisma.orgMember.findUnique({ where: { id: household.orgMemberId! } });
    expect(member.email).toBeNull(); // real production gap this PR fixes: no sync happened at add-time without makePrimaryContact

    await setPtaHouseholdPrimaryContact(organizationId, household.id, adultA.id, actorUserId);
    member = await prisma.orgMember.findUnique({ where: { id: household.orgMemberId! } });
    expect(member.email).toBe("guardian-a@example.test");

    // Reassigning to Guardian B must NOT overwrite Guardian A's
    // already-synced email with Guardian B's — the household's on-file
    // communication address doesn't silently change just because a
    // different adult is now marked primary for other purposes (e.g.
    // volunteer/committee coordination).
    await setPtaHouseholdPrimaryContact(organizationId, household.id, adultB.id, actorUserId);
    const householdAfterReassign = await prisma.ptaHousehold.findUnique({ where: { id: household.id } });
    expect(householdAfterReassign.primaryContactAdultId).toBe(adultB.id);
    member = await prisma.orgMember.findUnique({ where: { id: household.orgMemberId! } });
    expect(member.email).toBe("guardian-a@example.test");
  });

  /**
   * End-to-end proof that the synced field is exactly the field
   * communication-campaigns.ts reads for EMAIL-channel eligibility — two
   * modules independently unit-tested (with mocked Prisma on both sides)
   * can still disagree on a field name or shape; only a real shared
   * database can prove the actual contract between them holds. Uses the
   * "active_with_email" selector (the default/base selector every vertical
   * shares, not a PTA-specific one) to prove this fix benefits ANY
   * organization whose OrgMember rows follow this same household/billing
   * pattern, not just PTA's own targeting rules.
   */
  it("a newly-synced email makes the household's billing OrgMember a real EMAIL-channel recipient", async () => {
    const { createPtaHousehold, addPtaHouseholdAdult, setPtaHouseholdPrimaryContact } = await import("../households");
    const { resolveCommunicationRecipients } = await import("@/lib/communication-campaigns");

    const household = await createPtaHousehold({
      organizationId,
      displayName: "Recipient Resolution Test Household",
      schoolYear: "2026-2027",
      actorUserId,
    });
    const adult = await addPtaHouseholdAdult({
      organizationId,
      householdId: household.id,
      name: "Recipient Test Guardian",
      email: "recipient-resolution-test@example.test",
      actorUserId,
    });

    const beforeSync = await resolveCommunicationRecipients(organizationId, { selector: "active_with_email" }, "EMAIL");
    expect(beforeSync.find((m: { id: string }) => m.id === household.orgMemberId)).toBeUndefined();

    await setPtaHouseholdPrimaryContact(organizationId, household.id, adult.id, actorUserId);
    // membershipStatus defaults to "active" on OrgMember.create, so no
    // separate activation step is needed for the base selector to see it.
    const afterSync = await resolveCommunicationRecipients(organizationId, { selector: "active_with_email" }, "EMAIL");
    expect(afterSync.find((m: { id: string }) => m.id === household.orgMemberId)?.email).toBe("recipient-resolution-test@example.test");
  });

  it("an INACTIVE household's synced email never makes it eligible via the base selector, regardless of the sync fix", async () => {
    const { createPtaHousehold, addPtaHouseholdAdult, setPtaHouseholdPrimaryContact, updatePtaHousehold } = await import("../households");
    const { resolveCommunicationRecipients } = await import("@/lib/communication-campaigns");

    const household = await createPtaHousehold({
      organizationId,
      displayName: "Inactive Household Recipient Test",
      schoolYear: "2026-2027",
      actorUserId,
    });
    const adult = await addPtaHouseholdAdult({
      organizationId,
      householdId: household.id,
      name: "Inactive Household Guardian",
      email: "inactive-household-guardian@example.test",
      actorUserId,
    });
    await setPtaHouseholdPrimaryContact(organizationId, household.id, adult.id, actorUserId);
    await updatePtaHousehold({ organizationId, householdId: household.id, status: "INACTIVE", actorUserId });

    const recipients = await resolveCommunicationRecipients(organizationId, { selector: "active_with_email" }, "EMAIL");
    expect(recipients.find((m: { id: string }) => m.id === household.orgMemberId)).toBeUndefined();
  });
});
