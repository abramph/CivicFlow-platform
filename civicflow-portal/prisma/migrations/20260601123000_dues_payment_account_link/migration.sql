ALTER TABLE "DuesPayment" ADD COLUMN "duesAccountId" TEXT;

CREATE INDEX "DuesPayment_duesAccountId_idx" ON "DuesPayment"("duesAccountId");

ALTER TABLE "DuesPayment" ADD CONSTRAINT "DuesPayment_duesAccountId_fkey"
  FOREIGN KEY ("duesAccountId") REFERENCES "DuesAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
