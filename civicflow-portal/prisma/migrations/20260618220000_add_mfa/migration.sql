-- AlterTable
ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaBackupCodes" TEXT[] NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "MfaChallengeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaChallengeToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfaChallengeToken_token_key" ON "MfaChallengeToken"("token");
CREATE INDEX "MfaChallengeToken_token_idx" ON "MfaChallengeToken"("token");
CREATE INDEX "MfaChallengeToken_userId_idx" ON "MfaChallengeToken"("userId");

-- AddForeignKey
ALTER TABLE "MfaChallengeToken" ADD CONSTRAINT "MfaChallengeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
