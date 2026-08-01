/**
 * Unestra for HOA — fictional demo data ("Oak Ridge Homeowners Association").
 *
 * Run with (local/test databases ONLY — never point this at production):
 *   cd civicflow-portal
 *   npx tsx prisma/seed-hoa-demo.ts
 *
 * Creates one fictional organization with primaryVertical set to HOA, a
 * board (President/Board Member/Treasurer/Secretary/general resident),
 * five properties covering every PropertyType, and PropertyResident
 * relationships covering every scenario called for in PR #43's validation:
 * owner-occupant, non-resident owner, tenant, co-owners, a property with no
 * current resident, and one archived (ENDED) relationship.
 *
 * Every name, address, and email below is fictional. This script is
 * idempotent (safe to re-run) via upserts/find-or-create checks keyed by
 * stable ids or unique constraints — it never touches any other
 * organization's data. It does NOT run automatically in any deploy
 * pipeline and is never invoked against production.
 */

import { loadEnvConfig } from "@next/env";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import bcrypt from "bcryptjs";

loadEnvConfig(process.cwd());

let prisma: PrismaClientType;

const SALT_ROUNDS = 12;
async function hash(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();

  console.log("Seeding fictional Oak Ridge Homeowners Association demo data...\n");

  // ── Organization ───────────────────────────────────────────────────────
  // primaryVertical: "HOA" is the sole capability gate (see
  // src/lib/vertical-capabilities.ts) -- no separate enrollment step.
  const org = await prisma.organization.upsert({
    where: { slug: "oak-ridge-homeowners-association" },
    update: { primaryVertical: "HOA" },
    create: {
      slug: "oak-ridge-homeowners-association",
      name: "Oak Ridge Homeowners Association",
      organizationType: "HOA",
      primaryVertical: "HOA",
      plan: "elite",
      email: "board@oakridgehoa.example",
      website: "https://oakridgehoa.example",
      addressLine1: "1 Oak Ridge Commons",
      city: "Springfield",
      state: "ST",
      zipCode: "00000",
    },
  });
  console.log(`Organization: ${org.name} (${org.id})`);

  // ── Board (users + org memberships) ──────────────────────────────────────
  async function upsertBoardMember(email: string, displayName: string, role: "ORG_OWNER" | "ORG_ADMIN" | "FINANCE" | "STAFF" | "READ_ONLY") {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, displayName, passwordHash: await hash("HoaDemo!Change1"), emailVerified: true },
    });
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role },
      create: { organizationId: org.id, userId: user.id, role, status: "active", joinedAt: new Date() },
    });
    return user;
  }

  // Morgan Reyes is deliberately both board President AND an owner-occupant
  // resident (realistic, and mirrors seed-pta-demo.ts's president/parent
  // overlap) -- exercises "an officer who is also a resident" without that
  // being the only case (Jordan/Dana/Casey/Robin below are officers whose
  // *residency* relationship is deliberately varied instead).
  await upsertBoardMember("president@oakridgehoa.example", "Morgan Reyes (President)", "ORG_OWNER");
  await upsertBoardMember("board@oakridgehoa.example", "Jordan Ellis (Board Member)", "ORG_ADMIN");
  await upsertBoardMember("treasurer@oakridgehoa.example", "Dana Whitfield (Treasurer)", "FINANCE");
  await upsertBoardMember("secretary@oakridgehoa.example", "Casey Nakamura (Secretary)", "STAFF");
  await upsertBoardMember("resident@oakridgehoa.example", "Robin Nakamura (General Resident)", "READ_ONLY");
  console.log("Board created (President, Board Member, Treasurer, Secretary, General Resident).");

  // ── OrgMember records (billing/resident identities) ──────────────────────
  // Every HOA resident/owner is a full OrgMember (see
  // docs/hoa-domain-model.md's "Why residents/owners reuse OrgMember
  // directly" section) -- including Sam Ito, who has no login at all,
  // representing a former tenant kept only for historical record.
  async function findOrCreateMember(firstName: string, lastName: string, email: string) {
    const existing = await prisma.orgMember.findFirst({ where: { organizationId: org.id, email } });
    return existing ?? prisma.orgMember.create({ data: { organizationId: org.id, firstName, lastName, email, membershipStatus: "active" } });
  }

  const morgan = await findOrCreateMember("Morgan", "Reyes", "president@oakridgehoa.example");
  const jordan = await findOrCreateMember("Jordan", "Ellis", "board@oakridgehoa.example");
  const dana = await findOrCreateMember("Dana", "Whitfield", "treasurer@oakridgehoa.example");
  const casey = await findOrCreateMember("Casey", "Nakamura", "secretary@oakridgehoa.example");
  const robin = await findOrCreateMember("Robin", "Nakamura", "resident@oakridgehoa.example");
  const samIto = await findOrCreateMember("Sam", "Ito", "former-tenant@oakridgehoa.example");
  console.log("Resident/owner member records created.");

  // ── Properties (one per PropertyType) ────────────────────────────────────
  async function findOrCreateProperty(data: {
    addressLine1: string;
    unitLabel?: string | null;
    buildingLabel?: string | null;
    propertyType: "SINGLE_FAMILY" | "CONDO_UNIT" | "TOWNHOME" | "VACANT_LOT" | "COMMON_PROPERTY" | "OTHER";
    displayName?: string | null;
    billingMemberId?: string | null;
  }) {
    const existing = await prisma.property.findFirst({ where: { organizationId: org.id, addressLine1: data.addressLine1, unitLabel: data.unitLabel ?? null } });
    if (existing) {
      return prisma.property.update({ where: { id: existing.id }, data: { billingMemberId: data.billingMemberId ?? null } });
    }
    return prisma.property.create({
      data: {
        organizationId: org.id,
        addressLine1: data.addressLine1,
        unitLabel: data.unitLabel ?? null,
        buildingLabel: data.buildingLabel ?? null,
        propertyType: data.propertyType,
        displayName: data.displayName ?? null,
        billingMemberId: data.billingMemberId ?? null,
        city: "Springfield",
        state: "ST",
        zipCode: "00000",
      },
    });
  }

  // 1. Single-family, owner-occupant.
  const singleFamily = await findOrCreateProperty({
    addressLine1: "142 Oak Ridge Drive",
    propertyType: "SINGLE_FAMILY",
    billingMemberId: morgan.id,
  });

  // 2. Condo unit -- non-resident owner (Dana) + tenant (Jordan) + one
  // archived (ENDED) prior tenant (Sam Ito), for relationship-history
  // coverage.
  const condo = await findOrCreateProperty({
    addressLine1: "88 Ridge Commons",
    unitLabel: "Unit 4B",
    buildingLabel: "Ridge Commons Building B",
    propertyType: "CONDO_UNIT",
    billingMemberId: dana.id,
  });

  // 3. Townhome -- co-owners (Casey + Robin).
  const townhome = await findOrCreateProperty({
    addressLine1: "27 Maple Court",
    propertyType: "TOWNHOME",
    billingMemberId: casey.id,
  });

  // 4. Vacant lot -- no billing member, no current resident.
  const vacantLot = await findOrCreateProperty({
    addressLine1: "Lot 12, Ridge Meadow Section",
    propertyType: "VACANT_LOT",
  });

  // 5. Common property -- association-owned, no individual owner, no residents.
  const clubhouse = await findOrCreateProperty({
    addressLine1: "1 Oak Ridge Commons",
    propertyType: "COMMON_PROPERTY",
    displayName: "Clubhouse",
  });

  console.log(`Properties created: ${[singleFamily, condo, townhome, vacantLot, clubhouse].length} (single-family, condo, townhome, vacant lot, common property).`);

  // ── PropertyResident relationships ────────────────────────────────────────
  async function findOrCreateResident(data: {
    propertyId: string;
    orgMemberId: string;
    relationshipType: "OWNER" | "CO_OWNER" | "RESIDENT" | "TENANT" | "NON_RESIDENT_OWNER" | "OTHER";
    status?: "ACTIVE" | "ENDED";
    isPrimaryContact?: boolean;
    ownershipPercentage?: number | null;
    moveInDate?: Date | null;
    moveOutDate?: Date | null;
  }) {
    const existing = await prisma.propertyResident.findFirst({
      where: { organizationId: org.id, propertyId: data.propertyId, orgMemberId: data.orgMemberId, relationshipType: data.relationshipType },
    });
    if (existing) return existing;
    return prisma.propertyResident.create({
      data: {
        organizationId: org.id,
        propertyId: data.propertyId,
        orgMemberId: data.orgMemberId,
        relationshipType: data.relationshipType,
        status: data.status ?? "ACTIVE",
        isPrimaryContact: data.isPrimaryContact ?? false,
        ownershipPercentage: data.ownershipPercentage ?? null,
        moveInDate: data.moveInDate ?? null,
        moveOutDate: data.moveOutDate ?? null,
      },
    });
  }

  // Scenario: owner-occupant.
  await findOrCreateResident({
    propertyId: singleFamily.id,
    orgMemberId: morgan.id,
    relationshipType: "OWNER",
    isPrimaryContact: true,
    moveInDate: new Date("2022-03-01"),
  });

  // Scenario: non-resident owner + tenant on the same property.
  await findOrCreateResident({
    propertyId: condo.id,
    orgMemberId: dana.id,
    relationshipType: "NON_RESIDENT_OWNER",
    moveInDate: new Date("2021-06-01"),
  });
  await findOrCreateResident({
    propertyId: condo.id,
    orgMemberId: jordan.id,
    relationshipType: "TENANT",
    isPrimaryContact: true,
    moveInDate: new Date("2026-01-01"),
  });
  // Scenario: archived relationship history -- a prior tenant who moved out
  // before Jordan moved in.
  await findOrCreateResident({
    propertyId: condo.id,
    orgMemberId: samIto.id,
    relationshipType: "TENANT",
    status: "ENDED",
    moveInDate: new Date("2023-07-01"),
    moveOutDate: new Date("2025-12-15"),
  });

  // Scenario: co-owners.
  await findOrCreateResident({
    propertyId: townhome.id,
    orgMemberId: casey.id,
    relationshipType: "OWNER",
    isPrimaryContact: true,
    ownershipPercentage: 50,
    moveInDate: new Date("2020-09-01"),
  });
  await findOrCreateResident({
    propertyId: townhome.id,
    orgMemberId: robin.id,
    relationshipType: "CO_OWNER",
    ownershipPercentage: 50,
    moveInDate: new Date("2020-09-01"),
  });

  // vacantLot and clubhouse deliberately get zero PropertyResident rows --
  // "no current resident" and "association-owned common property" are
  // exactly the absence of any relationship row, not a special value.
  void vacantLot;
  void clubhouse;

  console.log("PropertyResident relationships created (owner-occupant, non-resident owner, tenant, co-owners, archived history).");
  console.log("\nDone. Login as any board member with password HoaDemo!Change1 (e.g. president@oakridgehoa.example).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
