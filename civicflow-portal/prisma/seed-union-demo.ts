/**
 * Unestra for Union — fictional demo data ("United Workers Local 408").
 *
 * Run with (local/test databases ONLY — never point this at production):
 *   cd civicflow-portal
 *   npx tsx prisma/seed-union-demo.ts
 *
 * Creates one fictional organization with primaryVertical set to UNION,
 * officers (President/Treasurer/Office Staff), a rank-and-file member
 * roster (including one member with no login, kept for historical dues
 * record only, mirroring seed-hoa-demo.ts's "Sam Ito" pattern), a dues
 * category, a payroll-checkoff payment-import batch with reconciled items,
 * and a sent communication campaign — enough to satisfy every step of the
 * Union onboarding checklist (src/app/onboarding/checklist/page.tsx) so the
 * demo shows what a fully-set-up Union org looks like, not just an empty one.
 *
 * Every name, address, and email below is fictional. This script is
 * idempotent (safe to re-run) via upserts/find-or-create checks keyed by
 * stable ids or unique constraints — it never touches any other
 * organization's data. It does NOT run automatically in any deploy
 * pipeline and is never invoked against production.
 */

import type { PrismaClient as PrismaClientType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertNotProduction, loadDemoEnv } from "./seed-demo-guard";

loadDemoEnv();

let prisma: PrismaClientType;

