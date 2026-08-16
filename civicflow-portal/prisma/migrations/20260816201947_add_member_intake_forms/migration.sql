-- CreateEnum
CREATE TYPE "MemberIntakeFormPurpose" AS ENUM ('NEW_MEMBER', 'PROFILE_UPDATE', 'NEW_OR_UPDATE', 'CONTACT_UPDATE', 'HOUSEHOLD_UPDATE', 'VISITOR_CONNECT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemberIntakeFormStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MemberIntakeDuplicateMode" AS ENUM ('REVIEW', 'AUTO_LINK_CONFIDENT');

-- CreateEnum
CREATE TYPE "MemberIntakeFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'ADDRESS', 'DATE', 'SELECT', 'MULTISELECT', 'CHECKBOX', 'RADIO', 'BOOLEAN', 'NUMBER');

-- CreateEnum
CREATE TYPE "MemberIntakeTargetEntity" AS ENUM ('MEMBER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MemberIntakeFieldSensitivity" AS ENUM ('LOW', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "MemberIntakeSubmissionStatus" AS ENUM ('SUBMITTED', 'MATCH_PENDING', 'VERIFICATION_REQUIRED', 'REVIEW_REQUIRED', 'APPROVED', 'APPLIED', 'REJECTED', 'DUPLICATE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemberIntakeVerificationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "MemberIntakeVerificationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateTable
CREATE TABLE "MemberIntakeForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "purpose" "MemberIntakeFormPurpose" NOT NULL,
    "status" "MemberIntakeFormStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "successMessage" TEXT,
    "requireVerificationForExisting" BOOLEAN NOT NULL DEFAULT true,
    "autoCreateNewMember" BOOLEAN NOT NULL DEFAULT false,
    "autoApplySafeUpdates" BOOLEAN NOT NULL DEFAULT false,
    "requireReviewForSensitiveUpdates" BOOLEAN NOT NULL DEFAULT true,
    "duplicateHandlingMode" "MemberIntakeDuplicateMode" NOT NULL DEFAULT 'REVIEW',
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MemberIntakeForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberIntakeFormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "MemberIntakeFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "placeholder" TEXT,
    "helpText" TEXT,
    "options" TEXT[],
    "targetEntity" "MemberIntakeTargetEntity" NOT NULL,
    "targetField" TEXT,
    "sensitivity" "MemberIntakeFieldSensitivity" NOT NULL DEFAULT 'LOW',
    "isCustomField" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberIntakeFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberIntakeFormSource" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "MemberIntakeFormSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberIntakeSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "MemberIntakeSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedIpHash" TEXT,
    "userAgent" TEXT,
    "fieldValues" JSONB NOT NULL,
    "matchedMemberId" TEXT,
    "matchConfidence" INTEGER,
    "matchMethod" TEXT,
    "verificationStatus" "MemberIntakeVerificationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdMemberId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberIntakeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberIntakeVerificationToken" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "channel" "MemberIntakeVerificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberIntakeVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberIntakeForm_publicToken_key" ON "MemberIntakeForm"("publicToken");

-- CreateIndex
CREATE INDEX "MemberIntakeForm_organizationId_idx" ON "MemberIntakeForm"("organizationId");

-- CreateIndex
CREATE INDEX "MemberIntakeForm_status_idx" ON "MemberIntakeForm"("status");

-- CreateIndex
CREATE INDEX "MemberIntakeFormField_formId_idx" ON "MemberIntakeFormField"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberIntakeFormField_formId_fieldKey_key" ON "MemberIntakeFormField"("formId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "MemberIntakeFormSource_token_key" ON "MemberIntakeFormSource"("token");

-- CreateIndex
CREATE INDEX "MemberIntakeFormSource_formId_idx" ON "MemberIntakeFormSource"("formId");

-- CreateIndex
CREATE INDEX "MemberIntakeSubmission_organizationId_idx" ON "MemberIntakeSubmission"("organizationId");

-- CreateIndex
CREATE INDEX "MemberIntakeSubmission_formId_idx" ON "MemberIntakeSubmission"("formId");

-- CreateIndex
CREATE INDEX "MemberIntakeSubmission_sourceId_idx" ON "MemberIntakeSubmission"("sourceId");

-- CreateIndex
CREATE INDEX "MemberIntakeSubmission_status_idx" ON "MemberIntakeSubmission"("status");

-- CreateIndex
CREATE INDEX "MemberIntakeSubmission_matchedMemberId_idx" ON "MemberIntakeSubmission"("matchedMemberId");

-- CreateIndex
CREATE INDEX "MemberIntakeVerificationToken_submissionId_idx" ON "MemberIntakeVerificationToken"("submissionId");

-- CreateIndex
CREATE INDEX "MemberIntakeVerificationToken_expiresAt_idx" ON "MemberIntakeVerificationToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "MemberIntakeForm" ADD CONSTRAINT "MemberIntakeForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeForm" ADD CONSTRAINT "MemberIntakeForm_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeFormField" ADD CONSTRAINT "MemberIntakeFormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MemberIntakeForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeFormSource" ADD CONSTRAINT "MemberIntakeFormSource_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MemberIntakeForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeSubmission" ADD CONSTRAINT "MemberIntakeSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeSubmission" ADD CONSTRAINT "MemberIntakeSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "MemberIntakeForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeSubmission" ADD CONSTRAINT "MemberIntakeSubmission_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MemberIntakeFormSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeSubmission" ADD CONSTRAINT "MemberIntakeSubmission_matchedMemberId_fkey" FOREIGN KEY ("matchedMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeSubmission" ADD CONSTRAINT "MemberIntakeSubmission_createdMemberId_fkey" FOREIGN KEY ("createdMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeSubmission" ADD CONSTRAINT "MemberIntakeSubmission_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberIntakeVerificationToken" ADD CONSTRAINT "MemberIntakeVerificationToken_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "MemberIntakeSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
