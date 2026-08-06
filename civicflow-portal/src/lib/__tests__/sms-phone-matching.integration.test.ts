import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database regression test for findMembersByPhone()'s digit-only
 * matching — deliberately NOT using a mocked Prisma client. This exists
 * because a real bug shipped and went unnoticed: the raw SQL template
 * literal `regexp_replace(phone, '\D', '', 'g')` looks correct, but `\D` is
 * not a recognized JavaScript string escape sequence, so the JS parser
 * silently drops the backslash — the actual pattern sent to Postgres was
 * the literal character `D`, not the non-digit regex metacharacter, which
 * meant the digit-only fallback match never worked for any number
 * containing formatting characters. Every mocked webhook test passed
 * throughout, because they mock $queryRaw itself and never execute real
 * SQL — this class of bug is only catchable against a real database.
 *
 * Caught live during PR #58's Twilio Sandbox walkthrough (2026-08-06) via
 * the identical mistake mirrored into the new WhatsApp inbound webhook —
 * a real STOP-family reply failed to opt a test member out until fixed.
 * This SMS version is the original the WhatsApp one was copied from; fixed
 * here to `'\\D'` alongside it.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/sms-phone-matching.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("findMembersByPhone — real regex matching", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `sms-phone-matching-${Date.now()}`, name: "SMS Phone Matching Test Org", primaryVertical: "COMMUNITY" },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma?.orgMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("matches a stored E.164 number (with '+') against Twilio's digit-only From param", async () => {
    const { findMembersByPhone } = await import("@/lib/sms-phone-matching");

    const member = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Regex", lastName: "Test", phone: "+15551234567" },
    });

    // The exact regression: the stored value contains a "+" — the broken
    // regex (`D` instead of `\D`) never strips it, so this comparison would
    // silently return zero rows against the pre-fix code.
    const matches = await findMembersByPhone("+15551234567");

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(member.id);
    expect(matches[0].organizationId).toBe(orgId);
  });

  it("matches a hyphenated, CSV-imported-style stored number via the digit-only comparison", async () => {
    const { findMembersByPhone } = await import("@/lib/sms-phone-matching");

    const member = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "CSV", lastName: "Imported", phone: "215-917-4391" },
    });

    const matches = await findMembersByPhone("+12159174391");

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(member.id);
  });

  it("matches a stored number missing its country code via the last-10-digits fallback", async () => {
    const { findMembersByPhone } = await import("@/lib/sms-phone-matching");

    const member = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Fallback", lastName: "Match", phone: "5559998888" },
    });

    const matches = await findMembersByPhone("+15559998888");

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(member.id);
  });

  it("returns no match for an unrelated number", async () => {
    const { findMembersByPhone } = await import("@/lib/sms-phone-matching");

    await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Other", lastName: "Member", phone: "+15550001111" },
    });

    const matches = await findMembersByPhone("+19995550000");

    expect(matches).toHaveLength(0);
  });
});
