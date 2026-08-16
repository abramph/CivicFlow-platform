-- UNION-WEB-DASH: presentation-only signal for how an organization's
-- members actually pay dues (most relevant to Union employer payroll
-- checkoff) -- never a payroll integration, see schema.prisma's doc
-- comment on DuesCollectionMethod.
CREATE TYPE "DuesCollectionMethod" AS ENUM ('PAYROLL_DEDUCTION', 'UNESTRA_DIRECT', 'EXTERNAL', 'MIXED', 'NONE');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN "duesCollectionMethod" "DuesCollectionMethod";
