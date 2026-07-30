/**
 * Unestra for PTA — fictional demo data ("Pine Grove School PTA").
 *
 * Run with (local/test databases ONLY — never point this at production):
 *   cd civicflow-portal
 *   npx tsx prisma/seed-pta-demo.ts
 *
 * Creates one fictional organization enrolled in the `ptaVertical` Labs
 * feature, with officers, households, students, grades/classrooms/teachers,
 * a membership dues cycle, two events with RSVPs, volunteer opportunities,
 * one fundraising campaign, a committee structure, an announcement, and one
 * approved sample meeting-minutes document.
 *
 * Every name, address, email, and payment reference below is fictional. No
 * real child, family, school, or payment information is used or should ever
 * be substituted in. This script is idempotent (safe to re-run) via
 * upserts/find-or-create checks keyed by stable ids or unique constraints —
 * it never touches any other organization's data.
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

const SCHOOL_YEAR = "2026-2027";
const GRADES = ["Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade", "5th Grade"];

async function findOrCreateTeacher(organizationId: string, name: string) {
  const existing = await prisma.ptaTeacher.findFirst({ where: { organizationId, name } });
  return existing ?? prisma.ptaTeacher.create({ data: { organizationId, name } });
}

async function findOrCreateHouseholdAdult(organizationId: string, householdId: string, data: { name: string; email: string; phone: string; userId?: string | null; relationshipLabel: string }) {
  const existing = await prisma.ptaHouseholdAdult.findFirst({ where: { organizationId, householdId, name: data.name } });
  return existing ?? prisma.ptaHouseholdAdult.create({ data: { organizationId, householdId, ...data } });
}

async function findOrCreateStudent(organizationId: string, householdId: string, displayName: string) {
  const existing = await prisma.ptaStudent.findFirst({ where: { organizationId, householdId, displayName } });
  return existing ?? prisma.ptaStudent.create({ data: { organizationId, householdId, displayName } });
}

async function findOrCreateDuesAccount(organizationId: string, memberId: string) {
  const existing = await prisma.duesAccount.findFirst({ where: { organizationId, memberId, name: "PTA Membership Dues" } });
  return existing ?? prisma.duesAccount.create({ data: { organizationId, memberId, name: "PTA Membership Dues", frequency: "annual", amountDefault: 25 } });
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();

  console.log("Seeding fictional Pine Grove School PTA demo data...\n");

  // ── Organization ───────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "pine-grove-school-pta" },
    update: {},
    create: {
      slug: "pine-grove-school-pta",
      name: "Pine Grove School PTA",
      organizationType: "PTA",
      plan: "elite", // satisfies ptaVertical's requiresEntitlement without touching the APH-only billingExempt flag
      email: "hello@pinegrovepta.example",
      website: "https://pinegrovepta.example",
    },
  });
  console.log(`Organization: ${org.name} (${org.id})`);

  // ── Labs enrollment (local/test only — never run against production) ──────
  await prisma.organizationLabFeature.upsert({
    where: { organizationId_featureKey: { organizationId: org.id, featureKey: "ptaVertical" } },
    update: { status: "ENABLED" },
    create: { organizationId: org.id, featureKey: "ptaVertical", status: "ENABLED", enrollmentSource: "seed" },
  });

  // ── PTA profile ──────────────────────────────────────────────────────────
  await prisma.ptaProfile.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      schoolOrPtaName: "Pine Grove Elementary School PTA",
      designation: "PTA",
      currentSchoolYear: SCHOOL_YEAR,
      schoolAddress: "123 Pine Grove Lane, Springfield, ST 00000 (fictional)",
      schoolWebsite: "https://pinegrove-elementary.example",
      principalName: "Dr. Jamie Rivera (fictional)",
      contactEmail: "board@pinegrovepta.example",
      membershipModel: "HOUSEHOLD",
      defaultDuesAmountCents: 2500,
      gradesServed: GRADES,
    },
  });

  // ── Officers (users + org memberships) ──────────────────────────────────────
  async function upsertOfficer(email: string, displayName: string, role: "ORG_OWNER" | "ORG_ADMIN" | "FINANCE" | "STAFF" | "READ_ONLY") {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, displayName, passwordHash: await hash("PtaDemo!Change1"), emailVerified: true },
    });
    await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: { role },
      create: { organizationId: org.id, userId: user.id, role, status: "active", joinedAt: new Date() },
    });
    return user;
  }

  const president = await upsertOfficer("president@pinegrovepta.example", "Alex Morgan (President)", "ORG_OWNER");
  await upsertOfficer("vp@pinegrovepta.example", "Jordan Lee (Vice President)", "ORG_ADMIN");
  await upsertOfficer("treasurer@pinegrovepta.example", "Casey Kim (Treasurer)", "FINANCE");
  await upsertOfficer("secretary@pinegrovepta.example", "Riley Chen (Secretary / Membership Chair)", "STAFF");
  await upsertOfficer("member@pinegrovepta.example", "Sam Patel (General Member)", "READ_ONLY");
  console.log("Officers created (President, VP, Treasurer, Secretary, General Member).");

  // ── Grades, teachers, classrooms ────────────────────────────────────────────
  const grades = await Promise.all(
    GRADES.map((name, i) =>
      prisma.ptaGrade.upsert({ where: { organizationId_name: { organizationId: org.id, name } }, update: {}, create: { organizationId: org.id, name, sortOrder: i } })
    )
  );

  const teachers = await Promise.all(
    ["Ms. Alvarez (fictional)", "Mr. Nguyen (fictional)", "Mx. Osei (fictional)"].map((name) => findOrCreateTeacher(org.id, name))
  );

  const classrooms = await Promise.all(
    grades.slice(0, 3).map((grade, i) =>
      prisma.ptaClassroom.upsert({
        where: { organizationId_gradeId_name_schoolYear: { organizationId: org.id, gradeId: grade.id, name: "Room A", schoolYear: SCHOOL_YEAR } },
        update: {},
        create: { organizationId: org.id, gradeId: grade.id, name: "Room A", schoolYear: SCHOOL_YEAR, teacherId: teachers[i % teachers.length]?.id },
      })
    )
  );

  // ── Households, adults, students, dues ──────────────────────────────────────
  // Each household deliberately demonstrates a different membership/dues
  // scenario, so every screen in the product has something real to show
  // rather than a single repeated "happy path."
  const householdSeeds = [
    { name: "The Morgan Household", adults: [{ name: "Alex Morgan", email: president.email, phone: "555-0101", userId: president.id, primary: true }], students: [{ name: "Riley M.", grade: 0 }], scenario: "paid" },
    { name: "The Kim Household", adults: [{ name: "Casey Kim", email: "casey@pinegrovepta.example", phone: "555-0102", primary: true }, { name: "Drew Kim", email: "drew@pinegrovepta.example", phone: "555-0103", primary: false }], students: [{ name: "Avery K.", grade: 1 }, { name: "Quinn K.", grade: 2 }], scenario: "unpaid" },
    { name: "The Chen Household", adults: [{ name: "Riley Chen", email: "riley.chen@pinegrovepta.example", phone: "555-0104", primary: true }], students: [{ name: "Skylar C.", grade: 0 }], scenario: "pending_review" },
    { name: "The Osei Household", adults: [{ name: "Nia Osei", email: "nia.osei@pinegrovepta.example", phone: "555-0105", primary: true }, { name: "Femi Osei", email: "femi.osei@pinegrovepta.example", phone: "555-0106", primary: false }], students: [{ name: "Amara O.", grade: 1 }], scenario: "waived" },
    { name: "The Patel Household", adults: [{ name: "Sam Patel", email: "member@pinegrovepta.example", phone: "555-0107", primary: true }], students: [{ name: "Dev P.", grade: 2 }], scenario: "prior_year" },
    { name: "The Whitfield Household", adults: [{ name: "Jordan Whitfield", email: "jordan.whitfield@pinegrovepta.example", phone: "555-0108", primary: true }], students: [] as { name: string; grade: number }[], scenario: "no_students" },
  ] as const;

  const households: Array<{ id: string; adultIds: string[]; studentIds: string[]; orgMemberId: string }> = [];
  for (const seed of householdSeeds) {
    const orgMember = await prisma.orgMember.upsert({
      where: { organizationId_memberNumber: { organizationId: org.id, memberNumber: seed.name } },
      update: {},
      create: { organizationId: org.id, firstName: seed.name, lastName: "(PTA Household)", householdName: seed.name, memberNumber: seed.name },
    });

    const household = await prisma.ptaHousehold.upsert({
      where: { organizationId_displayName_schoolYear: { organizationId: org.id, displayName: seed.name, schoolYear: SCHOOL_YEAR } },
      update: {},
      create: { organizationId: org.id, displayName: seed.name, schoolYear: SCHOOL_YEAR, orgMemberId: orgMember.id, volunteerInterests: ["Book Fair", "Family Night"] },
    });

    const adultIds: string[] = [];
    let primaryAdultId: string | null = null;
    for (const adultSeed of seed.adults) {
      const adult = await findOrCreateHouseholdAdult(org.id, household.id, {
        name: adultSeed.name,
        email: adultSeed.email,
        phone: adultSeed.phone,
        userId: "userId" in adultSeed ? adultSeed.userId : null,
        relationshipLabel: "Parent",
      });
      adultIds.push(adult.id);
      if (adultSeed.primary) primaryAdultId = adult.id;
    }
    if (primaryAdultId) await prisma.ptaHousehold.update({ where: { id: household.id }, data: { primaryContactAdultId: primaryAdultId } });

    const studentIds: string[] = [];
    for (const studentSeed of seed.students) {
      const student = await findOrCreateStudent(org.id, household.id, studentSeed.name);
      studentIds.push(student.id);
      const classroom = classrooms[studentSeed.grade % classrooms.length];
      if (classroom) {
        await prisma.ptaStudentEnrollment.upsert({
          where: { studentId_schoolYear: { studentId: student.id, schoolYear: SCHOOL_YEAR } },
          update: { classroomId: classroom.id },
          create: { organizationId: org.id, studentId: student.id, classroomId: classroom.id, schoolYear: SCHOOL_YEAR },
        });
      }
    }

    households.push({ id: household.id, adultIds, studentIds, orgMemberId: orgMember.id });

    const duesAccount = await findOrCreateDuesAccount(org.id, orgMember.id);
    const periodStart = new Date(`${SCHOOL_YEAR.slice(0, 4)}-08-01`);
    const periodEnd = new Date(`${SCHOOL_YEAR.slice(5)}-06-30`);
    const charge = await prisma.duesCharge.upsert({
      where: { organizationId_memberId_duesAccountId_periodStart_periodEnd: { organizationId: org.id, memberId: orgMember.id, duesAccountId: duesAccount.id, periodStart, periodEnd } },
      update: {},
      create: { organizationId: org.id, memberId: orgMember.id, duesAccountId: duesAccount.id, amountDue: 25, dueDate: new Date(`${SCHOOL_YEAR.slice(0, 4)}-09-01`), periodStart, periodEnd },
    });

    if (seed.scenario === "paid" && charge.status !== "PAID") {
      const existingPayment = await prisma.duesPayment.findFirst({ where: { organizationId: org.id, duesChargeId: charge.id } });
      if (!existingPayment) {
        await prisma.duesPayment.create({ data: { organizationId: org.id, memberId: orgMember.id, duesChargeId: charge.id, amount: 25, paymentDate: new Date(), method: "CREDIT_CARD" } });
      }
      await prisma.duesCharge.update({ where: { id: charge.id }, data: { amountPaid: 25, status: "PAID" } });
    }

    if (seed.scenario === "pending_review") {
      // A parent reported paying by check; nobody has approved it yet — the
      // charge itself stays PENDING until an officer acts on the report.
      const existing = await prisma.paymentReport.findFirst({ where: { organizationId: org.id, memberId: orgMember.id, duesChargeId: charge.id, status: "pending" } });
      if (!existing) {
        await prisma.paymentReport.create({
          data: {
            organizationId: org.id,
            memberId: orgMember.id,
            duesChargeId: charge.id,
            amount: 25,
            paymentMethod: "CHECK",
            paymentDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            referenceNumber: "Check #1042 (fictional)",
            note: "Paid at the PTA meeting drop box (fictional demo data).",
            category: "MEMBERSHIP_DUES",
            status: "pending",
          },
        });
      }
    }

    if (seed.scenario === "waived") {
      if (charge.status !== "WAIVED") {
        await prisma.duesCharge.update({ where: { id: charge.id }, data: { status: "WAIVED", notes: "Waived for financial hardship (fictional demo data)." } });
        const existingAdjustment = await prisma.duesAdjustment.findFirst({ where: { organizationId: org.id, duesChargeId: charge.id, adjustmentType: "WAIVER" } });
        if (!existingAdjustment) {
          await prisma.duesAdjustment.create({
            data: {
              organizationId: org.id,
              memberId: orgMember.id,
              duesChargeId: charge.id,
              adjustmentType: "WAIVER",
              amount: 25,
              reason: "Financial hardship waiver (fictional demo data).",
              approvedByUserId: president.id,
              createdByUserId: president.id,
            },
          });
        }
      }
    }

    if (seed.scenario === "prior_year") {
      // Alongside the current-year charge above, also give this household a
      // fully-paid PRIOR school year charge — demonstrates that a household's
      // dues history survives across school years rather than only ever
      // showing "this year."
      const priorYear = "2025-2026";
      const priorStart = new Date("2025-08-01");
      const priorEnd = new Date("2026-06-30");
      const priorCharge = await prisma.duesCharge.upsert({
        where: { organizationId_memberId_duesAccountId_periodStart_periodEnd: { organizationId: org.id, memberId: orgMember.id, duesAccountId: duesAccount.id, periodStart: priorStart, periodEnd: priorEnd } },
        update: {},
        create: { organizationId: org.id, memberId: orgMember.id, duesAccountId: duesAccount.id, amountDue: 20, amountPaid: 20, status: "PAID", dueDate: new Date("2025-09-01"), periodStart: priorStart, periodEnd: priorEnd },
      });
      const existingPriorPayment = await prisma.duesPayment.findFirst({ where: { organizationId: org.id, duesChargeId: priorCharge.id } });
      if (!existingPriorPayment) {
        await prisma.duesPayment.create({ data: { organizationId: org.id, memberId: orgMember.id, duesChargeId: priorCharge.id, amount: 20, paymentDate: new Date("2025-09-05"), method: "CHECK", reference: `Prior-year dues, ${priorYear} (fictional)` } });
      }
    }
    // "unpaid" and "no_students" households intentionally get no further
    // action here — the current-year charge created above already stays
    // PENDING/unpaid, which is the scenario itself.
  }
  console.log(`${households.length} fictional households created, covering paid / unpaid / pending-review / waived / prior-year / no-students scenarios.`);

  // A second payment report, already approved, so the Payment Reports queue
  // shows both an outstanding item and a resolved one rather than only ever
  // pending items.
  const paidHousehold = households[0];
  if (paidHousehold) {
    const approvedExisting = await prisma.paymentReport.findFirst({ where: { organizationId: org.id, memberId: paidHousehold.orgMemberId, status: "approved" } });
    if (!approvedExisting) {
      await prisma.paymentReport.create({
        data: {
          organizationId: org.id,
          memberId: paidHousehold.orgMemberId,
          amount: 25,
          paymentMethod: "CREDIT_CARD",
          paymentDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          note: "Approved at the September meeting (fictional demo data).",
          category: "MEMBERSHIP_DUES",
          status: "approved",
          reviewedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  console.log("Payment reports created (one pending review, one already approved).");

  // ── Committees ───────────────────────────────────────────────────────────
  const committeeSeeds = [
    { name: "Membership", chairHouseholdIdx: 0 },
    { name: "Fundraising", chairHouseholdIdx: 1 },
    { name: "Family Engagement", chairHouseholdIdx: 2 },
  ];
  for (const c of committeeSeeds) {
    const committee = await prisma.ptaCommittee.upsert({ where: { organizationId_name: { organizationId: org.id, name: c.name } }, update: {}, create: { organizationId: org.id, name: c.name } });
    const chairAdultId = households[c.chairHouseholdIdx]?.adultIds[0];
    if (chairAdultId) {
      await prisma.ptaCommittee.update({ where: { id: committee.id }, data: { chairAdultId } });
      await prisma.ptaCommitteeMember.upsert({
        where: { committeeId_householdAdultId: { committeeId: committee.id, householdAdultId: chairAdultId } },
        update: {},
        create: { organizationId: org.id, committeeId: committee.id, householdAdultId: chairAdultId },
      });
    }
  }
  // PtaCommittee has no archived/status field in the current schema — this
  // is simulated via naming/description rather than a real lifecycle state,
  // and documented as a known limitation rather than silently implied.
  await prisma.ptaCommittee.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Winter Gala Committee (2025 — concluded)" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "Winter Gala Committee (2025 — concluded)",
      description: "Ran the 2025 Winter Gala fundraiser; the event has concluded and this committee is no longer active (fictional demo data). No \"archived\" status field exists yet — see docs/pta-demo-environment.md.",
    },
  });
  console.log("Committees created (Membership, Fundraising, Family Engagement, plus one concluded committee).");

  // ── Events + RSVPs ─────────────────────────────────────────────────────────
  const bookFair = await prisma.event.upsert({
    where: { id: "seed-pta-book-fair" },
    update: {},
    create: { id: "seed-pta-book-fair", organizationId: org.id, title: "Scholastic Book Fair", description: "Annual book fair fundraiser (fictional).", startAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), status: "upcoming" },
  });
  const familyNight = await prisma.event.upsert({
    where: { id: "seed-pta-family-night" },
    update: {},
    create: { id: "seed-pta-family-night", organizationId: org.id, title: "Family Movie Night", description: "Outdoor movie night for PTA families (fictional).", startAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000), status: "upcoming" },
  });

  for (const h of households.slice(0, 3)) {
    await prisma.ptaEventRsvp.upsert({ where: { eventId_householdId: { eventId: bookFair.id, householdId: h.id } }, update: {}, create: { organizationId: org.id, eventId: bookFair.id, householdId: h.id, status: "GOING", attendeeCount: 2 } });
  }
  for (const h of households.slice(2, 5)) {
    await prisma.ptaEventRsvp.upsert({ where: { eventId_householdId: { eventId: familyNight.id, householdId: h.id } }, update: {}, create: { organizationId: org.id, eventId: familyNight.id, householdId: h.id, status: "GOING", attendeeCount: 3 } });
  }
  console.log("Two fictional events created with RSVPs (Book Fair, Family Movie Night).");

  // ── Volunteer opportunities ────────────────────────────────────────────────
  const opportunity = await prisma.ptaVolunteerOpportunity.upsert({
    where: { id: "seed-pta-book-fair-volunteers" },
    update: {},
    create: { id: "seed-pta-book-fair-volunteers", organizationId: org.id, eventId: bookFair.id, title: "Book Fair Setup & Cashiering", description: "Help set up tables and staff the register (fictional).", schoolYear: SCHOOL_YEAR, status: "OPEN" },
  });
  const morningSlot = await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-morning" },
    update: {},
    create: { id: "seed-pta-slot-morning", organizationId: org.id, opportunityId: opportunity.id, label: "Morning shift (9am-12pm)", capacity: 3 },
  });
  const afternoonSlot = await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-afternoon" },
    update: {},
    // capacity 1 so a single signup below makes this slot fully claimed —
    // the "full" scenario the demo brief asks for.
    create: { id: "seed-pta-slot-afternoon", organizationId: org.id, opportunityId: opportunity.id, label: "Afternoon shift (12pm-3pm)", capacity: 1 },
  });

  const firstAdult = households[0]?.adultIds[0];
  const secondAdult = households[1]?.adultIds[0];
  if (firstAdult) {
    const existingSignup = await prisma.ptaVolunteerSignup.findUnique({ where: { slotId_householdAdultId: { slotId: morningSlot.id, householdAdultId: firstAdult } } });
    if (!existingSignup) {
      await prisma.ptaVolunteerSignup.create({ data: { organizationId: org.id, slotId: morningSlot.id, householdAdultId: firstAdult, status: "SIGNED_UP" } });
      await prisma.ptaVolunteerSlot.update({ where: { id: morningSlot.id }, data: { claimedCount: 1 } });
    }
  }
  if (secondAdult) {
    const existingSignup = await prisma.ptaVolunteerSignup.findUnique({ where: { slotId_householdAdultId: { slotId: afternoonSlot.id, householdAdultId: secondAdult } } });
    if (!existingSignup) {
      await prisma.ptaVolunteerSignup.create({ data: { organizationId: org.id, slotId: afternoonSlot.id, householdAdultId: secondAdult, status: "SIGNED_UP" } });
      await prisma.ptaVolunteerSlot.update({ where: { id: afternoonSlot.id }, data: { claimedCount: 1 } });
    }
  }

  // A second, entirely empty opportunity — the "nobody has signed up yet" scenario.
  const emptyOpportunity = await prisma.ptaVolunteerOpportunity.upsert({
    where: { id: "seed-pta-family-night-volunteers" },
    update: {},
    create: { id: "seed-pta-family-night-volunteers", organizationId: org.id, eventId: familyNight.id, title: "Family Movie Night Setup", description: "Help set up chairs and the projector (fictional).", schoolYear: SCHOOL_YEAR, status: "OPEN" },
  });
  await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-movie-night" },
    update: {},
    create: { id: "seed-pta-slot-movie-night", organizationId: org.id, opportunityId: emptyOpportunity.id, label: "5pm-7pm", capacity: 4 },
  });
  console.log("Volunteer opportunities created: one with a partially-filled slot and one fully-claimed slot, plus one entirely empty opportunity.");

  // ── Volunteer-hours tracking: attendance, ledger, and requirement scenarios ─
  // A family volunteer-hour goal — 10 hours/household. Every household below
  // demonstrates a different position relative to it (exceeded, met, close,
  // zero) rather than one repeated case.
  await prisma.ptaVolunteerRequirement.upsert({
    where: { organizationId_schoolYear: { organizationId: org.id, schoolYear: SCHOOL_YEAR } },
    update: {},
    create: { organizationId: org.id, schoolYear: SCHOOL_YEAR, requiredMinutes: 600, active: true },
  });

  // A completed opportunity with a full attendance/hours history — the
  // "we already ran this and processed the hours" scenario, as opposed to
  // Book Fair/Family Night above (still upcoming/open).
  const teacherBreakfast = await prisma.ptaVolunteerOpportunity.upsert({
    where: { id: "seed-pta-teacher-breakfast" },
    update: {},
    create: {
      id: "seed-pta-teacher-breakfast",
      organizationId: org.id,
      title: "Teacher Appreciation Breakfast",
      description: "Set up and serve a breakfast for the school's teaching staff (fictional).",
      schoolYear: SCHOOL_YEAR,
      status: "COMPLETED",
      coordinatorUserId: president.id,
    },
  });
  const breakfastSlot = await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-breakfast" },
    update: {},
    create: {
      id: "seed-pta-slot-breakfast",
      organizationId: org.id,
      opportunityId: teacherBreakfast.id,
      label: "7am-9am setup and serving",
      capacity: 6,
      startAt: new Date("2026-10-01T07:00:00-04:00"),
      endAt: new Date("2026-10-01T09:00:00-04:00"),
      defaultCreditedMinutes: 120,
      status: "CLOSED",
    },
  });

  // household index: 0 Morgan, 1 Kim, 2 Chen, 3 Osei, 4 Patel, 5 Whitfield
  const morganAdult = households[0]?.adultIds[0];
  const [caseyKim, drewKim] = households[1]?.adultIds ?? [];
  const [niaOsei, femiOsei] = households[3]?.adultIds ?? [];
  const samPatel = households[4]?.adultIds[0];
  // Whitfield (households[5]) deliberately gets no signup, attendance, or
  // hour entry at all — see the "household with zero hours" scenario below.

  async function seedAttendedSignup(
    householdAdultId: string | undefined,
    outcome: "ATTENDED" | "NO_SHOW" | "EXCUSED",
    checkIn: string | null,
    checkOut: string | null
  ) {
    if (!householdAdultId) return null;
    // Resolved explicitly rather than assumed — this exact omission (a
    // signup created without its denormalized householdId) was caught live
    // by querying the seeded ledger directly: every entry silently had a
    // blank householdId, which would make every household-hours total and
    // report see zero hours despite real approved/pending entries existing.
    const adultRecord = await prisma.ptaHouseholdAdult.findFirstOrThrow({ where: { id: householdAdultId, organizationId: org.id } });
    const signup = await prisma.ptaVolunteerSignup.upsert({
      where: { slotId_householdAdultId: { slotId: breakfastSlot.id, householdAdultId } },
      update: {},
      create: { organizationId: org.id, slotId: breakfastSlot.id, householdAdultId, householdId: adultRecord.householdId, status: outcome, source: "SELF" },
    });
    if (checkIn) {
      await prisma.ptaVolunteerAttendance.upsert({
        where: { signupId: signup.id },
        update: {},
        create: {
          organizationId: org.id,
          signupId: signup.id,
          scheduledStart: breakfastSlot.startAt,
          scheduledEnd: breakfastSlot.endAt,
          checkInAt: checkIn ? new Date(checkIn) : null,
          checkOutAt: checkOut ? new Date(checkOut) : null,
          status: outcome === "ATTENDED" ? "ATTENDED" : outcome,
          recordedByUserId: president.id,
        },
      });
    }
    return signup;
  }

  const morganSignup = await seedAttendedSignup(morganAdult, "ATTENDED", "2026-10-01T07:00:00-04:00", "2026-10-01T09:00:00-04:00");
  const kimSignup = await seedAttendedSignup(caseyKim, "ATTENDED", "2026-10-01T07:00:00-04:00", "2026-10-01T08:00:00-04:00");
  const oseiSignup = await seedAttendedSignup(niaOsei, "ATTENDED", "2026-10-01T07:00:00-04:00", "2026-10-01T09:00:00-04:00");
  const patelSignup = await seedAttendedSignup(samPatel, "ATTENDED", "2026-10-01T07:00:00-04:00", "2026-10-01T08:30:00-04:00");
  await seedAttendedSignup(drewKim, "NO_SHOW", null, null);
  await seedAttendedSignup(femiOsei, "EXCUSED", null, null);
  await prisma.ptaVolunteerSlot.updateMany({ where: { id: breakfastSlot.id }, data: { claimedCount: 6 } });

  async function seedHourEntry(
    signup: { id: string; householdAdultId: string; householdId: string | null } | null,
    creditedMinutes: number,
    outcome: "PENDING" | "APPROVED" | "REJECTED"
  ) {
    if (!signup) return null;
    const existing = await prisma.ptaVolunteerHourEntry.findFirst({ where: { organizationId: org.id, signupId: signup.id } });
    if (existing) return existing;
    return prisma.ptaVolunteerHourEntry.create({
      data: {
        organizationId: org.id,
        schoolYear: SCHOOL_YEAR,
        signupId: signup.id,
        householdAdultId: signup.householdAdultId,
        householdId: signup.householdId,
        opportunityId: teacherBreakfast.id,
        slotId: breakfastSlot.id,
        creditedMinutes,
        status: outcome,
        source: "OFFICER_MANUAL",
        ...(outcome === "APPROVED" ? { approvedByUserId: president.id, approvedAt: new Date() } : {}),
        ...(outcome === "REJECTED" ? { rejectedByUserId: president.id, rejectedAt: new Date(), notes: "No sign-in sheet entry found for this shift (fictional demo data)." } : {}),
      },
    });
  }

  // Morgan: "household with many hours" — a base 780 minutes approved, then a
  // +120 minute adjustment on top (with a documented reason) so this single
  // scenario demonstrates both "clearly exceeds the requirement" and the
  // adjustment/audit-trail feature at once, without needing a second signup.
  const morganEntry = await seedHourEntry(morganSignup, 780, "APPROVED");
  if (morganEntry) {
    const existingAdjustment = await prisma.ptaVolunteerHourAdjustment.findFirst({ where: { hourEntryId: morganEntry.id } });
    if (!existingAdjustment) {
      await prisma.ptaVolunteerHourAdjustment.create({
        data: { organizationId: org.id, hourEntryId: morganEntry.id, minuteAdjustment: 120, reason: "Also covered two additional setup shifts logged separately on paper (fictional demo data).", actorUserId: president.id },
      });
      await prisma.ptaVolunteerHourEntry.update({ where: { id: morganEntry.id }, data: { creditedMinutes: 900 } });
    }
  }

  // Osei: "household that met its requirement" — exactly at the 600-minute goal.
  await seedHourEntry(oseiSignup, 600, "APPROVED");

  // Kim: "household near its requirement" — 480 of 600 minutes, still PENDING (not yet counted toward the goal until approved).
  await seedHourEntry(kimSignup, 480, "PENDING");

  // Patel: a reported shift that got rejected (e.g. no attendance evidence) — the household's hours stay at zero from this shift.
  await seedHourEntry(patelSignup, 90, "REJECTED");

  // Whitfield: "household with zero hours" — no signups, no attendance, no entries at all (nothing to seed).

  console.log("Volunteer attendance and hour-ledger scenarios created: attended/no-show/excused, pending/approved/rejected/adjusted hours, and a household-hour-requirement mix.");

  // A canceled opportunity — the "this activity isn't happening" scenario.
  await prisma.ptaVolunteerOpportunity.upsert({
    where: { id: "seed-pta-fall-festival" },
    update: {},
    create: {
      id: "seed-pta-fall-festival",
      organizationId: org.id,
      title: "Fall Festival Setup",
      description: "Canceled due to a venue scheduling conflict (fictional demo data).",
      schoolYear: SCHOOL_YEAR,
      status: "CANCELLED",
    },
  });

  // A fifth, ordinary open opportunity for general realism.
  const pictureDay = await prisma.ptaVolunteerOpportunity.upsert({
    where: { id: "seed-pta-picture-day" },
    update: {},
    create: {
      id: "seed-pta-picture-day",
      organizationId: org.id,
      title: "Picture Day Helpers",
      description: "Help line students up by classroom for individual photos (fictional).",
      schoolYear: SCHOOL_YEAR,
      status: "OPEN",
    },
  });
  await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-picture-day" },
    update: {},
    create: { id: "seed-pta-slot-picture-day", organizationId: org.id, opportunityId: pictureDay.id, label: "Full day", capacity: 3, minNeeded: 2 },
  });
  console.log("Fifth opportunity created (Picture Day Helpers), plus one canceled opportunity (Fall Festival Setup).");

  // ── Fundraising campaign ────────────────────────────────────────────────────
  const campaign = await prisma.campaign.upsert({
    where: { id: "seed-pta-fall-fun-run" },
    update: {},
    create: { id: "seed-pta-fall-fun-run", organizationId: org.id, name: "Fall Fun Run", description: "Annual fun-run fundraiser (fictional).", goal: 5000, status: "active" },
  });
  const firstHouseholdMember = await prisma.orgMember.findFirst({ where: { organizationId: org.id, memberNumber: householdSeeds[0].name } });
  if (firstHouseholdMember) {
    const existingContribution = await prisma.contribution.findFirst({ where: { organizationId: org.id, campaignId: campaign.id, memberId: firstHouseholdMember.id } });
    if (!existingContribution) {
      await prisma.contribution.create({ data: { organizationId: org.id, memberId: firstHouseholdMember.id, campaignId: campaign.id, amount: 100, contributionDate: new Date(), source: "MANUAL" } });
    }
  }
  console.log("Fictional fundraising campaign created (Fall Fun Run).");

  // ── Announcement ────────────────────────────────────────────────────────────
  await prisma.communicationCampaign.upsert({
    where: { id: "seed-pta-welcome-announcement" },
    update: {},
    create: {
      id: "seed-pta-welcome-announcement",
      organizationId: org.id,
      createdByUserId: president.id,
      communicationType: "ANNOUNCEMENT",
      channel: "INTERNAL_LOG_ONLY",
      title: "Welcome to Pine Grove PTA!",
      subject: "Welcome to Pine Grove PTA!",
      body: "Welcome back, Pine Grove families! (fictional demo announcement)",
      status: "SENT",
      sentAt: new Date(),
    },
  });
  // Scheduled (not yet sent) and canceled announcements, alongside the sent
  // one above — CommunicationCampaignStatus has no literal "SCHEDULED" or
  // "ARCHIVED" value, so these use READY+scheduledFor and CANCELED
  // respectively, the closest real states the schema supports.
  await prisma.communicationCampaign.upsert({
    where: { id: "seed-pta-book-fair-reminder" },
    update: {},
    create: {
      id: "seed-pta-book-fair-reminder",
      organizationId: org.id,
      createdByUserId: president.id,
      communicationType: "ANNOUNCEMENT",
      channel: "INTERNAL_LOG_ONLY",
      title: "Book Fair Reminder",
      subject: "Book Fair Reminder",
      body: "Don't forget — the Scholastic Book Fair is next week! (fictional demo announcement)",
      status: "READY",
      scheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.communicationCampaign.upsert({
    where: { id: "seed-pta-canceled-bake-sale" },
    update: {},
    create: {
      id: "seed-pta-canceled-bake-sale",
      organizationId: org.id,
      createdByUserId: president.id,
      communicationType: "ANNOUNCEMENT",
      channel: "INTERNAL_LOG_ONLY",
      title: "Spring Bake Sale (canceled)",
      subject: "Spring Bake Sale (canceled)",
      body: "The spring bake sale has been canceled due to a scheduling conflict (fictional demo announcement).",
      status: "CANCELED",
    },
  });
  console.log("Fictional announcements created: sent, scheduled, and canceled.");

  // ── Fictional documents ──────────────────────────────────────────────────
  // No PTA-specific document model/API exists yet (see docs/pta-labs-mvp.md
  // and the officer-UI-integration sprint's documents placeholder page) —
  // these rows use the existing generic, org-scoped Attachment model so the
  // demo organization has plausible document METADATA to look at, without
  // implying a document-management UI exists to browse them.
  const documentSeeds = [
    { id: "seed-pta-doc-bylaws", fileName: "Pine_Grove_PTA_Bylaws_2026.pdf", title: "PTA Bylaws (2026 revision)" },
    { id: "seed-pta-doc-budget", fileName: "Pine_Grove_PTA_Budget_2026-2027.xlsx", title: "Annual Budget, 2026-2027" },
  ];
  for (const doc of documentSeeds) {
    await prisma.attachment.upsert({
      where: { id: doc.id },
      update: {},
      create: {
        id: doc.id,
        organizationId: org.id,
        entityType: "ORGANIZATION",
        entityId: org.id,
        purpose: "pta_document",
        title: doc.title,
        fileName: doc.fileName,
        contentType: doc.fileName.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        byteSize: 245_000,
        objectKey: `seed-fixtures/pta/${doc.fileName}`,
        uploadedByUserId: president.id,
      },
    });
  }
  console.log("Fictional PTA documents created (bylaws, budget) — metadata only, no real file bytes.");

  // ── Approved sample minutes (Meeting + Attachment, no Meeting Intelligence) ─
  const meeting = await prisma.meeting.upsert({
    where: { id: "seed-pta-september-meeting" },
    update: {},
    create: { id: "seed-pta-september-meeting", organizationId: org.id, title: "September PTA General Meeting", meetingType: "General Meeting", meetingDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), createdByUserId: president.id },
  });
  await prisma.attachment.upsert({
    where: { id: "seed-pta-september-minutes" },
    update: {},
    create: {
      id: "seed-pta-september-minutes",
      organizationId: org.id,
      entityType: "MEETING",
      entityId: meeting.id,
      purpose: "approved_minutes",
      title: "September PTA General Meeting — Approved Minutes",
      fileName: "september-2026-minutes.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
      objectKey: "seed-fixtures/pta/september-2026-minutes.pdf",
      uploadedByUserId: president.id,
    },
  });
  console.log("One approved sample-minutes document created.");

  // ── Parent Membership & Dues Self-Service fictional scenarios ──────────────
  // households[]: 0=Morgan(PAID), 1=Kim(PENDING), 2=Chen(PAID), 3=Osei(PENDING), 4=Patel(PAID)
  const morganHousehold = await prisma.ptaHousehold.findUniqueOrThrow({ where: { id: households[0].id } });
  const kimHousehold = await prisma.ptaHousehold.findUniqueOrThrow({ where: { id: households[1].id } });
  const cheHousehold = await prisma.ptaHousehold.findUniqueOrThrow({ where: { id: households[2].id } });
  const oseiHousehold = await prisma.ptaHousehold.findUniqueOrThrow({ where: { id: households[3].id } });

  // Waived scenario — the Kim household's current charge is waived.
  if (kimHousehold.orgMemberId) {
    const kimCharge = await prisma.duesCharge.findFirst({ where: { organizationId: org.id, memberId: kimHousehold.orgMemberId } });
    if (kimCharge && kimCharge.status !== "WAIVED") {
      await prisma.duesCharge.update({ where: { id: kimCharge.id }, data: { status: "WAIVED", notes: "Financial hardship waiver (fictional)" } });
      const existingWaiver = await prisma.duesAdjustment.findFirst({ where: { organizationId: org.id, duesChargeId: kimCharge.id, adjustmentType: "WAIVER" } });
      if (!existingWaiver) {
        await prisma.duesAdjustment.create({ data: { organizationId: org.id, memberId: kimHousehold.orgMemberId, duesChargeId: kimCharge.id, adjustmentType: "WAIVER", amount: 25, reason: "Financial hardship waiver (fictional)" } });
      }
    }
  }

  // "Refund" scenario — dues has no distinct REFUNDED status (see
  // docs/pta-parent-dues-self-service.md's status-mapping section); a real
  // refund is represented as a DuesAdjustment on an already-paid charge, with
  // a reason documenting it. This demonstrates that representation, not a
  // fabricated status.
  if (morganHousehold.orgMemberId) {
    const morganCharge = await prisma.duesCharge.findFirst({ where: { organizationId: org.id, memberId: morganHousehold.orgMemberId, status: "PAID" } });
    if (morganCharge) {
      const existingRefundNote = await prisma.duesAdjustment.findFirst({ where: { organizationId: org.id, duesChargeId: morganCharge.id, adjustmentType: "WRITE_OFF" } });
      if (!existingRefundNote) {
        await prisma.duesAdjustment.create({ data: { organizationId: org.id, memberId: morganHousehold.orgMemberId, duesChargeId: morganCharge.id, adjustmentType: "WRITE_OFF", amount: 25, reason: "Refund issued to family — duplicate payment (fictional)" } });
      }
    }
  }

  // Pending-review scenario — the Osei household has self-reported a payment awaiting officer approval.
  if (oseiHousehold.orgMemberId) {
    const oseiCharge = await prisma.duesCharge.findFirst({ where: { organizationId: org.id, memberId: oseiHousehold.orgMemberId } });
    if (oseiCharge) {
      const existingReport = await prisma.paymentReport.findFirst({ where: { organizationId: org.id, duesChargeId: oseiCharge.id } });
      if (!existingReport) {
        await prisma.paymentReport.create({
          data: { organizationId: org.id, memberId: oseiHousehold.orgMemberId, amount: 25, paymentMethod: "ZELLE", paymentDate: new Date(), category: "MEMBERSHIP_DUES", duesChargeId: oseiCharge.id, status: "pending", note: "Paid via Zelle (fictional) — awaiting officer confirmation" },
        });
      }
    }
  }

  // Prior-year history — the Chen household has a PAID charge from the prior school year.
  if (cheHousehold.orgMemberId) {
    const priorDuesAccount = await findOrCreateDuesAccount(org.id, cheHousehold.orgMemberId);
    const priorPeriodStart = new Date("2025-08-01");
    const priorPeriodEnd = new Date("2026-06-30");
    const priorCharge = await prisma.duesCharge.upsert({
      where: { organizationId_memberId_duesAccountId_periodStart_periodEnd: { organizationId: org.id, memberId: cheHousehold.orgMemberId, duesAccountId: priorDuesAccount.id, periodStart: priorPeriodStart, periodEnd: priorPeriodEnd } },
      update: {},
      create: { organizationId: org.id, memberId: cheHousehold.orgMemberId, duesAccountId: priorDuesAccount.id, amountDue: 20, amountPaid: 20, dueDate: new Date("2025-09-01"), periodStart: priorPeriodStart, periodEnd: priorPeriodEnd, status: "PAID" },
    });
    const existingPriorPayment = await prisma.duesPayment.findFirst({ where: { organizationId: org.id, duesChargeId: priorCharge.id } });
    if (!existingPriorPayment) {
      await prisma.duesPayment.create({ data: { organizationId: org.id, memberId: cheHousehold.orgMemberId, duesChargeId: priorCharge.id, amount: 20, paymentDate: new Date("2025-09-05"), method: "CHECK" } });
    }
  }
  console.log("Waived, refund-adjustment, pending-review, and prior-year dues scenarios created.");

  // Multi-org parent scenario — the same PTA president is also a parent at a second, smaller fictional PTA.
  const riverside = await prisma.organization.upsert({
    where: { slug: "riverside-elementary-pta" },
    update: {},
    create: { slug: "riverside-elementary-pta", name: "Riverside Elementary PTA", organizationType: "PTA", plan: "elite" },
  });
  await prisma.organizationLabFeature.upsert({
    where: { organizationId_featureKey: { organizationId: riverside.id, featureKey: "ptaVertical" } },
    update: { status: "ENABLED" },
    create: { organizationId: riverside.id, featureKey: "ptaVertical", status: "ENABLED", enrollmentSource: "seed" },
  });
  await prisma.ptaProfile.upsert({
    where: { organizationId: riverside.id },
    update: {},
    create: { organizationId: riverside.id, schoolOrPtaName: "Riverside Elementary PTA", designation: "PTA", currentSchoolYear: SCHOOL_YEAR, membershipModel: "HOUSEHOLD", defaultDuesAmountCents: 1500 },
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: riverside.id, userId: president.id } },
    update: {},
    create: { organizationId: riverside.id, userId: president.id, role: "MEMBER", status: "active", joinedAt: new Date() },
  });
  const riversideOrgMember = await prisma.orgMember.upsert({
    where: { organizationId_memberNumber: { organizationId: riverside.id, memberNumber: "The Morgan Household (Riverside)" } },
    update: {},
    create: { organizationId: riverside.id, firstName: "The Morgan Household", lastName: "(PTA Household)", householdName: "The Morgan Household", memberNumber: "The Morgan Household (Riverside)" },
  });
  const riversideHousehold = await prisma.ptaHousehold.upsert({
    where: { organizationId_displayName_schoolYear: { organizationId: riverside.id, displayName: "The Morgan Household", schoolYear: SCHOOL_YEAR } },
    update: {},
    create: { organizationId: riverside.id, displayName: "The Morgan Household", schoolYear: SCHOOL_YEAR, orgMemberId: riversideOrgMember.id },
  });
  await findOrCreateHouseholdAdult(riverside.id, riversideHousehold.id, { name: "Alex Morgan", email: president.email, phone: "555-0101", userId: president.id, relationshipLabel: "Parent" });
  const riversideDuesAccount = await findOrCreateDuesAccount(riverside.id, riversideOrgMember.id);
  await prisma.duesCharge.upsert({
    where: {
      organizationId_memberId_duesAccountId_periodStart_periodEnd: {
        organizationId: riverside.id,
        memberId: riversideOrgMember.id,
        duesAccountId: riversideDuesAccount.id,
        periodStart: new Date(`${SCHOOL_YEAR.slice(0, 4)}-08-01`),
        periodEnd: new Date(`${SCHOOL_YEAR.slice(5)}-06-30`),
      },
    },
    update: {},
    create: { organizationId: riverside.id, memberId: riversideOrgMember.id, duesAccountId: riversideDuesAccount.id, amountDue: 15, dueDate: new Date(`${SCHOOL_YEAR.slice(0, 4)}-09-01`), periodStart: new Date(`${SCHOOL_YEAR.slice(0, 4)}-08-01`), periodEnd: new Date(`${SCHOOL_YEAR.slice(5)}-06-30`) },
  });
  console.log(`Second fictional PTA (${riverside.name}) created — same president user is a parent household there too, with a separate $15 unpaid charge, demonstrating multi-org isolation.`);

  console.log("\nPine Grove School PTA demo seed complete.");

  // ── Second fictional organization: a NON-PTA org, for cross-vertical
  // isolation testing (impersonation, org switching, Labs enrollment) ────────
  // Deliberately NOT enrolled in ptaVertical — an impersonated session
  // dropped into this organization must never show any PTA data or nav.
  const riverdale = await prisma.organization.upsert({
    where: { slug: "riverdale-community-association" },
    update: {},
    create: {
      slug: "riverdale-community-association",
      name: "Riverdale Community Association",
      organizationType: "Community Association",
      plan: "elite",
      email: "hello@riverdaleassociation.example",
      website: "https://riverdaleassociation.example",
    },
  });
  console.log(`\nOrganization: ${riverdale.name} (${riverdale.id}) — NOT enrolled in any Labs feature.`);

  const riverdaleDirector = await prisma.user.upsert({
    where: { email: "director@riverdaleassociation.example" },
    update: {},
    create: { email: "director@riverdaleassociation.example", displayName: "Morgan Ellis (Director)", passwordHash: await hash("PtaDemo!Change1"), emailVerified: true },
  });
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: riverdale.id, userId: riverdaleDirector.id } },
    update: { role: "ORG_OWNER" },
    create: { organizationId: riverdale.id, userId: riverdaleDirector.id, role: "ORG_OWNER", status: "active", joinedAt: new Date() },
  });

  // Alex Morgan (Pine Grove's President) is ALSO a member here, with a
  // different role — the "one fictional user belonging to both
  // organizations" the demo brief asks for, reusing an already-established
  // fictional identity rather than inventing a disconnected one.
  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: riverdale.id, userId: president.id } },
    update: { role: "STAFF" },
    create: { organizationId: riverdale.id, userId: president.id, role: "STAFF", status: "active", joinedAt: new Date() },
  });
  console.log("Riverdale members created (a director, plus Pine Grove's President as a cross-organization STAFF member).");

  const riverdaleMember = await prisma.orgMember.upsert({
    where: { organizationId_memberNumber: { organizationId: riverdale.id, memberNumber: "RCA-0001" } },
    update: {},
    create: { organizationId: riverdale.id, firstName: "Taylor", lastName: "Brooks (fictional)", email: "taylor.brooks@riverdaleassociation.example", memberNumber: "RCA-0001" },
  });
  const riverdaleDuesAccount = await prisma.duesAccount.upsert({
    where: { id: "seed-riverdale-dues-account" },
    update: {},
    create: { id: "seed-riverdale-dues-account", organizationId: riverdale.id, memberId: riverdaleMember.id, name: "Annual Membership Dues", frequency: "annual", amountDefault: 60 },
  });
  await prisma.duesCharge.upsert({
    where: { id: "seed-riverdale-dues-charge" },
    update: {},
    create: {
      id: "seed-riverdale-dues-charge",
      organizationId: riverdale.id,
      memberId: riverdaleMember.id,
      duesAccountId: riverdaleDuesAccount.id,
      amountDue: 60,
      dueDate: new Date(`${SCHOOL_YEAR.slice(0, 4)}-10-01`),
      periodStart: new Date(`${SCHOOL_YEAR.slice(0, 4)}-01-01`),
      periodEnd: new Date(`${SCHOOL_YEAR.slice(0, 4)}-12-31`),
    },
  });

  await prisma.event.upsert({
    where: { id: "seed-riverdale-annual-meeting" },
    update: {},
    create: { id: "seed-riverdale-annual-meeting", organizationId: riverdale.id, title: "Riverdale Annual Meeting", description: "Annual community meeting (fictional).", startAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), status: "upcoming" },
  });

  await prisma.communicationCampaign.upsert({
    where: { id: "seed-riverdale-newsletter" },
    update: {},
    create: {
      id: "seed-riverdale-newsletter",
      organizationId: riverdale.id,
      createdByUserId: riverdaleDirector.id,
      communicationType: "ANNOUNCEMENT",
      channel: "INTERNAL_LOG_ONLY",
      title: "Riverdale Quarterly Newsletter",
      subject: "Riverdale Quarterly Newsletter",
      body: "Welcome to this quarter's community newsletter (fictional demo announcement).",
      status: "SENT",
      sentAt: new Date(),
    },
  });
  console.log("Riverdale demo data created (a member, dues charge, event, and announcement) — a plain, non-PTA org for cross-vertical isolation testing.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
