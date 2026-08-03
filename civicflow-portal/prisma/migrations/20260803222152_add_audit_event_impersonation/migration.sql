-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "impersonatedByEmail" TEXT,
ADD COLUMN     "impersonatedByUserId" TEXT;