const SALT_ROUNDS = 12;
async function hash(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function main() {
  assertNotProduction();
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();

  console.log("Seeding fictional United Workers Local 408 demo data...\n");

  // ── Organization ───────────────────────────────────────────────────────
  // primaryVertical: "UNION" is the sole capability gate (payrollCheckoff --
  // see src/lib/vertical-capabilities.ts) -- no separate enrollment step.
  const org = await prisma.organization.upsert({
    where: { slug: "united-workers-local-408" },
    update: { primaryVertical: "UNION" },
    create: {
      slug: "united-workers-local-408",
      name: "United Workers Local 408",
      organizationType: "Union",
      primaryVertical: "UNION",
      plan: "elite",
      email: "office@local408.example",
      website: "https://local408.example",
      addressLine1: "408 Labor Way",
      city: "Springfield",
      state: "ST",
      zipCode: "00000",
    },
  });
  console.log(`Organization: ${org.name} (${org.id})`);

  // ── Officers (users + org memberships) ───────────────────────────────────
  async function upsertOfficer(email: string, displayName: string, role: "ORG_OWNER" | "ORG_ADMIN" | "FINANCE" | "STAFF" | "READ_ONLY") {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, displayName, passwordHash: await hash("UnionDemo!Change1"), emailVerified: true },
    });
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role },
      create: { organizationId: org.id, userId: user.id, role, status: "active", joinedAt: new Date() },
    });
    return user;
  }

  await upsertOfficer("president@local408.example", "Alex Rivera (President)", "ORG_OWNER");
  await upsertOfficer("treasurer@local408.example", "Sam Chen (Treasurer)", "FINANCE");
  await upsertOfficer("office@local408.example", "Jamie Torres (Office Staff)", "STAFF");
  console.log("Officers created (President, Treasurer, Office Staff).");

  // ── OrgMember records (dues/billing identities) ──────────────────────────
  async function findOrCreateMember(firstName: string, lastName: string, email: string) {
    const existing = await prisma.orgMember.findFirst({ where: { organizationId: org.id, email } });
    return existing ?? prisma.orgMember.create({ data: { organizationId: org.id, firstName, lastName, email, membershipStatus: "active" } });
  }

  const alex = await findOrCreateMember("Alex", "Rivera", "president@local408.example");
  const sam = await findOrCreateMember("Sam", "Chen", "treasurer@local408.example");
  const member1 = await findOrCreateMember("Morgan", "Ellis", "member1@local408.example");
  const member2 = await findOrCreateMember("Casey", "Nakamura", "member2@local408.example");
  // Retired member kept for historical dues record only -- no User/login at
  // all, mirroring seed-hoa-demo.ts's "Sam Ito" former-tenant pattern.
  const retiredMember = await findOrCreateMember("Robin", "Whitfield", "retired-member@local408.example");
  console.log("Member roster created (including a retired member with no login access).");

  // ── Dues category ─────────────────────────────────────────────────────────
  const existingDuesCategory = await prisma.category.findFirst({ where: { organizationId: org.id, name: "Monthly Union Dues", type: "DUES" } });
  const duesCategory =
    existingDuesCategory ??
    (await prisma.category.create({
      data: {
        organizationId: org.id,
        name: "Monthly Union Dues",
        type: "DUES",
        amountDefault: 45,
        frequency: "MONTHLY",
      },
    }));
  console.log(`Dues category created: ${duesCategory.name} ($${duesCategory.amountDefault}/month).`);

  // ── Payroll-checkoff payment import batch ────────────────────────────────
  // Mirrors the real bulk-import path (src/app/api/payments/imports/route.ts)
  // rather than a raw contribution/payment row, since payroll checkoff is
  // deliberately reconciled through the same importer as every other bulk
  // source (see the onboarding checklist's own "Payroll checkoff overview"
  // step description).
  let batch = await prisma.paymentImportBatch.findFirst({
    where: { organizationId: org.id, sourceType: "PAYROLL_CHECKOFF", fileName: "july-2026-payroll-checkoff.csv" },
  });
  if (!batch) {
    batch = await prisma.paymentImportBatch.create({
      data: {
        organizationId: org.id,
        sourceType: "PAYROLL_CHECKOFF",
        fileName: "july-2026-payroll-checkoff.csv",
        status: "PARSED",
        notes: "Employer-remitted payroll deductions for July 2026.",
        processedAt: new Date(),
      },
    });
  }

  async function findOrCreateImportItem(member: { id: string; email: string | null }, amount: number, externalTransactionId: string) {
    const existing = await prisma.paymentImportItem.findFirst({
      where: { organizationId: org.id, batchId: batch!.id, externalTransactionId },
    });
    if (existing) return existing;
    return prisma.paymentImportItem.create({
      data: {
        organizationId: org.id,
        batchId: batch!.id,
        sourceType: "PAYROLL_CHECKOFF",
        externalTransactionId,
        transactionDate: new Date("2026-07-15"),
        payerEmail: member.email,
        amount,
        matchedMemberId: member.id,
        matchConfidence: 95,
        verificationStatus: "VERIFIED",
      },
    });
  }

  await findOrCreateImportItem(member1, 45, "CHECKOFF-2026-07-001");
  await findOrCreateImportItem(member2, 45, "CHECKOFF-2026-07-002");
  await findOrCreateImportItem(retiredMember, 45, "CHECKOFF-2026-07-003");
  console.log("Payroll-checkoff payment import batch created (3 reconciled items).");

  // ── Communication campaign ────────────────────────────────────────────────
  const existingCampaign = await prisma.communicationCampaign.findFirst({
    where: { organizationId: org.id, title: "July Membership Meeting Reminder" },
  });
  if (!existingCampaign) {
    await prisma.communicationCampaign.create({
      data: {
        organizationId: org.id,
        title: "July Membership Meeting Reminder",
        communicationType: "ANNOUNCEMENT",
        channel: "EMAIL",
        subject: "Reminder: July Membership Meeting",
        body: "This is a reminder that our monthly membership meeting is this Thursday at the union hall.",
        status: "SENT",
        sentAt: new Date("2026-07-01"),
      },
    });
  }
  console.log("Communication campaign created.");

  console.log(
    `\nDone. Login as an officer with password UnionDemo!Change1 (e.g. president@local408.example) or treasurer@local408.example.`
  );
  void alex;
  void sam;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
