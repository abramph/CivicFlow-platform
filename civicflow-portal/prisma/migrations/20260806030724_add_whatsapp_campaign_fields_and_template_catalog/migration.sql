-- AlterTable
ALTER TABLE "CommunicationCampaign" ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappTemplateKey" TEXT,
ADD COLUMN     "whatsappTemplateVariables" JSONB;

-- AlterTable
ALTER TABLE "CommunicationRecipient" ADD COLUMN     "whatsappDeliveryStatus" "CommunicationDeliveryStatus",
ADD COLUMN     "whatsappError" TEXT,
ADD COLUMN     "whatsappSentAt" TIMESTAMP(3);

-- Seed the initial WhatsApp template catalog. Every row ships DRAFT/inactive
-- — no real Twilio Content SID exists until the account owner actually
-- submits these to Meta for approval (a manual, external step outside any
-- PR). Runs as a normal migration (via `prisma migrate deploy` on every
-- deploy) rather than a seed script, since dev/demo seed scripts in this
-- repo are guarded to never run against production, and this catalog data
-- is meant to exist in production too. ON CONFLICT makes it safe to re-run.
INSERT INTO "WhatsAppTemplate" (id, key, language, category, version, "approvalStatus", "variablesSchema", "permittedWorkflows", active, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'organization_welcome', 'en', 'UTILITY', 1, 'DRAFT',
   '[{"name":"organizationName","required":true},{"name":"memberName","required":true}]',
   ARRAY['member_onboarding'], false, now(), now()),
  (gen_random_uuid()::text, 'meeting_reminder', 'en', 'UTILITY', 1, 'DRAFT',
   '[{"name":"organizationName","required":true},{"name":"meetingDate","required":true},{"name":"meetingTime","required":true}]',
   ARRAY['meeting_reminder'], false, now(), now()),
  (gen_random_uuid()::text, 'event_reminder', 'en', 'UTILITY', 1, 'DRAFT',
   '[{"name":"organizationName","required":true},{"name":"eventName","required":true},{"name":"eventDate","required":true}]',
   ARRAY['event_reminder'], false, now(), now()),
  (gen_random_uuid()::text, 'dues_reminder', 'en', 'UTILITY', 1, 'DRAFT',
   '[{"name":"organizationName","required":true},{"name":"amountDue","required":true},{"name":"dueDate","required":true}]',
   ARRAY['dues_reminder'], false, now(), now()),
  (gen_random_uuid()::text, 'payment_received', 'en', 'UTILITY', 1, 'DRAFT',
   '[{"name":"organizationName","required":true},{"name":"amount","required":true}]',
   ARRAY['payment_confirmation'], false, now(), now()),
  (gen_random_uuid()::text, 'announcement_notice', 'en', 'UTILITY', 1, 'DRAFT',
   '[{"name":"organizationName","required":true},{"name":"announcementTitle","required":true}]',
   ARRAY['announcement'], false, now(), now())
ON CONFLICT (key) DO NOTHING;
