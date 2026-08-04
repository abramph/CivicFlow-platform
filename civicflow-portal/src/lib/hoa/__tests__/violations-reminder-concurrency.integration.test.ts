import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency test for sendDeadlineReminders' per-recipient
 * claim mechanism (ViolationReminderLog's unique constraint) -- deliberately
 * NOT using a mocked Prisma client, mirroring
 * property-resident-concurrency.integration.test.ts's structure and skip
 * convention. Mocked unit tests (violations.test.ts) can only prove the
 * code *calls* prisma.violationReminderLog.create with the right where/data
 * shape; they can't prove the unique constraint actually makes several
 * genuinely simultaneous cron invocations (retries, overlapping schedules,
 * multiple app instances -- the exact scenarios called out in the product
 * requirements for this fix) converge on exactly one delivery per
 * recipient rather than racing.
 *
 * Skipped by default (no live DB in a normal `vitest run`) -- run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting
 * vitest, e.g.:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/hoa/__tests__/violations-reminder-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows. Real notification delivery is a no-op in this
 * environment (ENABLE_EMAIL_SEND=0 in .env.development.local), so this
 * test never contacts a real email/push provider.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("HOA sendDeadlineReminders — real concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let propertyId: string;
  let memberId: string;
  let actorUserId: string;
  let violationId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `hoa-reminder-concurrency-${Date.now()}`, name: "HOA Reminder Concurrency Test Org", primaryVertical: "HOA" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `hoa-reminder-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const property = await prisma.property.create({ data: { organizationId: orgId, addressLine1: "1 Reminder Race Ct", propertyType: "SINGLE_FAMILY" } });
    propertyId = property.id;

    const member = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Reminder", lastName: "Recipient", email: `reminder-recipient-${Date.now()}@example.test`, commsEmailEnabled: true },
    });
    memberId = member.id;

    await prisma.propertyResident.create({
      data: { organizationId: orgId, propertyId, orgMemberId: memberId, relationshipType: "OWNER", status: "ACTIVE", isPrimaryContact: true },
    });

    const { createViolationDraft, issueViolation } = await import("../violations");
    const draft = await createViolationDraft({
      organizationId: orgId,
      propertyId,
      violationType: "Reminder concurrency test",
      description: "Fixture violation for reminder race testing",
      actorUserId,
    });
    const cureByDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // due in 2 days -- inside the default 3-day window
    await issueViolation({ organizationId: orgId, violationId: draft.id, cureByDate, noticeBody: "test", actorUserId });
    violationId = draft.id;
  });

  afterAll(async () => {
    await prisma?.violationReminderLog.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.violationNotice.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.violationStatusHistory.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.violation.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.propertyResident.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.property.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("converges on exactly one reminder claim per recipient when 8 concurrent cron-style invocations race the same due violation", async () => {
    const { sendDeadlineReminders } = await import("../violations");

    // Simulates overlapping cron runs / multiple app instances all waking
    // up and scanning for due-soon violations at roughly the same moment.
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => sendDeadlineReminders()));

    const totalRemindersSentAcrossRuns = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.remindersSent : 0), 0);
    expect(totalRemindersSentAcrossRuns).toBe(1); // exactly one of the 8 invocations should have won the claim

    const logRows = await prisma.violationReminderLog.findMany({ where: { violationId, orgMemberId: memberId, reminderType: "DEADLINE_REMINDER" } });
    expect(logRows).toHaveLength(1); // the database itself agrees, not just the returned counts

    const noticeRows = await prisma.violationNotice.findMany({ where: { violationId, noticeType: "DEADLINE_REMINDER" } });
    expect(noticeRows).toHaveLength(1); // the audit-trail notice wasn't duplicated either
  });

  it("does not re-claim on a subsequent run for the same day (dueOffsetDays unchanged)", async () => {
    const { sendDeadlineReminders } = await import("../violations");
    const result = await sendDeadlineReminders();

    expect(result.remindersSent).toBe(0); // already claimed by the previous test today
    const logRows = await prisma.violationReminderLog.findMany({ where: { violationId, orgMemberId: memberId, reminderType: "DEADLINE_REMINDER" } });
    expect(logRows).toHaveLength(1);
  });
});
