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
  const householdSeeds = [
    { name: "The Morgan Household", adults: [{ name: "Alex Morgan", email: president.email, phone: "555-0101", userId: president.id, primary: true }], students: [{ name: "Riley M.", grade: 0 }] },
    { name: "The Kim Household", adults: [{ name: "Casey Kim", email: "casey@pinegrovepta.example", phone: "555-0102", primary: true }, { name: "Drew Kim", email: "drew@pinegrovepta.example", phone: "555-0103", primary: false }], students: [{ name: "Avery K.", grade: 1 }, { name: "Quinn K.", grade: 2 }] },
    { name: "The Chen Household", adults: [{ name: "Riley Chen", email: "riley.chen@pinegrovepta.example", phone: "555-0104", primary: true }], students: [{ name: "Skylar C.", grade: 0 }] },
    { name: "The Osei Household", adults: [{ name: "Nia Osei", email: "nia.osei@pinegrovepta.example", phone: "555-0105", primary: true }, { name: "Femi Osei", email: "femi.osei@pinegrovepta.example", phone: "555-0106", primary: false }], students: [{ name: "Amara O.", grade: 1 }] },
    { name: "The Patel Household", adults: [{ name: "Sam Patel", email: "member@pinegrovepta.example", phone: "555-0107", primary: true }], students: [{ name: "Dev P.", grade: 2 }] },
  ] as const;

  const households: Array<{ id: string; adultIds: string[]; studentIds: string[] }> = [];
  let householdIndex = 0;
  for (const seed of householdSeeds) {
    householdIndex += 1;
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

    households.push({ id: household.id, adultIds, studentIds });

    // Dues charge — alternate paid/unpaid across households for a realistic mixed dashboard.
    const duesAccount = await findOrCreateDuesAccount(org.id, orgMember.id);
    const periodStart = new Date(`${SCHOOL_YEAR.slice(0, 4)}-08-01`);
    const periodEnd = new Date(`${SCHOOL_YEAR.slice(5)}-06-30`);
    const charge = await prisma.duesCharge.upsert({
      where: { organizationId_memberId_duesAccountId_periodStart_periodEnd: { organizationId: org.id, memberId: orgMember.id, duesAccountId: duesAccount.id, periodStart, periodEnd } },
      update: {},
      create: { organizationId: org.id, memberId: orgMember.id, duesAccountId: duesAccount.id, amountDue: 25, dueDate: new Date(`${SCHOOL_YEAR.slice(0, 4)}-09-01`), periodStart, periodEnd },
    });

    const shouldBePaid = householdIndex % 2 === 1;
    if (shouldBePaid && charge.status !== "PAID") {
      const existingPayment = await prisma.duesPayment.findFirst({ where: { organizationId: org.id, duesChargeId: charge.id } });
      if (!existingPayment) {
        await prisma.duesPayment.create({ data: { organizationId: org.id, memberId: orgMember.id, duesChargeId: charge.id, amount: 25, paymentDate: new Date(), method: "CREDIT_CARD" } });
      }
      await prisma.duesCharge.update({ where: { id: charge.id }, data: { amountPaid: 25, status: "PAID" } });
    }
  }
  console.log(`${households.length} fictional households created (with adults, students, and a dues cycle).`);

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
  console.log("Committees created (Membership, Fundraising, Family Engagement).");

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
    create: { id: "seed-pta-book-fair-volunteers", organizationId: org.id, eventId: bookFair.id, title: "Book Fair Setup & Cashiering", description: "Help set up tables and staff the register (fictional)." },
  });
  const morningSlot = await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-morning" },
    update: {},
    create: { id: "seed-pta-slot-morning", organizationId: org.id, opportunityId: opportunity.id, label: "Morning shift (9am-12pm)", capacity: 3 },
  });
  await prisma.ptaVolunteerSlot.upsert({
    where: { id: "seed-pta-slot-afternoon" },
    update: {},
    create: { id: "seed-pta-slot-afternoon", organizationId: org.id, opportunityId: opportunity.id, label: "Afternoon shift (12pm-3pm)", capacity: 2 },
  });

  const firstAdult = households[0]?.adultIds[0];
  if (firstAdult) {
    const existingSignup = await prisma.ptaVolunteerSignup.findUnique({ where: { slotId_householdAdultId: { slotId: morningSlot.id, householdAdultId: firstAdult } } });
    if (!existingSignup) {
      await prisma.ptaVolunteerSignup.create({ data: { organizationId: org.id, slotId: morningSlot.id, householdAdultId: firstAdult, status: "SIGNED_UP" } });
      await prisma.ptaVolunteerSlot.update({ where: { id: morningSlot.id }, data: { claimedCount: 1 } });
    }
  }
  console.log("Volunteer opportunity created with slots (one claimed).");

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
  console.log("Fictional announcement created.");

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

  console.log("\nPine Grove School PTA demo seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
