-- AlterTable
ALTER TABLE "MemberIntakeSubmission" ADD COLUMN     "candidateMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
