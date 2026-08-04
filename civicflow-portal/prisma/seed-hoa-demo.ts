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

  // ── Violations (HOA Violations MVP) ───────────────────────────────────────
  // Dynamic import, not static -- a static top-level import here would be
  // hoisted ahead of loadDemoEnv()/assertNotProduction() above and
  // transitively trigger @prisma/client's own bundled dotenv loader before
  // this script's env fix has run, exactly the bug documented at length in
  // prisma/seed-demo-guard.ts and fixed the same way in seed-pta-demo.ts.
  const { createViolationDraft, issueViolation, transitionViolationStatus, addViolationComment } = await import(
    "../src/lib/hoa/violations"
  );
  const secretaryId = (await prisma.user.findUnique({ where: { email: "secretary@oakridgehoa.example" } }))!.id;

  // Idempotency guard for the whole violations section: findFirst by the
  // (organizationId, propertyId, violationType) combination used below
  // (Violation has no unique constraint on that triple, so this is an
  // application-level check, same pattern as findOrCreateProperty above)
  // and skip every scenario if this script has already run once.
  const alreadySeeded = await prisma.violation.findFirst({
    where: { organizationId: org.id, propertyId: townhome.id, violationType: "Trash cans left curbside" },
    select: { id: true },
  });

  if (!alreadySeeded) {
    // Scenario 1: still a draft -- an officer working note, nothing sent yet.
    await createViolationDraft({
      organizationId: org.id,
      propertyId: townhome.id,
      violationType: "Trash cans left curbside",
      description: "Trash and recycling bins left at the curb three days after collection, observed during the monthly walkthrough.",
      actorUserId: secretaryId,
    });

    // Scenario 2: issued, awaiting the resident's cure -- exercises the full
    // notice-sending path (real ViolationNotice row, real
    // notifyPropertyResidents call against Morgan Reyes, the owner-occupant).
    const lawnViolation = await createViolationDraft({
      organizationId: org.id,
      propertyId: singleFamily.id,
      violationType: "Lawn maintenance",
      description: "Grass exceeds the 6-inch maximum height specified in the CC&Rs, Section 4.2.",
      actorUserId: secretaryId,
    });
    await issueViolation({
      organizationId: org.id,
      violationId: lawnViolation.id,
      cureByDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      noticeBody: "Please mow your lawn within 14 days to comply with the association's landscaping standards (CC&Rs Section 4.2).",
      actorUserId: secretaryId,
    });

    // Scenario 3: in review, with a private board-only comment -- exercises
    // isPrivate defaulting correctly and the ISSUED -> IN_REVIEW transition.
    const parkingViolation = await createViolationDraft({
      organizationId: org.id,
      propertyId: condo.id,
      violationType: "Unauthorized parking",
      description: "A commercial vehicle has been parked in the resident lot overnight for the past week, in violation of the parking policy.",
      actorUserId: secretaryId,
    });
    await issueViolation({
      organizationId: org.id,
      violationId: parkingViolation.id,
      cureByDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      noticeBody: "Please remove the commercial vehicle from the resident parking lot within 7 days.",
      actorUserId: secretaryId,
    });
    await transitionViolationStatus({
      organizationId: org.id,
      violationId: parkingViolation.id,
      toStatus: "IN_REVIEW",
      actorUserId: secretaryId,
    });
    await addViolationComment({
      organizationId: org.id,
      violationId: parkingViolation.id,
      body: "Called the tenant (Jordan Ellis) — says the vehicle belongs to a contractor doing kitchen work, expects it resolved by Friday.",
      isPrivate: true,
      actorUserId: secretaryId,
    });

    // Scenario 4: resolved -- a closed record with resolutionNotes, exercising
    // the terminal-transition path end to end.
    const paintViolation = await createViolationDraft({
      organizationId: org.id,
      propertyId: singleFamily.id,
      violationType: "Unapproved exterior paint color",
      description: "Front door repainted a color not on the association's approved palette.",
      actorUserId: secretaryId,
    });
    await issueViolation({
      organizationId: org.id,
      violationId: paintViolation.id,
      noticeBody: "Please repaint the front door using an approved color from the palette on file with the association.",
      actorUserId: secretaryId,
    });
    // RESOLVED is only reachable from IN_REVIEW (see the state machine in
    // src/lib/hoa/violations.ts) -- a real bug caught by actually running
    // this seed script against a live database rather than only unit
    // testing the state machine in isolation.
    await transitionViolationStatus({
      organizationId: org.id,
      violationId: paintViolation.id,
      toStatus: "IN_REVIEW",
      actorUserId: secretaryId,
    });
    await transitionViolationStatus({
      organizationId: org.id,
      violationId: paintViolation.id,
      toStatus: "RESOLVED",
      resolutionNotes: "Owner repainted the door with an approved color; confirmed by site visit on the follow-up walkthrough.",
      actorUserId: secretaryId,
    });

    console.log("Violations created (draft, issued, in-review with a private comment, and resolved).");
  } else {
    console.log("Violations already seeded — skipping (idempotent re-run).");
  }

  // ── Architectural Requests ─────────────────────────────────────────────────
  // Same dynamic-import reasoning as the Violations section above.
  const {
    createArchitecturalRequestDraft,
    submitArchitecturalRequest,
    transitionArchitecturalRequestStatus,
    resubmitArchitecturalRequest,
    addArchitecturalRequestComment,
  } = await import("../src/lib/hoa/architectural-requests");

  const architecturalAlreadySeeded = await prisma.architecturalRequest.findFirst({
    where: { organizationId: org.id, propertyId: singleFamily.id, title: "Repaint shutters" },
    select: { id: true },
  });

  if (!architecturalAlreadySeeded) {
    // Scenario 1: still a draft -- Morgan (owner-occupant) hasn't submitted yet.
    await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: singleFamily.id,
      submittedByOrgMemberId: morgan.id,
      category: "PAINT",
      title: "Repaint shutters",
      projectDescription: "Repaint the shutters from white to a dark bronze, keeping the same manufacturer-approved finish.",
    });

    // Scenario 2: submitted, awaiting the board's initial review.
    const fenceRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: townhome.id,
      submittedByOrgMemberId: casey.id,
      category: "FENCE",
      title: "Install rear privacy fence",
      projectDescription: "6-foot cedar privacy fence along the rear property line, matching the association's approved fence style.",
      proposedStartDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: fenceRequest.id, submittedByOrgMemberId: casey.id });

    // Scenario 3: in review, then sent back for changes -- exercises the
    // IN_REVIEW -> CHANGES_REQUESTED transition and a private board note.
    // Dana is a non-resident owner (eligible to submit even though she
    // doesn't live at the property herself).
    const railingRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: condo.id,
      submittedByOrgMemberId: dana.id,
      category: "OTHER",
      title: "Replace balcony railing",
      projectDescription: "Replace the existing wrought-iron balcony railing with a powder-coated aluminum railing in the same black finish.",
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: railingRequest.id, submittedByOrgMemberId: dana.id });
    await transitionArchitecturalRequestStatus({ organizationId: org.id, requestId: railingRequest.id, toStatus: "IN_REVIEW", actorUserId: secretaryId });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: railingRequest.id,
      toStatus: "CHANGES_REQUESTED",
      actorUserId: secretaryId,
      notes: "Spec sheet for the replacement railing wasn't attached -- ask for the manufacturer cut sheet before re-review.",
    });
    await addArchitecturalRequestComment({
      organizationId: org.id,
      requestId: railingRequest.id,
      body: "Please attach the manufacturer's spec sheet for the replacement railing so the committee can confirm the finish matches the building standard.",
      isPrivate: false,
      actorUserId: secretaryId,
    });

    // Scenario 4: resubmitted after changes -- exercises the
    // CHANGES_REQUESTED -> RESUBMITTED transition (Robin, co-owner).
    const landscapingRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: townhome.id,
      submittedByOrgMemberId: robin.id,
      category: "LANDSCAPING",
      title: "Front yard xeriscaping",
      projectDescription: "Replace the front lawn with a drought-tolerant gravel and native-plant landscape design.",
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: landscapingRequest.id, submittedByOrgMemberId: robin.id });
    await transitionArchitecturalRequestStatus({ organizationId: org.id, requestId: landscapingRequest.id, toStatus: "IN_REVIEW", actorUserId: secretaryId });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: landscapingRequest.id,
      toStatus: "CHANGES_REQUESTED",
      actorUserId: secretaryId,
      notes: "Plant list needs to stay within the approved native-species list in the landscaping guidelines.",
    });
    await resubmitArchitecturalRequest({
      organizationId: org.id,
      requestId: landscapingRequest.id,
      submittedByOrgMemberId: robin.id,
      projectDescription: "Replace the front lawn with a drought-tolerant gravel and native-plant landscape design, using only species from the association's approved native-plant list.",
    });

    // Scenario 5: approved outright.
    const solarRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: townhome.id,
      submittedByOrgMemberId: casey.id,
      category: "SOLAR",
      title: "Roof solar panel installation",
      projectDescription: "Install a 20-panel rooftop solar array on the rear-facing roof plane, not visible from the street.",
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: solarRequest.id, submittedByOrgMemberId: casey.id });
    await transitionArchitecturalRequestStatus({ organizationId: org.id, requestId: solarRequest.id, toStatus: "IN_REVIEW", actorUserId: secretaryId });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: solarRequest.id,
      toStatus: "APPROVED",
      actorUserId: secretaryId,
      decisionSummary: "Approved as submitted -- the array is on the rear roof plane and not visible from the street per Section 6.1.",
    });

    // Scenario 6: conditionally approved -- exercises the resident-visible
    // `conditions` field.
    const doorRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: singleFamily.id,
      submittedByOrgMemberId: morgan.id,
      category: "WINDOWS_DOORS",
      title: "Replace front door",
      projectDescription: "Replace the front door with a fiberglass door in a similar style, color to be selected from the approved palette.",
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: doorRequest.id, submittedByOrgMemberId: morgan.id });
    await transitionArchitecturalRequestStatus({ organizationId: org.id, requestId: doorRequest.id, toStatus: "IN_REVIEW", actorUserId: secretaryId });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: doorRequest.id,
      toStatus: "CONDITIONALLY_APPROVED",
      actorUserId: secretaryId,
      decisionSummary: "Approved, subject to the condition below.",
      conditions: "Final door color must be selected from the association's approved palette and confirmed with the board before installation.",
    });

    // Scenario 7: denied.
    const driveRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: condo.id,
      submittedByOrgMemberId: dana.id,
      category: "DRIVEWAY",
      title: "Widen driveway",
      projectDescription: "Widen the driveway by 4 feet to accommodate a second vehicle.",
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: driveRequest.id, submittedByOrgMemberId: dana.id });
    await transitionArchitecturalRequestStatus({ organizationId: org.id, requestId: driveRequest.id, toStatus: "IN_REVIEW", actorUserId: secretaryId });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: driveRequest.id,
      toStatus: "DENIED",
      actorUserId: secretaryId,
      decisionSummary: "Denied -- the proposed widening would reduce the required setback below the minimum in Section 5.4.",
    });

    // Scenario 8: approved, then expired -- exercises the terminal
    // APPROVED -> EXPIRED transition (the approval window lapsed without
    // the work being completed; no automatic expiry job runs this in
    // production yet, see docs/hoa-architectural-requests.md).
    const shedRequest = await createArchitecturalRequestDraft({
      organizationId: org.id,
      propertyId: townhome.id,
      submittedByOrgMemberId: robin.id,
      category: "SHED",
      title: "Backyard storage shed",
      projectDescription: "10x12 prefabricated storage shed, matching the home's siding color, placed behind the rear fence line.",
    });
    await submitArchitecturalRequest({ organizationId: org.id, requestId: shedRequest.id, submittedByOrgMemberId: robin.id });
    await transitionArchitecturalRequestStatus({ organizationId: org.id, requestId: shedRequest.id, toStatus: "IN_REVIEW", actorUserId: secretaryId });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: shedRequest.id,
      toStatus: "APPROVED",
      actorUserId: secretaryId,
      decisionSummary: "Approved as submitted.",
    });
    await transitionArchitecturalRequestStatus({
      organizationId: org.id,
      requestId: shedRequest.id,
      toStatus: "EXPIRED",
      actorUserId: secretaryId,
      notes: "Approval window (12 months) lapsed without the shed being installed; a new request is required to proceed.",
    });

    console.log(
      "Architectural requests created (draft, submitted, changes-requested, resubmitted, approved, conditionally approved, denied, and expired)."
    );
  } else {
    console.log("Architectural requests already seeded — skipping (idempotent re-run).");
  }

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
