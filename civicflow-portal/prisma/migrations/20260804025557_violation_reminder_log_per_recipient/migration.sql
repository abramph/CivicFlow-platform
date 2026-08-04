-- CreateTable
CREATE TABLE "ViolationReminderLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "violationId" TEXT NOT NULL,
    "orgMemberId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViolationReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViolationReminderLog_organizationId_idx" ON "ViolationReminderLog"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ViolationReminderLog_violationId_orgMemberId_reminderType_d_key" ON "ViolationReminderLog"("violationId", "orgMemberId", "reminderType", "dueOffsetDays");

-- AddForeignKey
ALTER TABLE "ViolationReminderLog" ADD CONSTRAINT "ViolationReminderLog_violationId_fkey" FOREIGN KEY ("violationId") REFERENCES "Violation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViolationReminderLog" ADD CONSTRAINT "ViolationReminderLog_orgMemberId_fkey" FOREIGN KEY ("orgMemberId") REFERENCES "OrgMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
