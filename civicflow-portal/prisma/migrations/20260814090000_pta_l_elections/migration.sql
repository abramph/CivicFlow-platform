-- CreateEnum
CREATE TYPE "PtaElectionStatus" AS ENUM ('DRAFT', 'NOMINATIONS', 'VOTING', 'CLOSED', 'CERTIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PtaElectionMode" AS ENUM ('OPEN', 'SECRET_BALLOT');

-- AlterTable
ALTER TABLE "PtaProfile" ADD COLUMN     "electionsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PtaElection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mode" "PtaElectionMode" NOT NULL DEFAULT 'SECRET_BALLOT',
    "status" "PtaElectionStatus" NOT NULL DEFAULT 'DRAFT',
    "votingOpensAt" TIMESTAMP(3),
    "votingClosesAt" TIMESTAMP(3),
    "eligibilityNote" TEXT,
    "createdByUserId" TEXT,
    "certifiedAt" TIMESTAMP(3),
    "certifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaElection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaElectionContest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "positionId" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaElectionContest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaElectionCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "statement" TEXT,
    "householdAdultId" TEXT,
    "isWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaElectionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaElectionVoter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "householdAdultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasVoted" BOOLEAN NOT NULL DEFAULT false,
    "votedAt" TIMESTAMP(3),

    CONSTRAINT "PtaElectionVoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaBallotChoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "openVoterName" TEXT,

    CONSTRAINT "PtaBallotChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaElection_organizationId_idx" ON "PtaElection"("organizationId");

-- CreateIndex
CREATE INDEX "PtaElection_organizationId_status_idx" ON "PtaElection"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaElectionContest_organizationId_idx" ON "PtaElectionContest"("organizationId");

-- CreateIndex
CREATE INDEX "PtaElectionContest_electionId_idx" ON "PtaElectionContest"("electionId");

-- CreateIndex
CREATE INDEX "PtaElectionCandidate_organizationId_idx" ON "PtaElectionCandidate"("organizationId");

-- CreateIndex
CREATE INDEX "PtaElectionCandidate_contestId_idx" ON "PtaElectionCandidate"("contestId");

-- CreateIndex
CREATE INDEX "PtaElectionVoter_organizationId_idx" ON "PtaElectionVoter"("organizationId");

-- CreateIndex
CREATE INDEX "PtaElectionVoter_electionId_idx" ON "PtaElectionVoter"("electionId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaElectionVoter_electionId_householdAdultId_key" ON "PtaElectionVoter"("electionId", "householdAdultId");

-- CreateIndex
CREATE INDEX "PtaBallotChoice_organizationId_idx" ON "PtaBallotChoice"("organizationId");

-- CreateIndex
CREATE INDEX "PtaBallotChoice_electionId_idx" ON "PtaBallotChoice"("electionId");

-- CreateIndex
CREATE INDEX "PtaBallotChoice_contestId_candidateId_idx" ON "PtaBallotChoice"("contestId", "candidateId");

-- AddForeignKey
ALTER TABLE "PtaElection" ADD CONSTRAINT "PtaElection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElection" ADD CONSTRAINT "PtaElection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElection" ADD CONSTRAINT "PtaElection_certifiedByUserId_fkey" FOREIGN KEY ("certifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionContest" ADD CONSTRAINT "PtaElectionContest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionContest" ADD CONSTRAINT "PtaElectionContest_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "PtaElection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionContest" ADD CONSTRAINT "PtaElectionContest_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PtaBoardPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionCandidate" ADD CONSTRAINT "PtaElectionCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionCandidate" ADD CONSTRAINT "PtaElectionCandidate_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "PtaElectionContest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionCandidate" ADD CONSTRAINT "PtaElectionCandidate_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionVoter" ADD CONSTRAINT "PtaElectionVoter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionVoter" ADD CONSTRAINT "PtaElectionVoter_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "PtaElection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaElectionVoter" ADD CONSTRAINT "PtaElectionVoter_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBallotChoice" ADD CONSTRAINT "PtaBallotChoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBallotChoice" ADD CONSTRAINT "PtaBallotChoice_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "PtaElection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBallotChoice" ADD CONSTRAINT "PtaBallotChoice_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "PtaElectionContest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBallotChoice" ADD CONSTRAINT "PtaBallotChoice_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PtaElectionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

