-- CreateTable
CREATE TABLE "UnionCaseDeadlineReminderLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "orgMemberId" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnionCaseDeadlineReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnionCaseDeadlineReminderLog_organizationId_idx" ON "UnionCaseDeadlineReminderLog"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UnionCaseDeadlineReminderLog_deadlineId_orgMemberId_reminde_key" ON "UnionCaseDeadlineReminderLog"("deadlineId", "orgMemberId", "reminderType", "dueOffsetDays");

-- AddForeignKey
ALTER TABLE "UnionCaseDeadlineReminderLog" ADD CONSTRAINT "UnionCaseDeadlineReminderLog_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "UnionCaseDeadline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnionCaseDeadlineReminderLog" ADD CONSTRAINT "UnionCaseDeadlineReminderLog_orgMemberId_fkey" FOREIGN KEY ("orgMemberId") REFERENCES "OrgMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
