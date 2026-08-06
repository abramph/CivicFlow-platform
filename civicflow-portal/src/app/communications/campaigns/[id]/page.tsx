import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { CommunicationCampaignSendButton } from "@/components/forms/CommunicationCampaignSendButton";
import { formatDateTime, formatEnumLabel, formatPersonName } from "@/lib/formatting";
import { WHATSAPP_ADDON } from "@/lib/whatsapp/pricing";

function isWhatsAppEligible(member: { whatsappPhoneNumber: string | null; whatsappOptInStatus: string; whatsappOptedOutAt: Date | null; whatsappEnabled: boolean } | null) {
  return Boolean(member?.whatsappPhoneNumber && member.whatsappOptInStatus === "OPTED_IN" && !member.whatsappOptedOutAt && member.whatsappEnabled);
}

export default async function CommunicationCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, can } = await requirePermission("communications:read");
  const { id } = await params;
  const campaign = await prisma.communicationCampaign.findFirst({
    where: { id, organizationId },
    include: { recipients: { include: { member: true }, orderBy: { createdAt: "asc" }, take: 500 } },
  });
  if (!campaign) return <main><PageHeader title="Campaign not found" description="The requested communication campaign was not found." actions={[{ href: "/communications/campaigns", label: "Back to Campaigns" }]} /></main>;
  const whatsappEligibleCount = campaign.recipients.filter((recipient) => isWhatsAppEligible(recipient.member)).length;
  const whatsappCostEstimate = ((whatsappEligibleCount * WHATSAPP_ADDON.overageRateCents) / 100).toFixed(2);
  return (
    <main className="space-y-6">
      <PageHeader title={campaign.title} description="Campaign details, recipients, and delivery status." actions={[{ href: "/communications/campaigns", label: "Back to Campaigns" }, { href: "/communications", label: "Communication Log" }]} />
      <div className="grid gap-4 md:grid-cols-4"><StatCard label="Type" value={formatEnumLabel(campaign.communicationType)} /><StatCard label="Channel" value={formatEnumLabel(campaign.channel)} /><StatCard label="Status" value={formatEnumLabel(campaign.status)} /><StatCard label="Recipients" value={campaign.recipients.length} /></div>
      <div className="grid gap-4 md:grid-cols-3"><StatCard label="Push Enabled" value={campaign.pushEnabled ? "Yes" : "No"} /><StatCard label="Deep Link" value={campaign.deepLink || "None"} /><StatCard label="Scheduled For" value={formatDateTime(campaign.scheduledFor)} /></div>
      {campaign.whatsappEnabled ? (
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="WhatsApp Template" value={campaign.whatsappTemplateKey || "None"} />
          <StatCard label="WhatsApp Eligible Recipients" value={`${whatsappEligibleCount} of ${campaign.recipients.length}`} />
          <StatCard label="Estimated WhatsApp Cost" value={`$${whatsappCostEstimate}`} />
        </div>
      ) : null}
      {["DRAFT", "READY", "FAILED"].includes(campaign.status) && can("communications:write") ? <SectionCard title="Send Campaign" description="Email is sent only when ENABLE_EMAIL_SEND is enabled; otherwise deliveries are logged as skipped."><CommunicationCampaignSendButton campaignId={campaign.id} /></SectionCard> : null}
      <SectionCard title="Message" description={campaign.subject}>
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{campaign.body}</p>
        {Array.isArray(campaign.attachmentKeys) && campaign.attachmentKeys.length > 0 ? <p className="mt-4 text-sm text-slate-700">Attachments: {campaign.attachmentKeys.join(", ")}</p> : null}
        <p className="mt-4 text-xs text-slate-600">Created {formatDateTime(campaign.createdAt)} · Sent {formatDateTime(campaign.sentAt)}</p>
      </SectionCard>
      <SectionCard title="Campaign Attachments" description="Upload announcement files, minutes, handouts, and other communication documents.">
        <AttachmentManager entityType="COMMUNICATION_CAMPAIGN" entityId={campaign.id} canWrite={can("communications:write")} />
      </SectionCard>
      <SectionCard title="Recipients" description="Delivery results are retained for reporting and member communication history.">
        <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Error</th><th className="px-4 py-3">Push Status</th>{campaign.whatsappEnabled ? <th className="px-4 py-3">WhatsApp Status</th> : null}</tr></thead><tbody>{campaign.recipients.map((recipient) => <tr key={recipient.id} className="border-t border-slate-100"><td className="px-4 py-3">{recipient.member ? formatPersonName(recipient.member) : "No member"}</td><td className="px-4 py-3">{recipient.email || "-"}</td><td className="px-4 py-3">{recipient.phone || "-"}</td><td className="px-4 py-3">{formatEnumLabel(recipient.deliveryStatus)}</td><td className="px-4 py-3">{formatDateTime(recipient.sentAt)}</td><td className="px-4 py-3">{recipient.errorMessage || "-"}</td><td className="px-4 py-3">{recipient.pushDeliveryStatus ? formatEnumLabel(recipient.pushDeliveryStatus) : "-"}</td>{campaign.whatsappEnabled ? <td className="px-4 py-3">{recipient.whatsappDeliveryStatus ? formatEnumLabel(recipient.whatsappDeliveryStatus) : isWhatsAppEligible(recipient.member) ? "Pending" : "Not eligible"}{recipient.whatsappError ? ` — ${recipient.whatsappError}` : ""}</td> : null}</tr>)}</tbody></table></div>
      </SectionCard>
    </main>
  );
}
