-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "adminSeatOverride" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "adminSeatOverrideExpiresAt" TIMESTAMP(3),
ADD COLUMN     "adminSeatOverrideReason" TEXT,
ADD COLUMN     "adminSeatOverrideSetAt" TIMESTAMP(3),
ADD COLUMN     "adminSeatOverrideSetByUserId" TEXT,
ADD COLUMN     "purchasedAdminSeats" INTEGER NOT NULL DEFAULT 0;
