-- CreateEnum
CREATE TYPE "MemberTimelineEventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'CATEGORY_CHANGED', 'DUES_PLAN_CHANGED', 'PAYMENT_RECORDED', 'CONTRIBUTION_RECORDED', 'COMMUNICATION_LOGGED', 'ATTENDANCE_RECORDED', 'NOTE_ADDED', 'MANUAL');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN "gender" TEXT;

-- AlterTable
ALTER TABLE "Expenditure"
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "reference" TEXT,
ADD COLUMN "paymentMethodId" TEXT,
ADD COLUMN "paymentMethod" TEXT,
ADD COLUMN "campaignId" TEXT,
ADD COLUMN "eventId" TEXT,
ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN "meetingId" TEXT;

-- CreateTable
CREATE TABLE "Meeting" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "meetingType" TEXT,
  "meetingDate" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "description" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberTimelineEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "eventType" "MemberTimelineEventType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "oldValue" JSONB,
  "newValue" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MemberTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expenditure_categoryId_idx" ON "Expenditure"("categoryId");
CREATE INDEX "Expenditure_paymentMethodId_idx" ON "Expenditure"("paymentMethodId");
CREATE INDEX "Expenditure_campaignId_idx" ON "Expenditure"("campaignId");
CREATE INDEX "Expenditure_eventId_idx" ON "Expenditure"("eventId");
CREATE INDEX "AttendanceRecord_meetingId_idx" ON "AttendanceRecord"("meetingId");
CREATE INDEX "Meeting_organizationId_idx" ON "Meeting"("organizationId");
CREATE INDEX "Meeting_meetingDate_idx" ON "Meeting"("meetingDate");
CREATE INDEX "Meeting_createdByUserId_idx" ON "Meeting"("createdByUserId");
CREATE INDEX "MemberTimelineEvent_organizationId_idx" ON "MemberTimelineEvent"("organizationId");
CREATE INDEX "MemberTimelineEvent_memberId_idx" ON "MemberTimelineEvent"("memberId");
CREATE INDEX "MemberTimelineEvent_eventType_idx" ON "MemberTimelineEvent"("eventType");
CREATE INDEX "MemberTimelineEvent_occurredAt_idx" ON "MemberTimelineEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethodConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemberTimelineEvent" ADD CONSTRAINT "MemberTimelineEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberTimelineEvent" ADD CONSTRAINT "MemberTimelineEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberTimelineEvent" ADD CONSTRAINT "MemberTimelineEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
