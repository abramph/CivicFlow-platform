-- CreateEnum
CREATE TYPE "PtaDesignation" AS ENUM ('PTA', 'PTO');

-- CreateEnum
CREATE TYPE "PtaMembershipModel" AS ENUM ('INDIVIDUAL', 'HOUSEHOLD', 'FAMILY');

-- CreateEnum
CREATE TYPE "PtaHouseholdStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');

-- CreateEnum
CREATE TYPE "PtaBackgroundCheckStatus" AS ENUM ('NOT_REQUIRED', 'EXTERNAL_VERIFICATION_PENDING', 'EXTERNALLY_VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PtaStudentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PtaEnrollmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PtaVolunteerOpportunityStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PtaVolunteerSignupStatus" AS ENUM ('SIGNED_UP', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PtaRsvpStatus" AS ENUM ('GOING', 'NOT_GOING', 'MAYBE');

-- CreateTable
CREATE TABLE "PtaProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolOrPtaName" TEXT NOT NULL,
    "designation" "PtaDesignation" NOT NULL DEFAULT 'PTA',
    "currentSchoolYear" TEXT NOT NULL,
    "schoolAddress" TEXT,
    "schoolWebsite" TEXT,
    "principalName" TEXT,
    "contactEmail" TEXT,
    "membershipModel" "PtaMembershipModel" NOT NULL DEFAULT 'HOUSEHOLD',
    "defaultDuesAmountCents" INTEGER,
    "gradesServed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaHousehold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "PtaHouseholdStatus" NOT NULL DEFAULT 'ACTIVE',
    "schoolYear" TEXT NOT NULL,
    "orgMemberId" TEXT,
    "primaryContactAdultId" TEXT,
    "secondaryContactAdultId" TEXT,
    "volunteerInterests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaHousehold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaHouseholdAdult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "relationshipLabel" TEXT,
    "backgroundCheckStatus" "PtaBackgroundCheckStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaHouseholdAdult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaStudent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "PtaStudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaGrade" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaTeacher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaClassroom" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "teacherId" TEXT,
    "name" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaClassroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaStudentEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "status" "PtaEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaStudentEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerOpportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "signupDeadline" TIMESTAMP(3),
    "supplyRequest" TEXT,
    "status" "PtaVolunteerOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerSlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "label" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerSignup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "householdAdultId" TEXT NOT NULL,
    "status" "PtaVolunteerSignupStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "hoursLogged" DOUBLE PRECISION,
    "signedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaCommittee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "chairAdultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaCommittee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaCommitteeMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "householdAdultId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaCommitteeMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaEventRsvp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "attendeeCount" INTEGER NOT NULL DEFAULT 1,
    "status" "PtaRsvpStatus" NOT NULL DEFAULT 'GOING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaEventRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PtaProfile_organizationId_key" ON "PtaProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaHousehold_orgMemberId_key" ON "PtaHousehold"("orgMemberId");

-- CreateIndex
CREATE INDEX "PtaHousehold_organizationId_idx" ON "PtaHousehold"("organizationId");

-- CreateIndex
CREATE INDEX "PtaHousehold_organizationId_status_idx" ON "PtaHousehold"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaHousehold_organizationId_schoolYear_idx" ON "PtaHousehold"("organizationId", "schoolYear");

-- CreateIndex
CREATE UNIQUE INDEX "PtaHousehold_organizationId_displayName_schoolYear_key" ON "PtaHousehold"("organizationId", "displayName", "schoolYear");

-- CreateIndex
CREATE INDEX "PtaHouseholdAdult_organizationId_idx" ON "PtaHouseholdAdult"("organizationId");

-- CreateIndex
CREATE INDEX "PtaHouseholdAdult_householdId_idx" ON "PtaHouseholdAdult"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaHouseholdAdult_organizationId_userId_key" ON "PtaHouseholdAdult"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "PtaStudent_organizationId_idx" ON "PtaStudent"("organizationId");

-- CreateIndex
CREATE INDEX "PtaStudent_householdId_idx" ON "PtaStudent"("householdId");

-- CreateIndex
CREATE INDEX "PtaGrade_organizationId_idx" ON "PtaGrade"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaGrade_organizationId_name_key" ON "PtaGrade"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PtaTeacher_organizationId_idx" ON "PtaTeacher"("organizationId");

-- CreateIndex
CREATE INDEX "PtaClassroom_organizationId_idx" ON "PtaClassroom"("organizationId");

-- CreateIndex
CREATE INDEX "PtaClassroom_organizationId_schoolYear_idx" ON "PtaClassroom"("organizationId", "schoolYear");

-- CreateIndex
CREATE UNIQUE INDEX "PtaClassroom_organizationId_gradeId_name_schoolYear_key" ON "PtaClassroom"("organizationId", "gradeId", "name", "schoolYear");

-- CreateIndex
CREATE INDEX "PtaStudentEnrollment_organizationId_idx" ON "PtaStudentEnrollment"("organizationId");

-- CreateIndex
CREATE INDEX "PtaStudentEnrollment_classroomId_idx" ON "PtaStudentEnrollment"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaStudentEnrollment_studentId_schoolYear_key" ON "PtaStudentEnrollment"("studentId", "schoolYear");

-- CreateIndex
CREATE INDEX "PtaVolunteerOpportunity_organizationId_idx" ON "PtaVolunteerOpportunity"("organizationId");

-- CreateIndex
CREATE INDEX "PtaVolunteerOpportunity_organizationId_status_idx" ON "PtaVolunteerOpportunity"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaVolunteerSlot_organizationId_idx" ON "PtaVolunteerSlot"("organizationId");

-- CreateIndex
CREATE INDEX "PtaVolunteerSlot_opportunityId_idx" ON "PtaVolunteerSlot"("opportunityId");

-- CreateIndex
CREATE INDEX "PtaVolunteerSignup_organizationId_idx" ON "PtaVolunteerSignup"("organizationId");

-- CreateIndex
CREATE INDEX "PtaVolunteerSignup_slotId_idx" ON "PtaVolunteerSignup"("slotId");

-- CreateIndex
CREATE INDEX "PtaVolunteerSignup_householdAdultId_idx" ON "PtaVolunteerSignup"("householdAdultId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerSignup_slotId_householdAdultId_key" ON "PtaVolunteerSignup"("slotId", "householdAdultId");

-- CreateIndex
CREATE INDEX "PtaCommittee_organizationId_idx" ON "PtaCommittee"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaCommittee_organizationId_name_key" ON "PtaCommittee"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PtaCommitteeMember_organizationId_idx" ON "PtaCommitteeMember"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaCommitteeMember_committeeId_householdAdultId_key" ON "PtaCommitteeMember"("committeeId", "householdAdultId");

-- CreateIndex
CREATE INDEX "PtaEventRsvp_organizationId_idx" ON "PtaEventRsvp"("organizationId");

-- CreateIndex
CREATE INDEX "PtaEventRsvp_eventId_idx" ON "PtaEventRsvp"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaEventRsvp_eventId_householdId_key" ON "PtaEventRsvp"("eventId", "householdId");

-- AddForeignKey
ALTER TABLE "PtaProfile" ADD CONSTRAINT "PtaProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHousehold" ADD CONSTRAINT "PtaHousehold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHousehold" ADD CONSTRAINT "PtaHousehold_orgMemberId_fkey" FOREIGN KEY ("orgMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHousehold" ADD CONSTRAINT "PtaHousehold_primaryContactAdultId_fkey" FOREIGN KEY ("primaryContactAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHousehold" ADD CONSTRAINT "PtaHousehold_secondaryContactAdultId_fkey" FOREIGN KEY ("secondaryContactAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHouseholdAdult" ADD CONSTRAINT "PtaHouseholdAdult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHouseholdAdult" ADD CONSTRAINT "PtaHouseholdAdult_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHouseholdAdult" ADD CONSTRAINT "PtaHouseholdAdult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudent" ADD CONSTRAINT "PtaStudent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudent" ADD CONSTRAINT "PtaStudent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaGrade" ADD CONSTRAINT "PtaGrade_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaTeacher" ADD CONSTRAINT "PtaTeacher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaClassroom" ADD CONSTRAINT "PtaClassroom_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaClassroom" ADD CONSTRAINT "PtaClassroom_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "PtaGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaClassroom" ADD CONSTRAINT "PtaClassroom_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "PtaTeacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentEnrollment" ADD CONSTRAINT "PtaStudentEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentEnrollment" ADD CONSTRAINT "PtaStudentEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "PtaStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentEnrollment" ADD CONSTRAINT "PtaStudentEnrollment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "PtaClassroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerOpportunity" ADD CONSTRAINT "PtaVolunteerOpportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerOpportunity" ADD CONSTRAINT "PtaVolunteerOpportunity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerSlot" ADD CONSTRAINT "PtaVolunteerSlot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerSlot" ADD CONSTRAINT "PtaVolunteerSlot_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "PtaVolunteerOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerSignup" ADD CONSTRAINT "PtaVolunteerSignup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerSignup" ADD CONSTRAINT "PtaVolunteerSignup_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PtaVolunteerSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerSignup" ADD CONSTRAINT "PtaVolunteerSignup_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaCommittee" ADD CONSTRAINT "PtaCommittee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaCommittee" ADD CONSTRAINT "PtaCommittee_chairAdultId_fkey" FOREIGN KEY ("chairAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaCommitteeMember" ADD CONSTRAINT "PtaCommitteeMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaCommitteeMember" ADD CONSTRAINT "PtaCommitteeMember_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "PtaCommittee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaCommitteeMember" ADD CONSTRAINT "PtaCommitteeMember_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaEventRsvp" ADD CONSTRAINT "PtaEventRsvp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaEventRsvp" ADD CONSTRAINT "PtaEventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaEventRsvp" ADD CONSTRAINT "PtaEventRsvp_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
