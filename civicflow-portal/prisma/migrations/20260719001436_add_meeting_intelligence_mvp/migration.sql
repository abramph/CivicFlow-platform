-- CreateEnum
CREATE TYPE "MeetingIntelligenceStatus" AS ENUM ('CREATED', 'UPLOAD_PENDING', 'UPLOADED', 'QUEUED', 'SUBMITTED_TO_PROVIDER', 'TRANSCRIBING', 'TRANSCRIBED', 'GENERATING_MINUTES', 'DRAFT_READY', 'IN_REVIEW', 'APPROVED', 'FAILED', 'CANCELLED', 'DELETED');

-- CreateEnum
CREATE TYPE "MeetingMinutesDraftStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "MeetingIntelligenceJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "status" "MeetingIntelligenceStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL,
    "providerJobId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "audioDurationSeconds" INTEGER,
    "storageObjectKey" TEXT,
    "transcriptObjectKey" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "consentConfirmedAt" TIMESTAMP(3),
    "consentConfirmedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "transcribedAt" TIMESTAMP(3),
    "minutesGeneratedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "recordingDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingIntelligenceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTranscript" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "language" TEXT,
    "speakerCount" INTEGER,
    "durationSeconds" INTEGER,
    "content" TEXT NOT NULL,
    "segmentsJson" JSONB NOT NULL,
    "speakerLabelMapJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMinutesDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "MeetingMinutesDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedContentJson" JSONB NOT NULL,
    "editableContentJson" JSONB NOT NULL,
    "generatedByProvider" TEXT,
    "generatedAt" TIMESTAMP(3),
    "lastEditedByUserId" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMinutesDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingIntelligenceJob_organizationId_idx" ON "MeetingIntelligenceJob"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingIntelligenceJob_meetingId_idx" ON "MeetingIntelligenceJob"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingIntelligenceJob_status_idx" ON "MeetingIntelligenceJob"("status");

-- CreateIndex
CREATE INDEX "MeetingIntelligenceJob_organizationId_status_idx" ON "MeetingIntelligenceJob"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTranscript_jobId_key" ON "MeetingTranscript"("jobId");

-- CreateIndex
CREATE INDEX "MeetingTranscript_organizationId_idx" ON "MeetingTranscript"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingTranscript_meetingId_idx" ON "MeetingTranscript"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingMinutesDraft_organizationId_idx" ON "MeetingMinutesDraft"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingMinutesDraft_meetingId_idx" ON "MeetingMinutesDraft"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingMinutesDraft_jobId_version_idx" ON "MeetingMinutesDraft"("jobId", "version");

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceJob" ADD CONSTRAINT "MeetingIntelligenceJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceJob" ADD CONSTRAINT "MeetingIntelligenceJob_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceJob" ADD CONSTRAINT "MeetingIntelligenceJob_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingIntelligenceJob" ADD CONSTRAINT "MeetingIntelligenceJob_consentConfirmedByUserId_fkey" FOREIGN KEY ("consentConfirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTranscript" ADD CONSTRAINT "MeetingTranscript_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTranscript" ADD CONSTRAINT "MeetingTranscript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTranscript" ADD CONSTRAINT "MeetingTranscript_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MeetingIntelligenceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MeetingIntelligenceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_lastEditedByUserId_fkey" FOREIGN KEY ("lastEditedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesDraft" ADD CONSTRAINT "MeetingMinutesDraft_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
