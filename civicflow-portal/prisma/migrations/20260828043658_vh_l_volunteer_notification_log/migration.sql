-- CreateEnum
CREATE TYPE "PtaVolunteerNotificationType" AS ENUM ('DEADLINE_REMINDER', 'ASSESSMENT_POSTED', 'RATE_CHANGE_UPCOMING');

-- CreateTable
CREATE TABLE "PtaVolunteerNotificationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "notificationType" "PtaVolunteerNotificationType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "pricingWindowId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaVolunteerNotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerNotificationLog_organizationId_requirementPerio_idx" ON "PtaVolunteerNotificationLog"("organizationId", "requirementPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerNotificationLog_organizationId_notificationType_key" ON "PtaVolunteerNotificationLog"("organizationId", "notificationType", "householdId", "sourceId");

-- AddForeignKey
ALTER TABLE "PtaVolunteerNotificationLog" ADD CONSTRAINT "PtaVolunteerNotificationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerNotificationLog" ADD CONSTRAINT "PtaVolunteerNotificationLog_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerNotificationLog" ADD CONSTRAINT "PtaVolunteerNotificationLog_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
