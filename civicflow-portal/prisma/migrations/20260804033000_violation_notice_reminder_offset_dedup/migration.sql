-- AlterTable
ALTER TABLE "ViolationNotice" ADD COLUMN "dueOffsetDays" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "ViolationNotice_violationId_noticeType_dueOffsetDays_key" ON "ViolationNotice"("violationId", "noticeType", "dueOffsetDays");
