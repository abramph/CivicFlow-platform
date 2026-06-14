/**
 * CivicFlow SaaS — Database Seed Script
 *
 * Run with:
 *   cd civicflow-portal
 *   npm run db:seed
 *   # or: npx prisma db seed
 *
 * This seed creates:
 *   - 1 SUPER_ADMIN user (platform operator)
 *   - 1 sample organization
 *   - 5 org users: ORG_OWNER, ORG_ADMIN, FINANCE, STAFF, READ_ONLY
 *
 * All passwords are sample credentials. Change them before any shared deployment.
 * Do NOT use real production credentials here.
 *
 * The seed is idempotent: running it twice does not create duplicate records.
 */

import { loadEnvConfig } from "@next/env";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import bcrypt from "bcryptjs";

// Align direct tsx seed execution with Next/Prisma local env behavior.
loadEnvConfig(process.cwd());

let prisma: PrismaClientType;

const SALT_ROUNDS = 12;

async function hash(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();

  console.log("🌱  Seeding CivicFlow SaaS database...\n");

  // ── 1. SUPER_ADMIN user ─────────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@civicflow.example" },
    update: {},
    create: {
      email:        "superadmin@civicflow.example",
      displayName:  "Platform Admin",
      passwordHash: await hash("SuperAdmin!Change1"),
      emailVerified: true,
    },
  });
  console.log(`✅  SUPER_ADMIN user: ${superAdmin.email}  (id: ${superAdmin.id})`);

  // ── 2. Sample organization ──────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "sample-org" },
    update: {},
    create: {
      slug:   "sample-org",
      name:   "Sample Community Organization",
      plan:   "essential",
      status: "active",
    },
  });
  console.log(`✅  Organization: "${org.name}"  (id: ${org.id})`);

  // ── 3. SUPER_ADMIN membership (owns the platform, not tied to one org) ──────
  await prisma.organizationMembership.upsert({
    where:  { organizationId_userId: { organizationId: org.id, userId: superAdmin.id } },
    update: {},
    create: {
      organizationId: org.id,
      userId:         superAdmin.id,
      role:           "SUPER_ADMIN",
    },
  });

  // ── 4. Org users ─────────────────────────────────────────────────────────────
  const orgUsers: Array<{
    email: string;
    displayName: string;
    password: string;
    role: "ORG_OWNER" | "ORG_ADMIN" | "FINANCE" | "STAFF" | "READ_ONLY";
  }> = [
    {
      email:       "owner@sample-org.example",
      displayName: "Org Owner",
      password:    "OrgOwner!Change1",
      role:        "ORG_OWNER",
    },
    {
      email:       "admin@sample-org.example",
      displayName: "Org Admin",
      password:    "OrgAdmin!Change1",
      role:        "ORG_ADMIN",
    },
    {
      email:       "finance@sample-org.example",
      displayName: "Finance Officer",
      password:    "Finance!Change1",
      role:        "FINANCE",
    },
    {
      email:       "staff@sample-org.example",
      displayName: "Staff Member",
      password:    "Staff!Change1",
      role:        "STAFF",
    },
    {
      email:       "readonly@sample-org.example",
      displayName: "Read-Only Viewer",
      password:    "ReadOnly!Change1",
      role:        "READ_ONLY",
    },
  ];

  for (const u of orgUsers) {
    const user = await prisma.user.upsert({
      where:  { email: u.email },
      update: {},
      create: {
        email:         u.email,
        displayName:   u.displayName,
        passwordHash:  await hash(u.password),
        emailVerified: true,
      },
    });

    await prisma.organizationMembership.upsert({
      where:  { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: {},
      create: {
        organizationId: org.id,
        userId:         user.id,
        role:           u.role,
      },
    });

    console.log(`✅  ${u.role.padEnd(12)} ${user.email}  (id: ${user.id})`);
  }

  // ── 5. Org default settings ───────────────────────────────────────────────
  await prisma.orgSettings.upsert({
    where:  { organizationId: org.id },
    update: {},
    create: {
      organizationId:  org.id,
      timezone:        "America/New_York",
      currency:        "USD",
      fiscalYearStart: 1,
    },
  });
  console.log(`✅  Default OrgSettings created`);

  console.log("\n🎉  Seed complete.\n");
  console.log("⚠️   Remember to change all sample passwords before sharing.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
