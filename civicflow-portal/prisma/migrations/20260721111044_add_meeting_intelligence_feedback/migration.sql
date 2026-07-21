-- CreateTable
CREATE TABLE "MeetingIntelligenceFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "overallRating" INTEGER NOT NULL,
    "transcriptionQualityRating" INTEGER,
    "speakerLabelQualityRating" INTEGER,
    "minutesAccuracyRating" INTEGER,
    "timeSavedMinutes" INTEGER,
    "correctionsRequired" BOOLEAN,
    "issueCategory" TEXT,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingIntelligenceFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingIntelligenceFeedback_organizationId_idx" ON "MeetingIntelligenceFeedback"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingIntelligenceFeedback_jobId_idx" ON "MeetingIntelligenceFeedback"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingIntelligenceFeedback_jobId_submittedByUserId_key" ON "MeetingIntelligenceFeedback"("jobId", "submittedByUserId");

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceFeedback" ADD CONSTRAINT "MeetingIntelligenceFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceFeedback" ADD CONSTRAINT "MeetingIntelligenceFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MeetingIntelligenceJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceFeedback" ADD CONSTRAINT "MeetingIntelligenceFeedback_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
