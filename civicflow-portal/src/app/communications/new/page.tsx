import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { CommunicationLogForm } from "@/components/forms/CommunicationLogForm";
import { CommunicationCampaignForm } from "@/components/forms/CommunicationCampaignForm";
import { getSmsEntitlement } from "@/lib/sms-entitlement";
import { getOrganizationEntitlements } from "@/lib/plan-gate";
import { getWhatsAppEntitlement } from "@/lib/whatsapp/entitlement";
import { getVerticalCapabilities } from "@/lib/vertical-capabilities";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { listPtaGrades, listPtaClassrooms } from "@/lib/labs/pta/academic";
import { listPtaCommittees } from "@/lib/labs/pta/committees";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function NewCommunicationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("communications:write");
  const resolvedSearchParams = await searchParams;
  const isDuesReminderPreset = getValue(resolvedSearchParams.preset) === "dues_reminder";

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true } });
  const isPtaOrganization = getVerticalCapabilities(organization?.primaryVertical ?? "COMMUNITY").ptaHouseholds;

  const [members, campaigns, events, categories, smsEntitlement, entitlements, whatsappEntitlement, whatsappTemplates] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: 300,
    }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 150,
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true },
      take: 150,
    }),
    prisma.category.findMany({
      where: { organizationId, type: "MEMBERSHIP", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getSmsEntitlement(organizationId),
    getOrganizationEntitlements(organizationId),
    getWhatsAppEntitlement(organizationId),
    prisma.whatsAppTemplate.findMany({
      where: { active: true, approvalStatus: "APPROVED" },
      orderBy: { key: "asc" },
      select: { key: true, category: true, variablesSchema: true },
    }),
  ]);

  // PTA-only audience targeting (grade/classroom/committee/event volunteers/
  // unpaid dues) — additive to the base form, never shown for a non-PTA
  // organization. See resolvePtaTargetMemberIds (src/lib/labs/pta/
  // communications.ts) for how the server actually resolves these.
  const ptaTargeting = isPtaOrganization
    ? await (async () => {
        const profile = await getPtaProfile(organizationId);
        const schoolYear = profile?.currentSchoolYear ?? "";
        const [grades, classrooms, committees] = await Promise.all([
          listPtaGrades(organizationId),
          schoolYear ? listPtaClassrooms(organizationId, schoolYear) : Promise.resolve([]),
          listPtaCommittees(organizationId),
        ]);
        return {
          schoolYear,
          grades: grades.map((grade) => ({ id: grade.id, label: grade.name })),
          classrooms: classrooms.map((classroom) => ({ id: classroom.id, label: `${classroom.grade.name} — ${classroom.name}` })),
          committees: committees.map((committee) => ({ id: committee.id, label: committee.name })),
          events: events.map((event) => ({ id: event.id, label: event.title })),
        };
      })()
    : null;

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Communication"
        description="Send a mass communication campaign or record a single communication log entry."
        actions={[
          { href: "/communications/campaigns", label: "Campaigns" },
          { href: "/communications", label: "Back to Communications" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Mass Communication Campaign" description="Send announcements, meeting minutes, dues reminders, event notices, and general email communications to selected member groups.">
        <CommunicationCampaignForm
          categories={categories.map((category) => ({ id: category.id, label: category.name }))}
          smsEnabled={smsEntitlement.allowed}
          emailCampaignsEnabled={entitlements.features.emailCampaigns}
          whatsappEnabled={whatsappEntitlement.allowed}
          ptaTargeting={ptaTargeting}
          whatsappTemplates={whatsappTemplates.map((template) => ({
            key: template.key,
            category: template.category,
            variables: Array.isArray(template.variablesSchema)
              ? (template.variablesSchema as Array<{ name: string; required: boolean; maxLength?: number }>)
              : [],
          }))}
          initial={
            isDuesReminderPreset
              ? {
                  communicationType: "DUES_REMINDER",
                  selector: "outstanding_dues",
                  pushEnabled: true,
                  deepLink: "/report-payment",
                  title: "Dues Reminder",
                  subject: "Your dues payment is due",
                }
              : undefined
          }
        />
      </SectionCard>
      <SectionCard title="Communication Entry" description="Organization context is taken from your authenticated session.">
        <CommunicationLogForm
          members={members.map((member) => ({ id: member.id, label: `${member.lastName}, ${member.firstName}` }))}
          campaigns={campaigns.map((campaign) => ({ id: campaign.id, label: campaign.name }))}
          events={events.map((event) => ({ id: event.id, label: event.title }))}
          defaults={{
            memberId: getValue(resolvedSearchParams.memberId),
            campaignId: getValue(resolvedSearchParams.campaignId),
            eventId: getValue(resolvedSearchParams.eventId),
          }}
        />
      </SectionCard>
    </main>
  );
}
