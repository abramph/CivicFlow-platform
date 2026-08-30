-- AlterEnum
BEGIN;
CREATE TYPE "PtaVolunteerRateLockTiming_new" AS ENUM ('ELECTION', 'CHECKOUT');
ALTER TABLE "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" DROP DEFAULT;
ALTER TABLE "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" TYPE "PtaVolunteerRateLockTiming_new" USING ("lockTiming"::text::"PtaVolunteerRateLockTiming_new");
ALTER TYPE "PtaVolunteerRateLockTiming" RENAME TO "PtaVolunteerRateLockTiming_old";
ALTER TYPE "PtaVolunteerRateLockTiming_new" RENAME TO "PtaVolunteerRateLockTiming";
DROP TYPE "PtaVolunteerRateLockTiming_old";
ALTER TABLE "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" SET DEFAULT 'CHECKOUT';
COMMIT;

